# Minister

Minister is a privileged role applied to an existing Agent with a **Minister role**
card from the Core essentials pack. Add it to a deck, then drag it directly onto an
Agent, or place it on the canvas first and drag that card onto the Agent. The role
card is absorbed and the Agent gains a crown badge and a promotion animation,
then rests as a compact circular node. The circle shows a small, centered crown
symbol. This default is applied on promotion; later surface choices stay persisted.
Ordinary Agent inspectors do not contain an appointment button.
Its name, card type, model, runtime, settings, ports and existing tools stay intact.
Hover or click the crown to talk on the canvas. Open the Agent card and select its
**Minister** tab for radius, canvas-edit permission, nearby cards and confirmations.
The same tab appears in the Agent workspace alongside **Activity** and **Settings**.
History uses the existing Agent workspace; there is no separate Minister management
window. The Agent's own settings, including plugin settings, remain in **Settings**.

The full-width **Remove Minister role** button explains that the Agent is retained.
It revokes canvas tools immediately and leaves the Agent,
its original permissions and its Conversation history intact. Reappointment reuses
the same private chat. Promotion does not configure a model or replace a runtime.
Builtin, Codex and future plugins with the ordinary `core.agent` contract all use
the same role path.

New Ministers have **Allow canvas edits** enabled. Turn it off to pause administration;
existing explicitly disabled Ministers stay disabled. New Ministers have a radius of 1200 canvas units. The area preview appears while hovering over the badge or using its settings. Drag the radius handle or
enter a radius from 200 to 3000. The circle follows the node, and every affected
card's saved rectangle must fit inside it. Glued surface rectangles are checked too.
Only the user can move a Minister or change its control radius/authority.

**Nearby cards** searches names, types and IDs. Inspection includes the controller
identity, positions, connections, container membership, glue, public configuration,
and available card/relationship policies. Private Minister control chats and raw
secrets are excluded. Pair inspection explains supported relationships before a call.

## Local administration

### Visual observation

An Agent with the Minister role can call `canvas_observe` to inspect the current
rendered cards in its jurisdiction. This works with both the ordinary Google ADK
runtime (including LiteLLM model connections) and the Codex plugin when the selected
model supports image inputs and tool calling. Text-only models do not gain vision.

Keep an OAW canvas open. The host requests a capture from a connected frontend,
which returns actual rendered card pixels and internal connection paths, arranged
in canvas coordinates. Capturing does not pan the user's viewport or control the
desktop mouse. Images include scope coordinates, revisions, and captured/missing
card IDs. Use `canvas_inspect` for complete saved state, existing Minister tools to
make changes, and `canvas_observe` again to inspect the result.

This is a filtered card capture, not a full desktop screenshot. Unmounted offscreen
cards, workspace surfaces, containers without a standard card header, and cards
whose rendered revision is stale are reported as missing. Inspector settings,
private chats, and plugin bodies are excluded. Built-in text/image previews require
an independent read/view connection; being inside the circle does not grant content
access. Reading an entire image through its `view_image` tool remains available.
The browser uses DOM rasterization; arbitrary iframe, video and WebGL capture and
general coordinate-based clicking are not supplied by this tool.

Role, scope, revisions and preview grants are rechecked after capture. A changed
area requires a fresh observation. Missing frontends, disconnects and timeouts give
actionable tool feedback. Waiting for pixels does not lock world editing. Screenshots
are model context, not instructions; image bytes are excluded from activity events.
The selected provider may retain images in its own session according to its settings.

Plugin tool authors can return `VisualToolResult(metadata, (ToolImage(bytes,
media_type),))` from `open_agent_world.plugin_api`. Both runtime adapters translate
this provider-neutral result into visual input; existing JSON-only tools keep their
behavior. Images are bounded to 8 MiB per result and four images, with dimension and
media-type validation. Model/server support is required; unsupported visual requests
surface the provider error rather than silently converting images into text.

Minister can create normal cards, including Agents; move, rename and resize cards;
change normal configuration; connect/disconnect supported relationships; group
root cards into a Legion; change container membership; attach/detach equipment;
and glue/unglue root card surfaces. A card-update batch uses the existing atomic
service operation for layout or configuration changes.

Grouping uses existing Legion geometry, so the whole resulting container must fit
inside the circle. Ungrouping detaches selected members and preserves their cards
and container. Deleting the empty container is a separate reviewed action. Glue
is a physical canvas bond, distinct from capability connections and owned equipment.
Its existing surface/bond data now uses shared revisioned state; browser gestures
and background actors see the same layout. Moving a glued card also moves peers.

