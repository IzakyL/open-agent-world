"""Recover rejected tool arguments before ADK dispatches any tools."""

from __future__ import annotations

import json

from google.adk.models.lite_llm import LiteLlm
from google.genai import types


class ResilientLiteLlm(LiteLlm):
    """Let the model correct malformed arguments, without replaying a run.

    ADK already repairs several complete object-literal formats. Ambiguous
    syntax (especially quotes inside code) must be regenerated, not guessed.
    Recovery contents are request-local and never change stored user messages.
    """

    async def generate_content_async(self, llm_request, stream=False):
        request = llm_request.model_copy(update={"contents": list(llm_request.contents)})
        for attempt in range(3):
            published = False
            try:
                async for response in super().generate_content_async(request, stream=stream):
                    published = True
                    yield response
                return
            except json.JSONDecodeError as exc:
                # Only ADK's tool-argument decoder is recoverable here. Provider
                # transport JSON errors and already-published streams propagate.
                traceback = exc.__traceback__
                tool_arguments = False
                while traceback is not None:
                    frame = traceback.tb_frame
                    if (frame.f_globals.get("__name__") == "google.adk.models.lite_llm"
                            and frame.f_code.co_name == "_parse_tool_call_arguments"):
                        tool_arguments = True
                    traceback = traceback.tb_next
                if not tool_arguments or published:
                    raise
                if attempt == 2:
                    raise RuntimeError(
                        "Tool arguments remained invalid after 2 correction attempts "
                        f"({exc.msg}, line {exc.lineno}, column {exc.colno}). "
                        "No tools from the rejected responses were executed. "
                        "Try splitting the operation into smaller tool calls."
                    ) from None
                # Bound context growth and never quote the raw payload in errors
                # sent to the UI/logs. It goes only to the same configured model.
                excerpt = exc.doc[:12000]
                request.contents.extend([
                    types.Content(role="model", parts=[types.Part.from_text(
                        text="Rejected tool argument payload (possibly truncated):\n" + excerpt
                    )]),
                    types.Content(role="user", parts=[types.Part.from_text(text=(
                        "Runtime feedback: your last tool-call response could not be parsed: "
                        f"{exc.msg}, line {exc.lineno}, column {exc.colno}. "
                        "No tool in that response was executed. Regenerate the required tool "
                        "calls using valid JSON objects matching their schemas. Escape quotes, "
                        "backslashes and newlines inside strings. Do not repeat tools from "
                        "earlier successful responses. Split large operations if needed."
                    ))]),
                ])
