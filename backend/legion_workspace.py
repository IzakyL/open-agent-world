"""Portable split layouts for a Legion's optional window presentation."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class WorkspacePane(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["pane"] = "pane"
    card_id: str = Field(min_length=1, max_length=200)


class WorkspaceTabs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["tabs"] = "tabs"
    card_ids: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(min_length=1, max_length=100)
    active_card_id: str

    @model_validator(mode="after")
    def active_member(self) -> WorkspaceTabs:
        if self.active_card_id not in self.card_ids:
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


class WorkspaceLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    root: WorkspaceNode | None = None

    @model_validator(mode="after")
    def bounded_unique_tree(self) -> WorkspaceLayout:
        seen: set[str] = set()

        def visit(node: WorkspaceNode | None, depth: int) -> None:
            if node is None:
                return
            if depth > 16:
                raise ValueError("Workspace layouts support at most 16 levels")
            if isinstance(node, (WorkspacePane, WorkspaceTabs)):
                for card_id in [node.card_id] if isinstance(node, WorkspacePane) else node.card_ids:
                    if card_id in seen:
                        raise ValueError("A card can appear only once in a workspace")
                    seen.add(card_id)
            else:
                visit(node.first, depth + 1)
                visit(node.second, depth + 1)

        visit(self.root, 1)
        if len(seen) > 100:
            raise ValueError("Workspace layouts support at most 100 cards")
        return self


def remap_workspace_config(config: dict[str, Any], node_ids: Mapping[str, str]) -> dict[str, Any]:
    """Map live IDs to template keys (or back); collapse missing references."""
    if not config.get("workspace_layout"):
        return dict(config)
    layout = WorkspaceLayout.model_validate(config["workspace_layout"])

    def remap(node: WorkspaceNode | None) -> WorkspaceNode | None:
        if node is None:
            return None
        if isinstance(node, WorkspacePane):
            mapped = node_ids.get(node.card_id)
            return WorkspacePane(card_id=mapped) if mapped else None
        if isinstance(node, WorkspaceTabs):
            mapped_ids = [node_ids[key] for key in node.card_ids if key in node_ids]
            if not mapped_ids:
                return None
            if len(mapped_ids) == 1:
                return WorkspacePane(card_id=mapped_ids[0])
            active = node_ids.get(node.active_card_id)
            return WorkspaceTabs(card_ids=mapped_ids, active_card_id=active if active in mapped_ids else mapped_ids[0])
        first, second = remap(node.first), remap(node.second)
        if first is None or second is None:
            return first or second
        return node.model_copy(update={"first": first, "second": second})

    return {**config, "workspace_layout": WorkspaceLayout(root=remap(layout.root)).model_dump(mode="json")}
