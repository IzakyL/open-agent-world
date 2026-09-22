"""Library Papers: raw PDF and structured extractions as files of the node.

The node document holds only the reader's own layer (page, notes, annotations).
The PDF, page text, figure crops and versioned PaperStructure JSON are files in
the node's storage directory (see store.py); structure comes from GROBID (grobid.py).
"""
import asyncio

from pydantic import BaseModel, Field
from open_agent_world.plugin_api import (
    CapabilityDefinition, CapabilityGrantDefinition, NodeContainerDefinition, NodeDocumentAction,
    NodeDocumentDefinition, NodeLifecycleHandler, NodeLifecycleTransaction, NodeResourceAction,
    NodeTypeDefinition, PackDefinition, PluginDescriptor, RelationshipDefinition, ResourceValidationError,
)
from . import store
from .store import import_pdf

class RegionConfig(BaseModel):
    description: str = "A field of literature, agents and research data."

class PaperConfig(BaseModel):
    authors: str = ""
    year: str = ""
    doi: str = ""

class PaperDocument(BaseModel):
    page: int = 1
    notes: str = ""
    annotations: list[dict] = Field(default_factory=list)
    study_layout: bool = False
    study_title: str = "学习画布"

def annotate(value, args):
    page = int(args.get("page", value["page"]))
    if not 1 <= page <= 100_000:  # The page count lives with the raw PDF object, not this document.
        raise ResourceValidationError("Page is outside the PDF")
    annotations = list(value.get("annotations", []))
    if "annotation" in args:
        from uuid import uuid4
        item = args["annotation"]
        existing = next((a for a in annotations if a["id"] == item.get("id")), None)
        if not existing and len(annotations) >= 2000:
            raise ResourceValidationError("At most 2000 annotations per paper")
        rectangles = item.get("rects", [])
        if len(rectangles) > 500 or any(len(r) != 4 or any(not isinstance(x, (float, int)) or not 0 <= x <= 1 for x in r) for r in rectangles):
            raise ResourceValidationError("Invalid normalized selection rectangles")
        import re
        import math
        color = item.get("color", "#f4d144")
        title_color = item.get("title_color", existing.get("title_color", "#36423b") if existing else "#36423b")
        image = item.get("image", "")
        position = item.get("position", {"x": 0, "y": 0})
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ResourceValidationError("Invalid highlight color")
        if not isinstance(title_color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", title_color):
            raise ResourceValidationError("Invalid title color")
        if image and (not image.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")) or len(image) > 4*1024*1024):
            raise ResourceValidationError("Image must be PNG/JPEG, up to 4 MiB encoded")
        if not isinstance(position, dict) or any(not isinstance(position.get(k), (float, int)) or not math.isfinite(position[k]) or abs(position[k]) > 1e7 for k in ("x", "y")):
            raise ResourceValidationError("Invalid canvas position")
        identifier = existing["id"] if existing else str(item.get("id") or uuid4())[:100]
        annotations = [a for a in annotations if a["id"] != identifier]
        annotations.append({"id": identifier, "page": page, "text": str(item.get("text", ""))[:20000],
            "comment": str(item.get("comment", ""))[:20000], "translation": str(item.get("translation", ""))[:40000], "rects": rectangles,
            "title": str(item.get("title", ""))[:300], "color": color, "image": image,
            "title_color": title_color, "collapsed": bool(item.get("collapsed", existing.get("collapsed", False) if existing else False)),
            "learning": bool(item.get("learning", False)), "position": position})
    if "delete_annotation" in args:
        annotations = [a for a in annotations if a["id"] != args["delete_annotation"]]
    if "study_positions" in args:
        import math
        positions = args["study_positions"]
        valid_ids = {a["id"] for a in annotations if a.get("learning")}
        if not isinstance(positions, dict) or set(positions) != valid_ids:
            raise ResourceValidationError("Layout must include all current learning excerpts")
        for position in positions.values():
            if not isinstance(position, dict) or any(not isinstance(position.get(k), (int, float)) or not math.isfinite(position[k]) or abs(position[k]) > 1e7 for k in ("x", "y")):
                raise ResourceValidationError("Invalid layout position")
        annotations = [{**a, "position": positions[a["id"]]} if a["id"] in positions else a for a in annotations]
    return {**value, "page": page, "notes": str(args.get("notes", value["notes"]))[:100000], "annotations": annotations,
            "study_layout": True if "study_positions" in args else value.get("study_layout", False),
            "study_title": str(args.get("study_title", value.get("study_title", "学习画布"))).strip()[:100] or "学习画布"}

def read_notes(value, args):
    return {"notes": value["notes"], "page": value["page"]}


class ClearFiles(NodeLifecycleTransaction):
    def __init__(self, paper):
        self.paper = paper

    async def finalize(self):
        # Journaled by the host and retried after restart; the graph commit already happened.
        await asyncio.to_thread(self.paper.clear)


class PaperLifecycle(NodeLifecycleHandler):
    async def prepare_delete(self, context, node):
        return ClearFiles(store.PaperFiles(context.resources.node_storage_path(node.id)))


STRUCTURE_TOOL = ("Read this paper's structured extraction (schema 1.0, produced by GROBID). Without path it returns an "
    "overview: metadata, abstract, section/figure/table outline and warnings. Pass a dotted path such as 'sections.2', "
    "'references' or 'metadata.authors' for details. Large values return an outline; request a narrower path.")
REVISE_TOOL = ("Create a new extraction version by revising the active one. Read it first and pass its version as base_version. "
    "Each change: op set|append|remove, a dotted path (e.g. 'metadata.title', 'sections.0.blocks.1.text', "
    "'references', 'domain.materials') and a value for set/append. Fix only what the PDF text supports "
    "(check with read_paper); the GROBID version stays available.")
EXTRACT_TOOL = ("Run GROBID on this paper again in the background, for example when there is no extraction yet or "
    "it was interrupted. The result becomes a new active version; your earlier revisions stay available.")

# Inline (no $ref) so every model provider accepts it; store.Revision validates the same shape.
REVISE_SCHEMA = {"type": "object", "required": ["base_version", "changes"], "additionalProperties": False, "properties": {
    "base_version": {"type": "string", "maxLength": 20, "description": "The version you read, e.g. v1"},
    "note": {"type": "string", "maxLength": 500, "description": "What you changed and why"},
    "changes": {"type": "array", "minItems": 1, "maxItems": 200, "items": {"type": "object", "required": ["op", "path"],
        "additionalProperties": False, "properties": {
            "op": {"type": "string", "enum": ["set", "append", "remove"]},
            "path": {"type": "string", "maxLength": 200},
            "value": {"description": "New value for set/append (any JSON)"}}}}}}


class LibraryPlugin:
    descriptor = PluginDescriptor(id="research.library", version="0.3.0",
        plugin_api_version="1.24", name="Library", description="PDF reading, structured extraction and native research spaces")

    async def read_paper(self, context, capability, arguments):
        page = await context.node_resource_action(capability, "page_text", arguments)
        document = await context.node_document_action(capability, "read", {})
        return {**page, "notes": document["value"]["notes"]}

    async def read_structure(self, context, capability, arguments):
        return await context.node_resource_action(capability, "structure", arguments)

    async def revise_structure(self, context, capability, arguments):
        return await context.node_resource_action(capability, "revise", arguments)

    async def reextract(self, context, capability, arguments):
        return await context.node_resource_action(capability, "agent_extract", arguments)

    def register(self, registration):
        common = dict(color="#70a79a", deck_id="objects", deck_label="Objects", deck_icon="boxes",
                      default_status="available", statuses=frozenset({"available"}))
        registration.register_node_type(NodeTypeDefinition(id="library.region", label="Library",
            description="Literature field with native movable members", icon="library", default_name="New Library",
            default_size=(1100, 800), config_model=RegionConfig, container=NodeContainerDefinition(content_inset=(24,150,24,32)),
            frontend={"body":"region"}, user_creatable=False, templateable=True, **common))
        registration.register_node_type(NodeTypeDefinition(id="library.paper", label="Paper", description="PDF, structured content and reading notes",
            icon="book-open", default_name="Paper", default_size=(300,210), config_model=PaperConfig,
            traits=frozenset({"library.readable"}), templateable=True, deck_revision=3, lifecycle=PaperLifecycle(),
            frontend={"preview":"thumbnail", "body":"reader", "workspace":"reader"},
            surfaces={"preview":True,"inspector":True,"workspace":True},
            deletion_warning="Deleting this Paper permanently removes its PDF and every structured extraction version. Canvas undo and templates do not preserve them.",
            served_files=store.SERVED_FILES,
            resource_actions={
                "import": NodeResourceAction(store.import_pdf),
                "manifest": NodeResourceAction(store.manifest_action),
                "extract": NodeResourceAction(store.reextract),
                "activate": NodeResourceAction(store.activate),
                "page_text": NodeResourceAction(store.page_text, capability_kind="library.read"),
                "structure": NodeResourceAction(store.read_structure, capability_kind="library.structure"),
                "revise": NodeResourceAction(store.revise, capability_kind="library.curate"),
                "agent_extract": NodeResourceAction(store.agent_reextract, capability_kind="library.extract"),
            },
            document=NodeDocumentDefinition(model=PaperDocument, max_size_bytes=48*1024*1024,
                actions={"annotate":NodeDocumentAction(annotate),
                         "read":NodeDocumentAction(read_notes, read_only=True, project=True, capability_kind="library.read")}), **common))
        registration.register_capability(CapabilityDefinition(kind="library.read", tool_name="read_paper",
            description="Read extracted plain text and your notes for one PDF page. Scanned pages may have no text.",
            input_schema={"type":"object","properties":{"page":{"type":"integer","minimum":1}},"additionalProperties":False}), self.read_paper)
        registration.register_capability(CapabilityDefinition(kind="library.structure", tool_name="read_paper_structure",
            description=STRUCTURE_TOOL, input_schema={"type":"object","properties":{
                "path":{"type":"string","maxLength":200,"description":"Dotted path, e.g. sections.2 or references.0"},
                "version":{"type":"string","maxLength":20,"description":"Extraction version; defaults to the active one"}},
                "additionalProperties":False}), self.read_structure)
        registration.register_capability(CapabilityDefinition(kind="library.curate", tool_name="revise_paper_structure",
            description=REVISE_TOOL, input_schema=REVISE_SCHEMA), self.revise_structure)
        registration.register_capability(CapabilityDefinition(kind="library.extract", tool_name="reextract_paper",
            description=EXTRACT_TOOL, input_schema={"type":"object","properties":{
                "note":{"type":"string","maxLength":500,"description":"Why a fresh GROBID run is needed"}},
                "additionalProperties":False}), self.reextract)
        registration.register_relationship(RelationshipDefinition(id="library.read",label="Read paper",short_label="read",
            description="Read this paper's text and structured extraction",source_traits=frozenset({"core.agent"}),
            target_traits=frozenset({"library.readable"}),
            capabilities=(CapabilityGrantDefinition(kind="library.read"),CapabilityGrantDefinition(kind="library.structure")),templateable=True))
        registration.register_relationship(RelationshipDefinition(id="library.curate",label="Curate structure",short_label="curate",
            description="Read this paper and publish revised extraction versions; earlier versions are kept",
            source_traits=frozenset({"core.agent"}),target_traits=frozenset({"library.readable"}),
            capabilities=(CapabilityGrantDefinition(kind="library.read"),CapabilityGrantDefinition(kind="library.structure"),
                          CapabilityGrantDefinition(kind="library.curate"),CapabilityGrantDefinition(kind="library.extract")),templateable=True))
        registration.register_relationship(RelationshipDefinition(id="library.research",label="Research",short_label="research",
            description="Associate an Agent with a library; membership alone grants no paper access.",
            source_traits=frozenset({"core.agent"}),target_types=frozenset({"library.region"}),templateable=True))
        registration.register_pack(PackDefinition(id='research.library.default', name='Research Library',
            description='Papers and reading spaces.', cards=tuple(registration.nodes)))

def create_plugin():
    return LibraryPlugin()
