from open_agent_world.plugin_api import LegionPresetDefinition, PresetNode, PresetEdge


INSTRUCTION = """You are MatCreator, a computational materials research assistant in OAW.
Use the connected research task board, scientific Toolsets, Know-Do Graph and Sandbox.
Answer simple questions directly. For computational work follow this research loop:
1. Clarify the scientific objective, inputs, constraints and success criteria. Do not invent missing simulation parameters.
2. Read the task board and select the plan for this conversation session (use its session ID when available).
   Create a new named plan for a new objective, with stable task IDs and explicit dependencies.
   Read relevant skills and search knowledge before choosing methods. Explain the plan in the conversation.
3. Execute only authorized work through OAW Sandbox tools. Inspect runtime, environment and available packages first.
   Use a separate output directory per plan/session. Record each task as running before execution.
   Respect existing user authorization; ask only for missing scientific choices or new sensitive actions.
4. Verify outputs, units and scientific assumptions. Record concrete evidence and relative output paths before marking done.
   Mark failures or missing requirements blocked with a reason, revise the plan, and continue independent work.
   After interruption inspect real commands/files before resuming; a task marked running does not prove a command is still running.
5. Summarize results and limitations in the conversation and save useful execution experience to the Know-Do Graph.
   Knowledge review remains explicit; unverified experience is not established scientific knowledge.
Read the latest task-board revision before each edit. On a revision conflict reread and reconcile, never overwrite another edit.
Task statuses are a research ledger, not a scheduler or Stop button. Execution, approval, cancellation and sessions belong to OAW.
Do not use MatCreator's original shell/session server or assume its tools exist. Adapt skill examples to the actual authorized OAW tools.
"""


def view(card, section=None):
    return {"card_id": card, **({"section_id": section} if section else {})}


def pane(card, section=None):
    return {"kind": "pane", "view": view(card, section)}


def tabs(*views):
    return {"kind": "tabs", "views": list(views), "active_view": views[0]}


def split(axis, ratio, first, second):
    return {"kind": "split", "axis": axis, "ratio": ratio, "first": first, "second": second}


def definition():
    layout = {"version": 2, "hidden_sections": [], "root": split("horizontal", .22,
        split("vertical", .45, pane("conversation", "sessions"), pane("sandbox", "files")),
        split("horizontal", .51, pane("conversation", "conversation"),
            split("vertical", .66,
                tabs(view("tasks"), view("sandbox", "preview"), view("knowledge"), view("conversation", "participants")),
                pane("sandbox"))))}
    nodes = [
        PresetNode(key="group", type="legion", name="MatCreator research", parent_key=None, presentation="preview",
                   config={"mode": "group", "description": "Materials research: plan, execute, verify and learn.", "workspace_layout": layout}),
        PresetNode(key="agent", type="agent", name="MatCreator", x=180, y=220,
                   config={"system_instruction": INSTRUCTION}),
        PresetNode(key="conversation", type="conversation", name="Research conversation", x=540, y=220),
        PresetNode(key="sandbox", type="sandbox", name="Research files & compute", x=900, y=220),
        PresetNode(key="tasks", type="matcreator.tasks", name="Research tasks", x=180, y=720),
        PresetNode(key="knowledge", type="matcreator.kdg", name="Research knowledge", x=900, y=720),
    ]
    edges = [PresetEdge(source="agent", target=target, relationship=relationship) for target, relationship in (
        ("conversation", "participate"), ("sandbox", "execute"),
        ("tasks", "matcreator.tasks.manage"), ("knowledge", "matcreator.kdg.learn"))]
    for index, (key, name) in enumerate((("core", "Materials Core"), ("simulation", "Atomistic Simulation"),
                                       ("ai", "Materials AI"), ("research", "Research / Remote Compute"))):
        nodes.append(PresetNode(key=key, type="matcreator." + key, name=name,
                               x=180 + (index % 2) * 1400, y=1540 + (index // 2) * 1500))
        edges.append(PresetEdge(source="agent", target=key, relationship="matcreator." + key + ".use"))
    return LegionPresetDefinition(id="matcreator.research", name="MatCreator research",
        description="Materials research with sessions, files, conversation, a task board and scientific skills.",
        nodes=tuple(nodes), edges=tuple(edges))
