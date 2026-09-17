"""Bounded, single-statement SQLite operations. No host database is exposed."""
from __future__ import annotations

import base64
import json
import math
import re
import sqlite3
import time
from contextlib import contextmanager
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, StrictStr
from open_agent_world.plugin_api import (
    ConflictError, NodeResourceContext, PermissionDeniedError,
    ResourceValidationError, RevisionConflictError,
)

FILE_NAME = "database.sqlite3"
TIMEOUT_SECONDS = 3.0
MAX_RESULT_BYTES = 1024 * 1024
MAX_SCHEMA_OBJECTS = 500


class Inspect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    table: str | None = Field(default=None, max_length=256,
        description="Optional table/view name from the schema list for columns, indexes and foreign keys.")


class Query(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    sql: str = Field(min_length=1, max_length=65536, description="One SQLite statement; bind values with ? or :name parameters.")
    parameters: list[StrictStr | StrictInt | StrictFloat | StrictBool | None] | dict[str, StrictStr | StrictInt | StrictFloat | StrictBool | None] = Field(default_factory=list, max_length=1000)
    max_rows: int = Field(default=200, ge=1, le=1000, strict=True)


class Write(Query):
    schema_version: int = Field(ge=0, strict=True,
        description="Current schema_version returned by inspect_database. Inspect first; reuse or extend existing tables.")


# This lexer is only for conservative risk classification, never SQL execution
# or read authorization. SQLite's parser and authorizer enforce that boundary.
_TOKENS = re.compile(r"--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[^\s]", re.ASCII)


def tokens(sql):
    return [part.upper() if part[0] not in "'\"`[" else part
            for part in _TOKENS.findall(sql) if not part.startswith(("--", "/*"))]


def additive_alter(parts):
    # ALTER TABLE [main.] <identifier> ADD [COLUMN] ... only. Everything else
    # requires privileged access, including RENAME and DROP COLUMN.
    if parts[:2] != ["ALTER", "TABLE"] or len(parts) < 5:
        return False
    offset = 5 if len(parts) > 4 and parts[3] == "." else 3
    return len(parts) > offset and parts[offset] == "ADD"


def identifier(name):
    return '"' + name.replace('"', '""') + '"'


@contextmanager
def connection(context: NodeResourceContext, *, write=False):
    path = context.storage_path / FILE_NAME
    if not path.is_file():
        raise ResourceValidationError("Database file is missing. Restore it from backup; an existing card is never silently reset.")
    db = None
    try:
        # mode=rw prevents accidental recreation of a lost database.
        db = sqlite3.connect(path.as_uri() + ("?mode=rw" if write else "?mode=ro"), uri=True,
            timeout=1.0, isolation_level=None, cached_statements=0)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA recursive_triggers=ON")
        db.execute("PRAGMA temp_store=MEMORY")
        if not write:
            db.execute("PRAGMA query_only=ON")
        if hasattr(db, "setconfig"):
            db.setconfig(sqlite3.SQLITE_DBCONFIG_DEFENSIVE, True)
        db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_RESULT_BYTES)
        db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 65536)
        db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 256)
        db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 1000)
        db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
        deadline = time.monotonic() + TIMEOUT_SECONDS
        db.set_progress_handler(lambda: int(context.cancelled.is_set() or time.monotonic() >= deadline), 1000)
        db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield db
    except sqlite3.Error as error:
        code = getattr(error, "sqlite_errorcode", 0) & 0xff
        if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            raise ConflictError("Database is busy. Retry this operation shortly.") from error
        if code == sqlite3.SQLITE_INTERRUPT:
            raise ResourceValidationError("SQL cancelled or exceeded the 3 second execution limit. Narrow the query and retry.") from error
        raise ResourceValidationError(f"SQLite: {error}") from error
    finally:
        if db is not None:
            db.set_authorizer(None)
            db.set_progress_handler(None, 0)
            if db.in_transaction:
                db.rollback()
            db.close()


