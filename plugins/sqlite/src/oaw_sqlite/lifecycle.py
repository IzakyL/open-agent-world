"""Create/rollback and durable post-delete cleanup through OAW lifecycle hooks."""
import sqlite3
from threading import Event

from open_agent_world.plugin_api import (
    ConflictError, NodeLifecycleHandler, NodeLifecycleTransaction,
    NodeResourceContext, ResourceValidationError,
)
from .engine import FILE_NAME, connection


def remove_files(directory):
    # Only the plugin's known files, never recursive deletion of a user folder.
    for suffix in ("-wal", "-shm", "-journal", ""):
        (directory / (FILE_NAME + suffix)).unlink(missing_ok=True)
    if directory.is_dir() and not any(directory.iterdir()):
        directory.rmdir()


class CreateDatabase(NodeLifecycleTransaction):
    def __init__(self, directory):
        self.directory = directory
        self.created = False

    async def commit(self):
        if self.created:
            return
        self.directory.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.directory.mkdir()
        except FileExistsError as error:
            raise ConflictError("Database storage already exists; use a new card ID") from error
        self.created = True
        db = sqlite3.connect(self.directory / FILE_NAME)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA user_version=1")  # Materialize the empty file.
            db.commit()
        finally:
            db.close()

    async def rollback(self, error):
        if self.created:
            remove_files(self.directory)
            self.created = False


class DeleteDatabase(NodeLifecycleTransaction):
    def __init__(self, directory):
        self.directory = directory

    async def finalize(self):
        # Host journals this finalizer and retries it after restart if needed.
        # Before the graph commit, both commit and rollback are intentionally inert.
        remove_files(self.directory)


class DatabaseLifecycle(NodeLifecycleHandler):
    async def prepare_create(self, context, node, request):
        return CreateDatabase(context.resources.node_storage_path(node.id))

    async def prepare_delete(self, context, node):
        return DeleteDatabase(context.resources.node_storage_path(node.id))

    async def on_startup(self, context, node):
        resource = NodeResourceContext(node.id, context.resources.node_storage_path(node.id), Event())
        try:
            with connection(resource) as db:
                db.execute("SELECT name FROM sqlite_schema LIMIT 1").fetchall()
        except (ResourceValidationError, ConflictError):
            context.nodes.update_status(node.id, "error")
        else:
            if node.status != "available":
                context.nodes.update_status(node.id, "available")
