"""Bundled starting formations, deployed through the Legion template contract."""
from datetime import UTC, datetime

from backend.errors import NotFoundError
from backend.legions.models import LegionBlueprint, LegionRecord, LegionTemplateEdge, LegionTemplateNode
from backend.plugins.registry import PluginRegistry


PRESETS = {
    "assistant": ("General assistant", "An Agent and a Conversation for everyday questions and ideas."),
    "coding": ("Coding workspace", "An Agent, a Conversation and a Sandbox for building and running code."),
    "team": ("Multi-Agent collaboration", "A planner, a builder and a reviewer connected to one shared Conversation."),
}


def preset_record(preset_id: str, registry: PluginRegistry) -> LegionRecord:
    if preset_id not in PRESETS:
        raise NotFoundError(f"blueprint {preset_id!r} does not exist")
    name, description = PRESETS[preset_id]
    nodes: list[LegionTemplateNode] = []
    edges: list[LegionTemplateEdge] = []

    def node(key, type_id, label, x, y, *, config=None):
        definition = registry.node_type(type_id)
        handler = definition.template_handler
        nodes.append(LegionTemplateNode(
            key=key, parent_key=None if key == "group" else "group",
            type=type_id, plugin_id=registry.node_type_owner_id(type_id), name=label,
            position={"x": x, "y": y}, size={"width": definition.default_size[0], "height": definition.default_size[1]},
            expanded=False, status=definition.template_status or definition.default_status,
            config=registry.validate_config(type_id, config or {}),
            payload_version=handler.payload_version if handler else None,
            payload={} if handler else None,
            presentation={"level": "preview", "base_level": "preview"},
        ))

    def edge(source, target, relationship, direction="forward"):
        edges.append(LegionTemplateEdge(
            key=f"edge-{len(edges) + 1}", source=source, target=target, relationship=relationship,
            plugin_id=registry.relationship_owner_id(relationship), direction=direction,
        ))

    node("group", "legion", name, 0, 0, config={"mode": "group", "description": description})
    if preset_id == "team":
        for key, label, x, instruction in (
            ("planner", "Planner", 190, "Clarify the goal and coordinate a concrete plan with the Builder and Reviewer."),
            ("builder", "Builder", 510, "Implement the plan and report results to the Planner and Reviewer."),
            ("reviewer", "Reviewer", 830, "Review the proposed work, identify problems and verify the result."),
        ):
            node(key, "agent", label, x, 280, config={"system_instruction": instruction})
            edge(key, "conversation", "participate")
        node("conversation", "conversation", "Team conversation", 510, 700)
        edge("planner", "builder", "communicate", "bidirectional")
        edge("builder", "reviewer", "communicate", "bidirectional")
        edge("planner", "reviewer", "communicate", "bidirectional")
    else:
        node("agent", "agent", "Coding assistant" if preset_id == "coding" else "Assistant", 190, 280)
        node("conversation", "conversation", "Conversation", 550, 280)
        edge("agent", "conversation", "participate")
        if preset_id == "coding":
            node("sandbox", "sandbox", "Sandbox", 910, 280)
            edge("agent", "sandbox", "execute")

    now = datetime(2026, 9, 16, tzinfo=UTC)
    return LegionRecord(
        id=preset_id, name=name, description=description, created_at=now, updated_at=now, revision=1,
        blueprint=LegionBlueprint(bounds={"width": max(n.position.x + n.size.width for n in nodes),
                                          "height": max(n.position.y + n.size.height for n in nodes)},
                                  nodes=nodes, edges=edges),
    )
