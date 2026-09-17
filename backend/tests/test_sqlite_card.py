"""Native SQLite persistence, authorization and failure boundaries."""
import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.capabilities.provider import WorldAgentCapabilityProvider
from backend.config import Settings
from backend.errors import ConflictError, PermissionDeniedError, ResourceValidationError, RevisionConflictError
from backend.main import create_app
from backend.node_resources import ResourceActionRequest, invoke_resource_action
from backend.services import create_services
from backend.tests.conftest import create_node
from backend.world.models import CardCreate, EdgeCreate, EdgePatch


@pytest.fixture
def services(tmp_path):
    instance = create_services(Settings.for_data_root(tmp_path / "profile"))
    yield instance
    instance.close()


async def action(services, node, operation, **arguments):
    return await invoke_resource_action(services, node.id, operation, ResourceActionRequest(arguments=arguments))


async def create_database(services):
    node = await services.create_card(CardCreate(type="data.sqlite"))
    await action(services, node, "write", sql="CREATE TABLE readings (id INTEGER PRIMARY KEY, value TEXT UNIQUE)", schema_version=0)
    return node


def test_discovery_ui_and_restart(data_root):
    settings = Settings.for_data_root(data_root)
    with TestClient(create_app(settings)) as client:
        catalog = client.get("/api/catalog").json()
        node_type = next(item for item in catalog["node_types"] if item["id"] == "data.sqlite")
        assert node_type["plugin_id"] == "data.sqlite"
        assert node_type["frontend"]["workspace"] == "database"
        node = create_node(client, "data.sqlite")
        url = f"/api/nodes/{node['id']}/resource/"
        schema = client.post(url + "inspect", json={"arguments": {}}).json()
        assert schema["objects"] == []
        def sql(statement, **extra):
            return client.post(url + "admin", json={"arguments": {"sql": statement, "schema_version": extra.pop("schema_version", 0), **extra}})
        assert sql("CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT)").status_code == 200
        assert sql("INSERT INTO notes(text) VALUES (:text)", parameters={"text": "durable ' value"}, schema_version=1).status_code == 200
        assert client.patch(f"/api/nodes/{node['id']}", json={"name": "Renamed database"}).status_code == 200
    with TestClient(create_app(settings)) as client:
        result = client.post(url + "query", json={"arguments": {"sql": "SELECT text FROM notes"}})
        assert result.status_code == 200, result.text
        assert result.json()["rows"] == [["durable ' value"]]
        preview = client.post(url + "admin", json={"arguments": {"sql": "DELETE FROM notes", "schema_version": 1}})
        assert preview.json()["status"] == "confirmation_required"
        assert client.post(url + "query", json={"arguments": {"sql": "SELECT count(*) FROM notes"}}).json()["rows"] == [[1]]
        done = client.post(url + "admin", json={"arguments": {"sql": "DELETE FROM notes", "schema_version": 1}, "confirm": True})
        assert done.json()["changes"] == 1


@pytest.mark.asyncio
async def test_scoped_tools_and_live_revocation(services):
    db = await create_database(services)
    other = await create_database(services)
    agent = await services.create_card(CardCreate(type="agent"))
    edge = await services.create_edge(EdgeCreate(source=agent.id, target=db.id, relationship="data.sqlite.read"))
    provider = WorldAgentCapabilityProvider(services)
    tools = {tool.name: tool for tool in await provider.list_tools(agent.id)}
    assert {"inspect_database", "query_database"} <= tools.keys()
    assert "write_database" not in tools
    query_tool = tools["query_database"]
    assert other.id not in str(query_tool.input_schema)
    result = await provider.invoke_tool(agent.id, query_tool.capability_id, {"target": db.id, "sql": "SELECT count(*) FROM readings"})
    assert result["rows"] == [[0]]
    with pytest.raises(PermissionDeniedError):
        await provider.invoke_tool(agent.id, query_tool.capability_id, {"target": other.id, "sql": "SELECT 1"})
    with pytest.raises(PermissionDeniedError):
        await provider.invoke_tool(agent.id, f"data.sqlite.write:{db.id}", {"sql": "INSERT INTO readings VALUES(1,'a')", "schema_version": 1})
    await services.update_edge(edge.id, EdgePatch(relationship="data.sqlite.edit"))
    write_tool = next(tool for tool in await provider.list_tools(agent.id) if tool.name == "write_database")
    assert "schema_version" in write_tool.input_schema["required"]
    result = await provider.invoke_tool(agent.id, write_tool.capability_id, {"target": db.id, "sql": "INSERT INTO readings VALUES(1,'a')", "schema_version": 1})
    assert result["changes"] == 1
    with pytest.raises(PermissionDeniedError):
        await provider.invoke_tool(agent.id, write_tool.capability_id, {"target": db.id, "sql": "DELETE FROM readings", "schema_version": 1})
    with pytest.raises(ResourceValidationError):
        await provider.invoke_tool(agent.id, write_tool.capability_id, {"target": db.id, "sql": "DELETE FROM readings", "schema_version": 1, "confirm": True})
    assert services.plugins.relationship("data.sqlite.manage").canvas_requires_confirmation
    await services.update_edge(edge.id, EdgePatch(relationship="data.sqlite.manage"))
    await provider.invoke_tool(agent.id, f"data.sqlite.admin:{db.id}", {"sql": "UPDATE readings SET value='changed' WHERE id=1", "schema_version": 1})
    stale_capability = services.capabilities.capability_for_id(agent.id, f"data.sqlite.query:{db.id}")
    await services.delete_edge(edge.id)
    with pytest.raises(PermissionDeniedError):
        await provider.invoke_tool(agent.id, query_tool.capability_id, {"target": db.id, "sql": "SELECT 1"})
    with pytest.raises(PermissionDeniedError):
        await invoke_resource_action(services, db.id, "query", ResourceActionRequest(arguments={"sql": "SELECT 1"}), capability=stale_capability)


