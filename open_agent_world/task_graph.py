"""Shared dependency validation for plugin-owned task documents."""
from collections.abc import Sequence
from typing import Protocol


class DependencyTask(Protocol):
    id: str
    title: str
    status: str
    depends_on: list[str]


def validate_task_graph(tasks: Sequence[DependencyTask], *, active_statuses: frozenset[str] = frozenset({"doing", "done"})) -> None:
    by_id = {task.id: task for task in tasks}
    if len(by_id) != len(tasks):
        raise ValueError("Task IDs must be unique")
    visiting, visited = set(), set()

    def visit(key: str) -> None:
        if key in visiting:
            raise ValueError("Dependencies must not form a cycle")
        if key in visited:
            return
        visiting.add(key)
        task = by_id[key]
        if len(set(task.depends_on)) != len(task.depends_on):
            raise ValueError("A dependency may only appear once")
        for dependency in task.depends_on:
            if dependency not in by_id:
                raise ValueError(f"Task {task.title!r} refers to missing dependency {dependency!r}")
            visit(dependency)
        if task.status in active_statuses and any(by_id[key].status != "done" for key in task.depends_on):
            raise ValueError(f"Finish dependencies before starting or completing {task.title!r}. Reopen dependent tasks before reopening their prerequisites.")
        visiting.remove(key)
        visited.add(key)

    for key in by_id:
        visit(key)