def inspect(context, arguments):
    request = Inspect.model_validate(arguments)
    with connection(context) as db:
        schema_version = db.execute("PRAGMA schema_version").fetchone()[0]
        objects = db.execute("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name LIMIT ?",
            (MAX_SCHEMA_OBJECTS + 1,)).fetchall()
        result = {"schema_version": schema_version, "engine": "SQLite", "sqlite_version": sqlite3.sqlite_version,
            "objects": [dict(zip(("type", "name", "table", "sql"), row)) for row in objects[:MAX_SCHEMA_OBJECTS]],
            "truncated": len(objects) > MAX_SCHEMA_OBJECTS,
            "guidance": "Inspect relevant tables before writing. Reuse existing tables; prefer INSERT and ALTER TABLE ADD COLUMN to new tables. Create a table only for a distinct entity. One database, main schema; no ATTACH or external files."}
        if request.table is not None:
            if not db.execute("SELECT 1 FROM sqlite_schema WHERE name=? AND type IN ('table','view')", (request.table,)).fetchone():
                raise ResourceValidationError("Table or view does not exist; inspect the schema again")
            name = identifier(request.table)
            result["table"] = request.table
            result["columns"] = [dict(zip(("cid", "name", "type", "notnull", "default", "pk", "hidden"), row))
                for row in db.execute(f"PRAGMA table_xinfo({name})")]
            result["foreign_keys"] = [dict(zip(("id", "seq", "table", "from", "to", "on_update", "on_delete", "match"), row))
                for row in db.execute(f"PRAGMA foreign_key_list({name})")]
            result["indexes"] = [{"name": row[1], "unique": bool(row[2]), "origin": row[3], "partial": bool(row[4]),
                "columns": [item[2] for item in db.execute(f"PRAGMA index_info({identifier(row[1])})")]}
                for row in db.execute(f"PRAGMA index_list({name})")]
        if len(json.dumps(result).encode()) > MAX_RESULT_BYTES:
            raise ResourceValidationError("Schema result exceeds 1 MiB. Reduce database schema complexity.")
        return result


_READ = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_RECURSIVE}
_CREATE = {sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_CREATE_INDEX, sqlite3.SQLITE_CREATE_VIEW}
_DDL = _CREATE | {sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_DROP_TABLE,
    sqlite3.SQLITE_DROP_INDEX, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_CREATE_TRIGGER, sqlite3.SQLITE_DROP_TRIGGER}
_DML = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}
_FUNCTIONS_DENIED = {"load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"}


class Policy:
    def __init__(self, sql, mode, replace_tables):
        self.parts = tokens(sql)
        self.mode = mode
        self.replace_tables = replace_tables
        self.reasons = set()
        self.denied = None
        self.writes = False
        self.ddl = bool(self.parts and self.parts[0] in {"CREATE", "ALTER", "DROP"})
        if "REPLACE" in self.parts:
            self.reasons.add("REPLACE can delete existing rows")

    def authorize(self, action, first, second, database, source):
        if database not in (None, "main"):
            return self.deny("Only this card's main database is accessible")
        if action in _READ:
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_FUNCTION:
            if (second or "").lower() in _FUNCTIONS_DENIED:
                return self.deny("File access and extension functions are disabled")
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_REINDEX and self.parts[:1] == ["CREATE"]:
            # SQLite builds the index as part of CREATE [UNIQUE] INDEX.
            return sqlite3.SQLITE_OK
        if action in _DDL | _DML:
            self.writes = True
            if self.mode == "query":
                return self.deny("Query access is read-only; use a write capability")
            if action in _CREATE:
                return sqlite3.SQLITE_OK
            if action in _DML and first in {"sqlite_master", "sqlite_schema", "sqlite_sequence"}:
                if self.ddl or (action == sqlite3.SQLITE_INSERT and first == "sqlite_sequence"):
                    return sqlite3.SQLITE_OK
                return self.deny("SQLite internal tables cannot be modified directly")
            if action == sqlite3.SQLITE_INSERT:
                if first in self.replace_tables:
                    self.reasons.add("The table has an ON CONFLICT REPLACE policy")
                return sqlite3.SQLITE_OK
            if action == sqlite3.SQLITE_ALTER_TABLE and additive_alter(self.parts):
                return sqlite3.SQLITE_OK
            self.reasons.add("This statement can change or remove existing data or schema")
            return sqlite3.SQLITE_OK
        return self.deny("ATTACH, PRAGMA, transaction control, temporary/virtual tables and maintenance SQL are disabled")

    def deny(self, message):
        self.denied = message
        return sqlite3.SQLITE_DENY


