"""Natural-language questions over the whole database.

Two stages: the model calls tools to retrieve or aggregate, then it phrases an
answer from the tool results. The loop is capped so a confused model cannot
burn tokens indefinitely.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app import repository
from app.llm import client
from app.llm.tools import TOOL_SPECS, ToolRunner, summarize
from app.models import ChatResponse, utcnow

log = logging.getLogger(__name__)

MAX_ROUNDS = 5

SYSTEM_PROMPT = """You are the assistant for a private personal address book. \
The user stores facts about people they know and asks you questions about them.

Today is {today}.

You can see this index of everyone stored (id | name | job @ company | city | tags):
{index}

Rules:
- The index is only an index. For any detail beyond it, call get_person or search_notes.
- For ANY count, comparison or numeric threshold, call filter_people. Never count \
or compare numbers yourself, and never estimate.
- Answer only from tool results and the index. If the data does not contain the \
answer, say so plainly and suggest what the user could record.
- Refer to people by name, never by id, in your final answer.
- Be brief. Two or three sentences unless a list is genuinely needed.
- Some people may be excluded from AI features and will not appear. Do not \
speculate about who is missing."""


def _tool_arguments(call: dict[str, Any]) -> dict[str, Any]:
    raw = (call.get("function") or {}).get("arguments") or "{}"
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        log.warning("model produced non-JSON tool arguments")
        return {}


def ask(sub: str, history: list[dict[str, str]]) -> ChatResponse:
    people = repository.list_people(sub)
    runner = ToolRunner(sub, people)

    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT.format(today=utcnow()[:10], index=runner.index_for_prompt()),
        }
    ]
    for turn in history[-20:]:
        role = turn.get("role")
        if role in ("user", "assistant") and turn.get("content"):
            messages.append({"role": role, "content": turn["content"]})

    trace: list[str] = []

    for _ in range(MAX_ROUNDS):
        message = client.complete(messages, tools=TOOL_SPECS, temperature=0.1, max_tokens=1200)
        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            answer = (message.get("content") or "").strip()
            return ChatResponse(
                answer=answer or "I could not work that out from what is stored.",
                people=[summarize(p) for p in runner.referenced.values()],
                tool_trace=trace,
            )

        messages.append(
            {
                "role": "assistant",
                "content": message.get("content") or "",
                "tool_calls": tool_calls,
            }
        )

        for call in tool_calls:
            name = (call.get("function") or {}).get("name", "")
            args = _tool_arguments(call)
            result = runner.run(name, args)
            trace.append(f"{name}({json.dumps(args, ensure_ascii=False)})")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "name": name,
                    "content": result,
                }
            )

    # Out of rounds: force a final answer without tools.
    messages.append(
        {
            "role": "user",
            "content": "Answer now using only what the tools already returned.",
        }
    )
    final = client.complete(messages, temperature=0.1, max_tokens=800)
    return ChatResponse(
        answer=(final.get("content") or "I could not work that out.").strip(),
        people=[summarize(p) for p in runner.referenced.values()],
        tool_trace=trace,
    )
