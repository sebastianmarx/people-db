"""Privacy filter applied to every payload before it leaves AWS.

Two mechanisms:
  * per-person `ai_optout` — the record is dropped entirely;
  * AI_REDACT_FIELDS — dotted paths stripped from every record.

Widening the redact list improves privacy at the cost of the chat being able to
answer questions about those fields.
"""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.models import Person


def strip_paths(data: dict[str, Any], paths: tuple[str, ...]) -> dict[str, Any]:
    out = dict(data)
    for path in paths:
        parts = path.split(".")
        cursor: Any = out
        for part in parts[:-1]:
            if not isinstance(cursor, dict) or part not in cursor:
                cursor = None
                break
            cursor[part] = dict(cursor[part]) if isinstance(cursor[part], dict) else cursor[part]
            cursor = cursor[part]
        if isinstance(cursor, dict):
            cursor.pop(parts[-1], None)
    return out


def visible_people(people: list[Person]) -> list[Person]:
    return [p for p in people if not p.ai_optout]


def person_for_llm(person: Person) -> dict[str, Any]:
    data = person.model_dump(exclude={"photo_url", "photo_key", "ai_optout"})
    return strip_paths(data, settings.ai_redact_fields)
