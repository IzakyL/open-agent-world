# SQL database

An automatically discovered OAW plugin (`data.sqlite`) using the Python standard
library SQLite driver. No database server or extra dependencies are needed.

Open the **SQL database** pack in the card library, place a card, then open its
workspace. The left pane lists tables and views. Select an item to inspect its
columns, keys, indexes and definition, or **Browse rows**. The SQL editor supports
one statement per run, positional `?` parameters (JSON array) and named `:name`
parameters (JSON object). Queries default to read only. Uncheck **Read only** to
make changes; destructive statements show a confirmation before execution.
Results retain duplicate column names and distinguish NULL and binary values.
Use **Refresh** to see changes made by an Agent or another window.

## Agent connections

| Relationship | Tools and permissions |
| --- | --- |
| SQL read | `inspect_database`, `query_database` |
| SQL additive write | Read tools plus `write_database`: INSERT, CREATE TABLE/INDEX/VIEW, ALTER TABLE ADD COLUMN |
| SQL privileged write | All tools plus `modify_database`: UPDATE, DELETE, DROP, RENAME, REPLACE and triggers |

Agents should inspect the database and relevant tables first, query existing
data, and reuse or extend existing entities. Writes require `schema_version`
from inspection. A schema conflict requires a fresh inspection, not a new table
name. Every invocation rechecks the current relationship and selected target;
cached tool IDs stop working when access is revoked.

The privileged relationship is a **sensitive grant**: Minister-created grants go
through OAW's existing confirmation review. Explicitly connecting it in the UI
authorizes destructive Agent SQL on that database. There is no per-statement
human prompt for an Agent holding this grant. Use additive access unless those
permissions are intended. Agents cannot pass desktop confirmation arguments.
All UPDATE/DELETE statements are treated conservatively as privileged, including
those with WHERE clauses. Triggers and ON CONFLICT REPLACE policies cannot bypass
the additive restriction. SQL cannot access OAW's world database or other cards.

## Persistence and failure behavior

Each card owns `assets/nodes/<hash-of-card-id>/database.sqlite3` under the active
profile's data directory. Renaming or moving a card leaves its data intact.
Reopening the application retains schema and rows. Missing or corrupt files
produce an error; they are never silently replaced with an empty database.
Back up the profile while OAW is closed (or use SQLite's backup API); copying a
live SQLite file without its WAL is not a consistent backup.

Deleting a card permanently removes its database through OAW's journaled
lifecycle finalizer. Failed graph deletion preserves the file; failed cleanup
reserves the ID and retries after restart. Recreating a deleted card, even with
the same ID, creates an empty database. The canvas explicitly confirms this
deletion and clears its undo history. Database file snapshots are not supported
by canvas undo, copy/paste, or Legion templates. Undoing creation is rejected
before deletion; use the direct delete action to review permanent removal.

Connections are short lived, use WAL, foreign keys, a one-second busy timeout,
and an explicit transaction per statement. Graph mutations and resource actions
are serialized by the host's existing mutation lock; blocking SQL runs off the
event loop. Cancellation waits for the worker to stop before deletion or access
revocation can complete. Errors roll back the statement. A lost client response
may follow a successful commit: inspect the data before retrying an INSERT.

Statements have a three-second execution budget, 64 KiB SQL limit, 1 MiB cell
limit, and at most 1,000 returned rows (200 in the UI) within a 1 MiB result
budget. Result limits do not reduce the number of modified rows. Schema lists
show at most 500 objects. Use SQL filters and LIMIT/OFFSET for larger datasets.
ATTACH/DETACH, PRAGMA, transaction control, temporary/virtual tables, extension
loading, file functions, EXPLAIN and maintenance statements are intentionally
unsupported. These boundaries use SQLite's parser and
[authorizer](https://www.sqlite.org/c3ref/set_authorizer.html), plus read-only
connections and [trusted-schema settings](https://www.sqlite.org/pragma.html#pragma_trusted_schema).

## Integration

The plugin owns SQL policy, UI and lifecycle hooks. The host adds the small,
generic `NodeResourceAction` contract for operations on native files, alongside
existing JSON node documents. Actions use the same scoped capability provider,
control-plane API security, mutation lock and plugin ownership validation.
Storage paths are host-selected; no path is accepted from an Agent or config.

Tests: `backend/tests/test_sqlite_card.py`,
`frontend/src/plugins/SQLite.test.tsx`, `frontend/e2e/sqlite-card.spec.ts`.