@pytest.mark.asyncio
@pytest.mark.parametrize("sql", ["ATTACH ':memory:' AS escaped", "PRAGMA writable_schema=ON", "VACUUM INTO 'escaped.db'", "COMMIT", "CREATE VIRTUAL TABLE test USING fts5(text)"])
async def test_privileged_access_does_not_grant_external_or_engine_control(services, sql):
    db = await create_database(services)
    with pytest.raises((PermissionDeniedError, ResourceValidationError)):
        await invoke_resource_action(services, db.id, "admin", ResourceActionRequest(arguments={"sql": sql, "schema_version": 1}, confirm=True))
    with pytest.raises(ResourceValidationError, match="no such table"):
        await action(services, db, "query", sql="SELECT * FROM cards")


@pytest.mark.asyncio
@pytest.mark.parametrize("sql", [
    "DELETE FROM readings", "WITH ids AS (SELECT 1) DELETE FROM readings WHERE id IN ids",
    "INSERT INTO readings VALUES (2,'blocked')", "DROP TABLE readings",
    "PRAGMA query_only=OFF", "PRAGMA writable_schema=ON", "PRAGMA table_info(readings)",
    "ATTACH ':memory:' AS other", "VACUUM INTO 'leak.db'", "BEGIN", "COMMIT",
    "SELECT load_extension('anything')", "CREATE TEMP TABLE leaked(id)",
    "CREATE VIRTUAL TABLE leaked USING fts5(value)",
])
async def test_query_cannot_write_or_escape(services, sql):
    db = await create_database(services)
    with pytest.raises((PermissionDeniedError, ResourceValidationError)):
        await action(services, db, "query", sql=sql)
    assert (await action(services, db, "query", sql="SELECT count(*) FROM readings"))["rows"] == [[0]]


@pytest.mark.asyncio
async def test_additive_schema_and_stale_version(services):
    db = await create_database(services)
    result = await action(services, db, "write", sql='/* extend */ ALTER TABLE "readings" ADD COLUMN unit TEXT', schema_version=1)
    assert result["schema_version"] == 2
    detail = await action(services, db, "inspect", table="readings")
    assert [column["name"] for column in detail["columns"]] == ["id", "value", "unit"]
    with pytest.raises(RevisionConflictError):
        await action(services, db, "write", sql="INSERT INTO readings(id) VALUES (1)", schema_version=1)
    for sql in ("ALTER TABLE readings DROP COLUMN unit", "ALTER TABLE readings RENAME TO old", "REPLACE INTO readings(id) VALUES (1)", "INSERT OR REPLACE INTO readings(id) VALUES (1)"):
        with pytest.raises(PermissionDeniedError):
            await action(services, db, "write", sql=sql, schema_version=2)


@pytest.mark.asyncio
async def test_failures_are_atomic_and_connection_is_reusable(services):
    db = await create_database(services)
    await action(services, db, "write", sql="INSERT INTO readings VALUES (?, ?)", parameters=[1, "one"], schema_version=1)
    for sql, parameters in [
        ("INSRT invalid", []), ("INSERT INTO readings VALUES(2,'two'); DELETE FROM readings", []),
        ("INSERT INTO readings VALUES(2,'two'),(3,'one')", []),
        ("INSERT INTO readings VALUES(?,?)", [2]), ("SELECT ?", [{"invalid": True}]),
        ("SELECT ?", [2**90]),
    ]:
        with pytest.raises(ResourceValidationError):
            await action(services, db, "write", sql=sql, parameters=parameters, schema_version=1)
    assert (await action(services, db, "query", sql="SELECT * FROM readings"))["rows"] == [[1, "one"]]
    bounded = await action(services, db, "query", sql="WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<30) SELECT x,x FROM n", max_rows=3)
    assert bounded["columns"] == ["x", "x"]
    assert len(bounded["rows"]) == 3 and bounded["truncated"]
    binary = await action(services, db, "query", sql="SELECT x'00ff', NULL, 1e999")
    assert binary["rows"][0] == [{"type": "blob", "base64": "AP8=", "bytes": 2}, None, {"type": "float", "value": "inf"}]


