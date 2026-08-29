"""Thin client for the OpenCode Go endpoint.

OpenCode Go is OpenAI-compatible, so this is a plain HTTP call rather than a
vendor SDK. Keeping it dependency-free makes the deployment package smaller and
means switching model or provider is a config change.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

import boto3
import httpx

from app.config import settings

log = logging.getLogger(__name__)


class LLMDisabled(Exception):
    """Raised when AI_ENABLED is false."""


class LLMError(Exception):
    pass


@lru_cache(maxsize=1)
def _api_key() -> str:
    ssm = boto3.client("ssm")
    resp = ssm.get_parameter(Name=settings.llm_key_param, WithDecryption=True)
    value = resp["Parameter"]["Value"]
    if not value or value == "PLACEHOLDER-SET-ME":
        raise LLMError(
            "The OpenCode API key has not been set. "
            f"Run: aws ssm put-parameter --name {settings.llm_key_param} "
            "--type SecureString --value '<key>' --overwrite"
        )
    return value


def _post(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Single round trip. Returns (message, finish_reason)."""
    try:
        with httpx.Client(timeout=90) as client:
            resp = client.post(
                f"{settings.llm_base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {_api_key()}",
                    "Content-Type": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        raise LLMError(f"Could not reach the model provider: {exc}") from exc

    if resp.status_code != 200:
        # Never echo the provider body verbatim; it can contain the prompt.
        log.error("LLM call failed: %s", resp.status_code)
        raise LLMError(f"Model provider returned HTTP {resp.status_code}.")

    body = resp.json()
    try:
        choice = body["choices"][0]
    except (KeyError, IndexError) as exc:
        raise LLMError("Unexpected response shape from the model provider.") from exc

    usage = body.get("usage", {}).get("completion_tokens_details", {})
    log.info(
        "llm finish=%s reasoning_tokens=%s",
        choice.get("finish_reason"),
        usage.get("reasoning_tokens"),
    )
    return choice.get("message", {}), str(choice.get("finish_reason") or "")


def complete(
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
    json_object: bool = False,
    temperature: float = 0.1,
    max_tokens: int = 4000,
    reasoning_effort: str = "low",
) -> dict[str, Any]:
    """One round trip to /chat/completions. Returns the first choice's message.

    `glm-5.3-flash` is a reasoning model and its thinking cannot be turned off —
    the provider rejects `thinking: disabled` outright. Reasoning tokens are
    billed against `max_tokens`, so an undersized budget is spent entirely on
    thinking and the answer comes back with an empty `content` and
    `finish_reason: "length"`. `reasoning_effort: "low"` cuts thinking from
    ~1600 tokens to ~150 on the extraction prompt with no loss of quality, and
    the budget below leaves ample room for the answer itself.
    """
    if not settings.ai_enabled:
        raise LLMDisabled()

    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "reasoning_effort": reasoning_effort,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if json_object:
        payload["response_format"] = {"type": "json_object"}

    message, finish = _post(payload)

    # Belt and braces: if thinking still ate the whole budget, retry once with
    # double the room rather than failing in front of the user.
    empty = not (message.get("content") or "").strip() and not message.get("tool_calls")
    if empty and finish == "length":
        log.warning("model exhausted %s tokens on reasoning; retrying larger", max_tokens)
        payload["max_tokens"] = max_tokens * 2
        message, finish = _post(payload)
        if not (message.get("content") or "").strip() and not message.get("tool_calls"):
            raise LLMError(
                "The model spent its whole response budget thinking and returned "
                "nothing. Try a shorter note."
            )

    return message


def parse_json_content(content: str) -> dict[str, Any]:
    """Models occasionally wrap JSON in a code fence despite json_object mode."""
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise LLMError("The model did not return JSON.")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise LLMError("The model returned malformed JSON.") from exc
