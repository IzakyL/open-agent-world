"""The shipped example uses the real locked runtime and survives a restart."""
from dataclasses import replace
import importlib.util
import json
from pathlib import Path
import time

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


def test_deployment_example(tmp_path):
    example = Path(__file__).resolve().parents[2] / "examples/deployed-workspace"
    spec = importlib.util.spec_from_file_location("deployment_example", example / "run.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    runtime = module.prepare(tmp_path / "demo")
    manifest = (runtime / "deployment.json").read_bytes()
    settings = replace(Settings.for_data_root(runtime), agent_runtime="example.deployment-demo",
                       plugin_directories=(example / "plugins",))
    with TestClient(create_app(settings), client=("127.0.0.1", 50000)) as client:
        assert client.post("/api/deployment/session", json={"password": module.PASSWORD}).status_code == 200
        app = client.get("/api/runtime-app").json()
        assert len(app["panels"]) == 3
        assert client.get("/api/world").status_code == 404
        assert client.get("/api/settings/models").status_code == 404
        chat = next(panel["card_id"] for panel in app["panels"] if panel["kind"] == "conversation")
        base = f"/api/runtime-app/workspace/conversations/{chat}"
        agents = client.get(base).json()["agents"]
        response = client.post(base + "/sessions", json={"title": "Example acceptance", "participant_ids": [agents[0]["id"]]})
        assert response.status_code == 201, response.text
        session = response.json()["id"]
        messages = f"{base}/sessions/{session}/messages"
        response = client.post(messages, json={"content": "Hello demo", "mention_agent_ids": response.json()["participant_ids"]})
        assert response.status_code == 202, response.text
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            transcript = client.get(messages).text
            if "预设回复" in transcript:
                break
            time.sleep(.05)
        assert "预设回复" in transcript
        assert "Mock response:" not in transcript
    assert module.prepare(tmp_path / "demo") == runtime
    assert (runtime / "deployment.json").read_bytes() == manifest
    with TestClient(create_app(settings), client=("127.0.0.1", 50000)) as client:
        client.post("/api/deployment/session", json={"password": module.PASSWORD})
        assert "Hello demo" in client.get(messages).text
        assert json.loads(manifest)["name"] == app["name"]