@pytest.mark.asyncio
async def test_trigger_and_replace_policy_cannot_bypass_additive_access(services):
    db = await create_database(services)
    for sql in ("CREATE TABLE conflicts (value TEXT UNIQUE ON CONFLICT REPLACE)",
                "CREATE TRIGGER overwrite AFTER INSERT ON readings BEGIN INSERT OR REPLACE INTO conflicts VALUES(new.value); END"):
        version = (await action(services, db, "inspect"))["schema_version"]
        await invoke_resource_action(services, db.id, "admin", ResourceActionRequest(arguments={"sql": sql, "schema_version": version}, confirm=True))
    for sql in ("INSERT INTO conflicts VALUES('a')", "INSERT INTO readings VALUES(1,'a')"):
        with pytest.raises(PermissionDeniedError):
            await action(services, db, "write", sql=sql, schema_version=3)
    assert (await action(services, db, "query", sql="SELECT * FROM readings"))["rows"] == []


@pytest.mark.asyncio
async def test_foreign_keys_and_returning(services):
    db = await create_database(services)
    await action(services, db, "write", sql="CREATE TABLE child(parent_id REFERENCES readings(id))", schema_version=1)
    with pytest.raises(ResourceValidationError, match="FOREIGN KEY"):
        await action(services, db, "write", sql="INSERT INTO child VALUES(99)", schema_version=2)
    result = await action(services, db, "write", sql="INSERT INTO readings VALUES (1,'one'),(2,'two') RETURNING *", schema_version=2, max_rows=1)
    assert result["changes"] == 2 and result["truncated"]
    assert (await action(services, db, "query", sql="SELECT count(*) FROM readings"))["rows"] == [[2]]


@pytest.mark.asyncio
async def test_delete_failure_preserves_database_and_recreation_is_empty(services, monkeypatch):
    db = await create_database(services)
    path = services.resources.node_storage_path(db.id) / "database.sqlite3"
    original = services.world.delete_card
    def fail(*args, **kwargs):
        raise RuntimeError("persistence failure")
    monkeypatch.setattr(services.world, "delete_card", fail)
    with pytest.raises(RuntimeError):
        await services.delete_card(db.id)
    assert path.exists()
    assert len((await action(services, db, "inspect"))["objects"]) == 1
    monkeypatch.setattr(services.world, "delete_card", original)
    await services.delete_card(db.id)
    assert not path.exists()
    recreated = await services.create_card(CardCreate(id=db.id, type="data.sqlite"))
    assert (await action(services, recreated, "inspect"))["objects"] == []


@pytest.mark.asyncio
async def test_create_compensation_and_missing_file_do_not_reset(services, monkeypatch):
    original = type(services).enrich_card
    def fail(self, card):
        if card.type == "data.sqlite":
            raise RuntimeError("creation failed")
        return original(self, card)
    monkeypatch.setattr(type(services), "enrich_card", fail)
    with pytest.raises(RuntimeError):
        await services.create_card(CardCreate(id="failed-db", type="data.sqlite"))
    assert not services.resources.node_storage_path("failed-db").exists()
    monkeypatch.setattr(type(services), "enrich_card", original)
    db = await create_database(services)
    path = services.resources.node_storage_path(db.id) / "database.sqlite3"
    path.unlink()
    with pytest.raises(ResourceValidationError, match="missing"):
        await action(services, db, "query", sql="SELECT 1")
    assert not path.exists()
    await services.plugins.node_type(db.type).lifecycle.on_startup(services._node_lifecycle_context(), db)
    assert services.world.get_card(db.id).status == "error"


@pytest.mark.asyncio
async def test_busy_timeout_and_concurrent_native_connections(services):
    db = await create_database(services)
    from oaw_sqlite import engine
    from open_agent_world.plugin_api import NodeResourceContext
    path = services.resources.node_storage_path(db.id)
    context = NodeResourceContext(db.id, path, Event())
    with sqlite3.connect(path / engine.FILE_NAME) as external:
        external.execute("BEGIN IMMEDIATE")
        with pytest.raises(ConflictError, match="busy"):
            await action(services, db, "write", sql="INSERT INTO readings VALUES(1,'one')", schema_version=1)
    def insert(index):
        return engine.write(context, {"sql": "INSERT INTO readings VALUES (?,?)", "parameters": [index, str(index)], "schema_version": 1})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(insert, range(20)))
    assert all(result["changes"] == 1 for result in results)
    assert (await action(services, db, "query", sql="SELECT count(*) FROM readings"))["rows"] == [[20]]


