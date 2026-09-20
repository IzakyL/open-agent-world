# Default Agent context management

The OAW-owned `google.adk` runtime automatically manages context without exposing
compaction controls. Model window/output limits live in Settings > Models. A provider ID, registry ownership and the installed runtime
implementation select this path; the `core.agent` trait does not. Other runtime
providers retain their existing continuation behavior.

`agent_contexts` in the existing SQLite database stores private checkpoints by
`(agent_id, context_id)`. Conversation context IDs are session IDs. Each checkpoint
contains a rolling summary, a recent structured content tail (including tools),
the canonical conversation cursor, usage calibration and compaction count.
Foreign keys clean up deleted Agents and sessions. An additive table creation
upgrades existing databases. None of this is Agent Card configuration or exposed
through the state tools. ConversationStore remains the canonical message history.

Before **every model call**, including calls within a long tool loop, the runtime
renders the checkpoint, unseen conversation messages, current task and fresh
instructions/tools. It no longer appends a repeated 40-message transcript. ADK's
transient event log is reset between invocations while retaining ADK session state.
One Agent/session serializes checkpoint mutations; different pairs are independent.
ADK 2 can assemble a later model request before its public tool events are consumed.
The model hook reconciles that actual request with observed events, retaining each
part once even after compaction. Usage is calibrated in the model response callback.

Each configured model stores `context_window` (default 128,000) and
`max_output_tokens` (default 8,192) in the existing versioned model catalog. The
fields appear under the model's collapsible **Context & output limits** section.
They are positive integer settings; the window is at least 1,024 and output must
be smaller than the window. Old catalog rows receive these defaults when read,
and saving persists the values alongside the model. No new database table or
destructive migration is needed. Values are scoped to the connection's stable
model reference, so identical model IDs on different connections remain separate.
The configured default model resolves through the same reference.

Configured limits take precedence without model-name matching or provider
discovery. New runs read the latest saved values; in-flight runs retain their
budget. The output value is sent as the model generation cap and reserved when
calculating input space. Safe input is `floor((context_window - max_output_tokens)
* 0.85)`, with a one-token lower bound. Thus even an unusually large output
reservation cannot make input plus output exceed the configured window. Settings
cannot expand an endpoint's actual capacity. Other plugin runtimes retain ownership
of their own generation/continuation settings.