def cell(value):
    if isinstance(value, bytes):
        return {"type": "blob", "base64": base64.b64encode(value).decode(), "bytes": len(value)}
    if isinstance(value, float) and not math.isfinite(value):
        return {"type": "float", "value": str(value)}
    return value


def execute(context, arguments, mode: Literal["query", "write", "admin", "desktop"]):
    request = (Query if mode == "query" else Write).model_validate(arguments)
    parts = tokens(request.sql)
    if not parts:
        raise ResourceValidationError("Enter one SQL statement")
    # EXPLAIN executes no write; avoiding nested EXPLAIN also keeps preflight exact.
    if parts[0] == "EXPLAIN":
        raise ResourceValidationError("EXPLAIN is not supported by this card; run a SELECT or inspect the schema")
    started = time.monotonic()
    with connection(context, write=mode != "query") as db:
        schema_version = db.execute("PRAGMA schema_version").fetchone()[0]
        if mode != "query" and request.schema_version != schema_version:
            raise RevisionConflictError("Database schema changed. Inspect it and retry with the current schema_version.")
        replace_tables = {name for name, sql in db.execute("SELECT name, sql FROM sqlite_schema WHERE type='table'")
            if sql and "REPLACE" in tokens(sql)}
        policy = Policy(request.sql, mode, replace_tables)
        if any("REPLACE" in tokens(sql or "") for (sql,) in db.execute("SELECT sql FROM sqlite_schema WHERE type='trigger'")):
            policy.reasons.add("A database trigger contains REPLACE")
        db.set_authorizer(policy.authorize)
        try:
            # Prepare with SQLite itself. EXPLAIN does not perform the SQL and
            # catches multiple statements, syntax, permissions and bound values.
            db.execute("EXPLAIN " + request.sql, request.parameters).fetchall()
            if policy.reasons and policy.writes:
                if mode == "write":
                    raise PermissionDeniedError("Requires the SQL privileged write connection: " + "; ".join(sorted(policy.reasons)))
                if mode == "desktop" and not context.confirmed:
                    return {"status": "confirmation_required", "reasons": sorted(policy.reasons),
                        "schema_version": schema_version, "sql": request.sql,
                        "message": "Review this SQL before confirming. It may change or remove existing data. Nothing has changed."}
            before = db.total_changes
            cursor = db.execute(request.sql, request.parameters)
            columns = [item[0] for item in cursor.description] if cursor.description else []
            rows, size, truncated = [], 0, False
            if columns:
                for row in cursor:
                    converted = [cell(value) for value in row]
                    size += len(json.dumps(converted).encode())
                    if len(rows) >= request.max_rows or size > MAX_RESULT_BYTES:
                        truncated = True
                        break
                    rows.append(converted)
            # Close RETURNING cursors before commit. SQLite performs the full
            # statement even when the displayed result is limited.
            cursor.close()
            db.set_authorizer(None)
            if context.cancelled.is_set():
                raise ResourceValidationError("SQL cancelled; transaction rolled back")
            result = {"status": "ok", "columns": columns, "rows": rows, "truncated": truncated,
                "rows_returned": len(rows), "changes": db.total_changes - before,
                "schema_version": db.execute("PRAGMA schema_version").fetchone()[0],
                "elapsed_ms": round((time.monotonic() - started) * 1000, 1)}
            db.commit()
            return result
        except sqlite3.Error as error:
            if policy.denied:
                raise PermissionDeniedError(policy.denied) from error
            raise
        except OverflowError as error:
            raise ResourceValidationError("SQL integer parameters must fit a signed 64-bit integer") from error


def query(context, arguments):
    return execute(context, arguments, "query")


def write(context, arguments):
    return execute(context, arguments, "write")


def admin(context, arguments):
    return execute(context, arguments, "admin" if context.actor_id else "desktop")