@pytest.mark.asyncio
async def test_timeout_rolls_back_and_agent_cannot_confirm(services, monkeypatch):
    db = await create_database(services)
    from oaw_sqlite import engine
    monkeypatch.setattr(engine, "TIMEOUT_SECONDS", .02)
    with pytest.raises(ResourceValidationError, match="limit"):
        await action(services, db, "write", sql="WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) INSERT INTO readings SELECT x, CAST(x AS TEXT) FROM n", schema_version=1)
    assert (await action(services, db, "query", sql="SELECT count(*) FROM readings"))["rows"] == [[0]]


@pytest.mark.asyncio
async def test_cancellation_waits_for_worker_before_delete(services):
    db = await create_database(services)
    job = asyncio.create_task(action(services, db, "write", sql="WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) INSERT INTO readings SELECT x, CAST(x AS TEXT) FROM n", schema_version=1))
    await asyncio.sleep(.03)
    job.cancel()
    with pytest.raises(asyncio.CancelledError):
        await job
    assert (await action(services, db, "query", sql="SELECT count(*) FROM readings"))["rows"] == [[0]]
    await services.delete_card(db.id)
    assert not services.resources.node_storage_path(db.id).exists()


@pytest.mark.asyncio
async def test_additive_index_view_quoted_names_and_corruption(services):
    db = await create_database(services)
    await action(services, db, "write", sql='CREATE INDEX "by value" ON readings(value)', schema_version=1)
    await action(services, db, "write", sql='CREATE VIEW "current readings" AS SELECT id,value FROM readings', schema_version=2)
    await action(services, db, "write", sql='ALTER TABLE main."readings" ADD COLUMN "extra field" TEXT', schema_version=3)
    schema = await action(services, db, "inspect", table="readings")
    assert schema["schema_version"] == 4
    assert any(index["name"] == "by value" for index in schema["indexes"])
    assert (await action(services, db, "query", sql='SELECT * FROM "current readings"'))["columns"] == ["id", "value"]
    path = services.resources.node_storage_path(db.id) / "database.sqlite3"
    path.write_bytes(b"invalid SQLite file")
    with pytest.raises(ResourceValidationError, match="SQLite"):
        await action(services, db, "inspect")
    assert path.read_bytes() == b"invalid SQLite file"


@pytest.mark.asyncio
async def test_pending_delete_reserves_id_and_recovers_after_restart(tmp_path, monkeypatch):
    settings = Settings.for_data_root(tmp_path / "recovery")
    first = create_services(settings)
    db = await create_database(first)
    from oaw_sqlite.lifecycle import DeleteDatabase
    original = DeleteDatabase.finalize
    async def fail(self):
        raise OSError("file temporarily in use")
    monkeypatch.setattr(DeleteDatabase, "finalize", fail)
    path = first.resources.node_storage_path(db.id)
    try:
        await first.delete_card(db.id)
        assert path.exists()
        with pytest.raises(ConflictError, match="pending"):
            await first.create_card(CardCreate(id=db.id, type="data.sqlite"))
    finally:
        first.close()
    monkeypatch.setattr(DeleteDatabase, "finalize", original)
    recovered = create_services(settings)
    try:
        await recovered.startup()
        assert not path.exists()
        new = await recovered.create_card(CardCreate(id=db.id, type="data.sqlite"))
        assert (await action(recovered, new, "inspect"))["objects"] == []
    finally:
        await recovered.shutdown()
        recovered.close()


def test_sensitive_database_grant_uses_existing_minister_confirmation(client):
    from backend.tests.test_minister import create_minister, invoke
    from backend.tests.test_minister_authority import approve, versions
    minister = create_minister(client)
    agent = create_node(client, "agent", size={"width": 96, "height": 96})
    db = create_node(client, "data.sqlite", size={"width": 96, "height": 96})
    proposal = invoke(client, minister, "connect", source=agent["id"], target=db["id"],
        relationship="data.sqlite.manage", versions=versions(client, minister))
    assert proposal["status"] == "confirmation_required"
    assert not any(cap["kind"] == "data.sqlite.admin" for cap in client.get(f"/api/agents/{agent['id']}/capabilities").json()["capabilities"])
    approve(client, minister, proposal)
    assert any(cap["kind"] == "data.sqlite.admin" for cap in client.get(f"/api/agents/{agent['id']}/capabilities").json()["capabilities"])
