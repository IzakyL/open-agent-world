"""A research task ledger. Execution and cancellation remain owned by OAW Runs."""
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator
from open_agent_world.task_graph import validate_task_graph
from open_agent_world.plugin_api import (
    CapabilityDefinition, CapabilityGrantDefinition, NodeDocumentAction,
    NodeDocumentDefinition, NodeTypeDefinition, RelationshipDefinition,
)


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Task(Model):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=8000)
    depends_on: list[str] = Field(default_factory=list, max_length=100)
    status: Literal["pending", "running", "blocked", "done"] = "pending"
    result: str = Field(default="", max_length=12000)
    outputs: list[str] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def validate_task(self):
        if len(set(self.depends_on)) != len(self.depends_on):
            raise ValueError("Task dependencies must be unique")
        if self.status == "done" and not self.result:
            raise ValueError("Record a verified result before completing a task")
        if any(not item.strip() or len(item) > 1024 for item in self.outputs):
            raise ValueError("Output references must be non-empty and at most 1024 characters")
        return self


class Plan(Model):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=180)
    goal: str = Field(default="", max_length=8000)
    session_id: str = Field(default="", max_length=200)
    tasks: list[Task] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_graph(self):
        validate_task_graph(self.tasks, active_statuses=frozenset({"running", "done"}))
        return self


class Board(Model):
    plans: list[Plan] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def unique_plans(self):
        if len({plan.id for plan in self.plans}) != len(self.plans):
            raise ValueError("Plan IDs must be unique")
        return self


class Read(Model):
    plan_id: str | None = None


class CreatePlan(Model):
    title: str = Field(min_length=1, max_length=180)
    goal: str = Field(default="", max_length=8000)
    session_id: str = Field(default="", max_length=200)
    tasks: list[Task] = Field(default_factory=list, max_length=100)


class AddTask(Model):
    plan_id: str
    task: Task


class UpdateTask(Model):
    plan_id: str
    task_id: str
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=8000)
    depends_on: list[str] | None = Field(default=None, max_length=100)
    status: Literal["pending", "running", "blocked", "done"] | None = None
    result: str | None = Field(default=None, max_length=12000)
    outputs: list[str] | None = Field(default=None, max_length=40)


class RemoveTask(Model):
    plan_id: str
    task_id: str


def summary(value):
    plans = value["plans"]
    return {"plans": len(plans), "tasks": sum(len(p["tasks"]) for p in plans),
            "done": sum(t["status"] == "done" for p in plans for t in p["tasks"])}


def find_plan(value, plan_id):
    plan = next((p for p in value["plans"] if p["id"] == plan_id), None)
    if plan is None:
        raise ValueError("Research plan no longer exists")
    return plan


def read(value, arguments):
    request = Read.model_validate(arguments)
    plan = find_plan(value, request.plan_id) if request.plan_id else next(iter(reversed(value["plans"])), None)
    return {"plans": [{key: p[key] for key in ("id", "title", "session_id")} for p in value["plans"]],
            "plan": plan, "summary": summary(value)}


def create_plan(value, arguments):
    request = CreatePlan.model_validate(arguments)
    value["plans"].append({"id": uuid4().hex, **request.model_dump()})
    return value


def add_task(value, arguments):
    request = AddTask.model_validate(arguments)
    find_plan(value, request.plan_id)["tasks"].append(request.task.model_dump())
    return value


def update_task(value, arguments):
    request = UpdateTask.model_validate(arguments)
    plan = find_plan(value, request.plan_id)
    task = next((t for t in plan["tasks"] if t["id"] == request.task_id), None)
    if task is None:
        raise ValueError("Task no longer exists")
    task.update(request.model_dump(exclude_none=True, exclude={"plan_id", "task_id"}))
    return value


def remove_task(value, arguments):
    request = RemoveTask.model_validate(arguments)
    plan = find_plan(value, request.plan_id)
    if not any(t["id"] == request.task_id for t in plan["tasks"]):
        raise ValueError("Task no longer exists")
    if any(request.task_id in t["depends_on"] for t in plan["tasks"]):
        raise ValueError("Remove dependent references before deleting this task")
    plan["tasks"] = [t for t in plan["tasks"] if t["id"] != request.task_id]
    return value


def capture(value):
    # A new Sandbox has no source outputs. Carry the plan, not completion claims.
    return {"plans": [{**plan, "session_id": "", "tasks": [
        {**task, "status": "pending", "result": "", "outputs": []}
        for task in plan["tasks"]]} for plan in value["plans"]]}


def register(registration):
    actions = {}
    operations = {
        "read": (Read, read, "Read research plans and one plan's tasks. Omit plan_id for the latest plan."),
        "create_plan": (CreatePlan, create_plan, "Create a research plan with explicit tasks and dependency IDs. Use the current session ID when available."),
        "add_task": (AddTask, add_task, "Add a task to an existing research plan."),
        "update_task": (UpdateTask, update_task, "Update a task's plan, status, result or output paths. Start only after prerequisites are done. Completing requires a verified result. This records state; it does not execute or cancel a Run."),
        "remove_task": (RemoveTask, remove_task, "Remove a task with no dependent references. This does not cancel execution or delete output files."),
    }
    for operation, (model, handler, description) in operations.items():
        kind = "matcreator.tasks." + operation
        is_read = operation == "read"
        schema = model.model_json_schema()
        if not is_read:
            schema["properties"]["expected_revision"] = {"type": "integer", "minimum": 0}
            schema.setdefault("required", []).append("expected_revision")

        async def invoke(context, capability, arguments, op=operation):
            args = dict(arguments)
            revision = args.pop("expected_revision", None)
            return await context.node_document_action(capability, op, args, expected_revision=revision)

        registration.register_capability(CapabilityDefinition(kind=kind, tool_name="task_board_" + operation,
            target_parameter="board", description=description, input_schema=schema), invoke)
        actions[operation] = NodeDocumentAction(handler, capability_kind=kind, read_only=is_read, project=is_read)
    registration.register_node_type(NodeTypeDefinition(
        id="matcreator.tasks", label="Research task board", description="Plan research steps, track dependencies and preserve verified results.",
        icon="workflow", color="#8ba69c", deck_id="tools", deck_label="Tools", deck_icon="boxes",
        default_name="Research tasks", default_size=(640, 520), default_status="available",
        statuses=frozenset({"available"}), config_model=Model, templateable=True,
        surfaces={"preview": True, "inspector": True, "workspace": True},
        frontend={"preview": "tasks-preview", "body": "tasks", "workspace": "tasks"},
        document=NodeDocumentDefinition(model=Board, initial_value={"plans": []}, actions=actions,
            summarize=summary, capture=capture, max_size_bytes=1024 * 1024)))
    for suffix, names, label in (("view", ["read"], "Read tasks"), ("manage", list(operations), "Manage tasks")):
        registration.register_relationship(RelationshipDefinition(id="matcreator.tasks." + suffix,
            label=label, short_label="tasks", description="Read research tasks." if suffix == "view" else "Plan research and record task progress and evidence.",
            source_traits=frozenset({"core.agent"}), target_types=frozenset({"matcreator.tasks"}), templateable=True,
            capabilities=tuple(CapabilityGrantDefinition(kind="matcreator.tasks." + name) for name in names)))
