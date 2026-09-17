"""Portable presentation references for a Legion's optional workspace."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer, model_validator


class WorkspaceView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    card_id: str = Field(min_length=1, max_length=200)
    section_id: str | None = Field(default=None, min_length=1, max_length=200)

    @model_serializer(mode="wrap")
    def serialize(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        value = handler(self)
        if self.section_id is None:
            value.pop("section_id", None)
        return value

    @property
    def key(self) -> tuple[str, str | None]:
        return self.card_id, self.section_id


class WorkspacePane(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["pane"] = "pane"
    view: WorkspaceView


class WorkspaceTabs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["tabs"] = "tabs"
    views: list[WorkspaceView] = Field(min_length=1, max_length=100)
    active_view: WorkspaceView

    @model_validator(mode="after")
    def active_member(self) -> WorkspaceTabs:
        if self.active_view not in self.views:
            raise ValueError("The active tab must belong to its region")
        return self


class WorkspaceSplit(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["split"] = "split"
    axis: Literal["horizontal", "vertical"]
    ratio: float = Field(default=0.5, ge=0.15, le=0.85)
    first: WorkspaceNode
    second: WorkspaceNode


WorkspaceNode = Annotated[WorkspacePane | WorkspaceTabs | WorkspaceSplit, Field(discriminator="kind")]
WorkspaceSplit.model_rebuild()


def _upgrade_legacy_node(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    node = dict(value)
    if node.get("kind") == "pane" and "card_id" in node:
        node["view"] = {"card_id": node.pop("card_id")}
    elif node.get("kind") == "tabs" and "card_ids" in node:
        ids = node.pop("card_ids")
        node["views"] = [{"card_id": card_id} for card_id in ids] if isinstance(ids, list) else ids
        node["active_view"] = {"card_id": node.pop("active_card_id", None)}
    elif node.get("kind") == "split":
        for branch in ("first", "second"):
            if branch in node:
                node[branch] = _upgrade_legacy_node(node[branch])
    return node


class WorkspaceLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[2] = 2
    root: WorkspaceNode | None = None
    hidden_sections: list[WorkspaceView] = Field(default_factory=list, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy(cls, value: Any) -> Any:
        if isinstance(value, dict) and value.get("version") == 1:
            return {**value, "version": 2, "root": _upgrade_legacy_node(value.get("root"))}
        return value

    @model_validator(mode="after")
    def bounded_unique_tree(self) -> WorkspaceLayout:
        seen: set[tuple[str, str | None]] = set()

        def add(view: WorkspaceView) -> None:
            if view.key in seen:
                raise ValueError("A view can appear only once in a workspace")
            seen.add(view.key)

        def visit(node: WorkspaceNode | None, depth: int) -> None:
            if node is None:
                return
            if depth > 16:
                raise ValueError("Workspace layouts support at most 16 levels")
            if isinstance(node, (WorkspacePane, WorkspaceTabs)):
                for view in [node.view] if isinstance(node, WorkspacePane) else node.views:
                    add(view)
            else:
                visit(node.first, depth + 1)
                visit(node.second, depth + 1)

        visit(self.root, 1)
        for view in self.hidden_sections:
            if view.section_id is None:
                raise ValueError("Hidden sections must identify a card section")
            add(view)
        if len(seen) > 100:
            raise ValueError("Workspace layouts support at most 100 views")
        return self


def remap_workspace_config(config: dict[str, Any], node_ids: Mapping[str, str]) -> dict[str, Any]:
    """Map live owner IDs to template keys (or back); collapse missing references."""
    if not config.get("workspace_layout"):
        return dict(config)
    layout = WorkspaceLayout.model_validate(config["workspace_layout"])

    def remap_view(view: WorkspaceView) -> WorkspaceView | None:
        mapped = node_ids.get(view.card_id)
        return WorkspaceView(card_id=mapped, section_id=view.section_id) if mapped else None

    def remap(node: WorkspaceNode | None) -> WorkspaceNode | None:
        if node is None:
            return None
        if isinstance(node, WorkspacePane):
            view = remap_view(node.view)
            return WorkspacePane(view=view) if view else None
        if isinstance(node, WorkspaceTabs):
            views = [mapped for view in node.views if (mapped := remap_view(view)) is not None]
            if not views:
                return None
            if len(views) == 1:
                return WorkspacePane(view=views[0])
            active = remap_view(node.active_view)
            return WorkspaceTabs(views=views, active_view=active if active in views else views[0])
        first, second = remap(node.first), remap(node.second)
        if first is None or second is None:
            return first or second
        return node.model_copy(update={"first": first, "second": second})

    hidden = [mapped for view in layout.hidden_sections if (mapped := remap_view(view)) is not None]
    return {**config, "workspace_layout": WorkspaceLayout(root=remap(layout.root), hidden_sections=hidden).model_dump(mode="json")}