The host decides each mutation's risk before lifecycle effects or persistence:

| Decision | Behavior |
| --- | --- |
| **ALLOW** | Normal local creation, structure and public writable configuration execute directly. |
| **CONFIRM** | Deletion, sensitive settings, explicitly marked sensitive plugin initialization and dangerous grants show a persistent review bubble beside Minister on the canvas, also available in the Agent's Minister tab. Nothing is applied until the user confirms. |
| **DENY** | Raw secrets, immutable/internal fields, boundary bypasses and changes to Minister authority cannot be approved through a Minister tool. |

Reviews list affected cards, connections, access changes and relevant resources/runs.
Sandbox host folder, network and runtime changes are confirmable. Execution,
environment/credential access and other sensitive relationships are confirmable;
their existing validators and lifecycle rules still apply. Connecting an ordinary
Agent to a Text or Conversation is normal local administration. Connecting Minister
itself is supported for its approved relationships; it cannot grant itself dangerous
access. Existing host-granted Agent tools remain available after promotion.

Approval is a desktop management action, absent from Agent tools. It is bound to
the exact proposed request and effects; scope, object incarnations/revisions and
effects are rechecked under the existing mutation barrier. A stale/revoked proposal
must be inspected and proposed again. Unanswered reviews do not time out, and their
canvas bubbles survive closing chat and refreshing the page. Reviews remain in memory
until backend restart and can only be decided once. They are not durable grants or general undo.
After a successful confirmation, the review resumes the existing conversation so
Minister can inspect the result and continue. Later sensitive actions still need review.

## Chat setup and completion

For “set up a place where I can chat with an agent”, Minister should make a short
goal/requirements plan, then provide a visible Conversation, an ordinary Agent
(create one if needed using the host's default model), a participate connection,
General membership and sensible spacing. A Text card or the private Minister
control chat does not complete that request. Minister itself participates when
the user asks to chat with Minister.

After changes, inspect completion criteria. Chat readiness distinguishes configured
message routing from an observed reply. An untested model reply must not be described
as verified. Reuse partial setups and preserve the goal across “try now”.

## Current implementation boundaries

The host stores `Card.minister` separately from plugin-owned `config`. A null value
means no role; a role contains `control_radius` and `allow_canvas_edits`. Only Agent
types may carry it. The existing broker adds Minister tools to normal graph tools,
and RunManager adds the role instruction to the original Agent instruction. Every
tool invocation still checks the live grant. No role registry or Minister runtime
is introduced. Role settings apply live; role instructions are composed per run.

On startup, a narrow transaction migrates legacy `core.minister` rows to `agent`
plus the role. It retains IDs, names, geometry, runtime/model settings, owned chats
and graph links, and removes only the old role fields and recognized default role
instructions from Agent config. Collected inventory and deck entries for the old
Minister card become the new Minister role card in the same deck position.
The migration is idempotent. Animation state is transient and is never reconstructed
from persisted roles, so reopening the workspace restores the badge without replay.

The role card (`core.minister-role`) is inert and has no Agent runtime or privileges.
The host appointment endpoint checks current card revisions and commits its
consumption and the role grant atomically. A failed or stale drop preserves the
source card. Detach a placed role card from groups, equipment, connections or glue
before applying it. A deck drop uses the catalog card directly, like other palette
transformations. The deck entry remains reusable. This action is absent from Agent tools.

The tools administer saved card configuration and structure. They do not yet edit
arbitrary plugin document bodies, enter credential values, start arbitrary runtime
actions, import blueprints or offer general undo. These are implementation limits,
not product rules against Ministers administering special card types. Secret entry
continues through the existing host credential UI. Creation of managed collection
members continues to require that collection's dedicated operation.

The Minister harness and tools add a small risk policy and review queue around
ApplicationServices.canvas_control. The facade validates scope, schemas,
consequences and revisions; existing services own mutations and lifecycle
compensation. Ordinary plugin creation, declared configuration fields and connections
are allowed by default. Plugins mark sensitive initialization and capability grants
with `canvas_create_requires_confirmation=True` and `canvas_requires_confirmation=True`,
and sensitive configuration fields with `privileged: true` in schema metadata. Existing generic
automation grants keep their original config restrictions.

Tests exercise real tools, persistence, lifecycle and events, including concurrent
Minister edits, human conflicts, confirmed/rejected/stale proposals, grouping,
equipment, shared glue, sensitive grants, and the supplied Chinese chat scenario.
Run npm run test:e2e:minister from frontend for isolated browser checks. Its
deterministic provider invokes real tools; these tests do not prove a production
language model's planning quality or contact a model service.