For legacy raw runtime model strings with no catalog reference, the previous
installed LiteLLM metadata fallback still supplies the model input limit and output cap.
Resolution preserves exact provider entries, then matches compatible adapter
prefixes and model-name casing. A small verified fallback covers newly released
DeepSeek V4.1 Flash names missing from the installed map; its published window is
[1M tokens](https://api-docs.deepseek.com/quick_start/pricing/). It does not change
the model ID sent to the configured endpoint. Unknown/private model names use a
32,768-token rolling compaction target, not a claimed provider limit: the API's
`context_limit` is zero and fixed request overhead cannot cause a local rejection
against this provisional target. The provider still enforces its own limits.
In that legacy path only, output reserve is the smaller of the model output cap,
8,192 and one eighth of the input limit. A further 15% of the remaining input
space leaves tool/runtime growth and safety headroom. Pressure is
rendered input divided by this safe input budget, clamped to 0–1. Provider prompt
usage takes precedence, with estimated deltas for subsequent growth; otherwise a
conservative UTF-8 estimate includes instructions and tool schemas. This is
**context pressure**, not an exact context-window utilization percentage.

At 85% of that budget the state becomes `high`; at 100% a generic compaction pass
folds the older contents and prior snapshot into a new checkpoint using the same
configured ADK model adapter and connection, without tools. It preserves goals,
facts, decisions, uncertainties, execution outcomes and artifact/resource paths.
A token-sized recent tail is retained, after allowing for the fixed instructions
and tool schemas, with tool call/result groups kept together.
Oversized histories/tool bodies are summarized in bounded chunks. Checkpoints
commit only after successful reduction. A summary that reaches `MAX_TOKENS`
(including ADK's error-code representation) gets at most two retries with a
doubled generation allowance, bounded by the provider output cap, 32K tokens and
remaining safe input/output space. This leaves room for reasoning as well as the
short checkpoint text. Retries repeat only the tool-free summary request. Empty,
oversized, rejected or still-truncated summaries retain the previous context and
surface a normal Run failure; a later turn can retry. Interrupted tool calls get an explicit unknown-outcome result so
continuation cannot assume either success or permission to repeat a side effect.

This adopts the lifecycle described in the
[OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction):
grow, measure, compact, continue, repeat. It uses a **generic rolling snapshot**,
not OpenAI encrypted/native compaction or a separate Responses API transport.

REST conversation summaries expose only session/Agent `ContextStatus` projections.
The existing event hub publishes `context_status` invalidations on 5% pressure
buckets and state/count changes. The Conversation participant avatar reads the
selected session's projection; message avatars have no rings. Hover gives pressure
and count, with no token counters, settings or compaction toast. Reconnect reloads
the authoritative snapshot; reduced-motion preferences disable animation.

Limitations: summarization is lossy and adds model calls/latency. Scripted-model
tests exercise the real ADK runner and tools, not live-model factual retention.
Metadata can be missing or inaccurate for a proxy/private alias, and an endpoint
may impose a smaller window than its upstream model. For a known window, a current message
or tool schema larger than the remaining safe budget fails explicitly instead of
silently truncating it. Provider-native hidden continuation, ADK process-local
session state and interrupted Run resumption remain subject to existing runtime
limitations; OAW checkpoints and raw tails survive restart. Existing execution
deadlines and inactivity policies still apply to compaction calls.

Validation: 15 new backend tests cover the real ADK runner with a scripted model,
repeated in-turn tool compaction, continuation, history retention, independent
scope/status, restart, failure/cancellation, usage/event buckets, plugin exclusion,
session deletion, interrupted tools, peer-stream updates, scope locks and oversized
current input, ADK event ordering and Stop/continue cleanup. The final related
Conversation/Run/streaming/persistence group passes 78 tests. The broader backend
suite (before the last two added cases) reports 863 passed, 26 skipped and three recursive
summoning result-text failures; all three also reproduce with the changed backend
modules loaded from unmodified HEAD `756dc6d`. The frontend suite passes 451 tests
(before the added ring test), and the final focused UI/store/timeline/i18n group
passes 69. Production build and final TypeScript checks pass. An isolated Chrome
test verifies ring geometry, session switching, pressure reduction, reduced motion
and missing-status fallback; its REST pressure projection is controlled test data.

Follow-up regression coverage adds compatible model-name resolution, exact
provider limit precedence, a fresh Conversation with a large ADK tool schema and
no inherited checkpoint, provisional unknown-model budgets, reasoning-exhausted
summary retries, output-cap enforcement and retained checkpoints on exhaustion
or rejection. Read-only inspection of the reported MatCreator failures confirmed
separate contexts: the fresh Conversation retained one message, while the older
one retained 384. Both were mistakenly budgeted at 8K under
`openai/DeepSeek-V4.1-Flash`. Live checks through the configured adapter used only
synthetic input: a 1,024-token summary budget produced `MAX_TOKENS`, no text and
1,024 reasoning tokens; an 8,192-token budget returned a complete text summary.
No real conversation was replayed and no agent tools were executed by the check.
The final related backend regression group passes 85 tests. Loading this fix in
an already running backend requires restarting that process; persisted histories
and checkpoints need no reset or manual migration.

Configured-limit validation: 110 related backend tests pass, including catalog
defaults, old JSON compatibility, persistence/restart, invalid values, connection
isolation and a real ADK runner applying changed limits on the next invocation.
All 454 frontend tests pass with two workers, and the production build passes.
The isolated Chrome model-settings test verifies default values, editing, saving,
reload, connection isolation, Chinese labels and narrow layouts; rendered screenshots
were inspected. This is isolated browser coverage, not a live-model conversation
or embedded-browser check. Configured model limits require no metadata requests.
