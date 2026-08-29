"""Turn a free-text note into a reviewable set of profile edits.

The model never writes to the database. It proposes changes, the UI shows them
as an accept/reject list, and only confirmed changes are persisted. That keeps a
hallucinated salary out of the record.
"""

from __future__ import annotations

import json
from typing import Any

from app.config import settings
from app.llm import client
from app.llm.redact import person_for_llm
from app.models import ExtractionResult, FieldChange, Person, PersonPatch

# Anything outside this list is discarded, so the model cannot invent fields.
ALLOWED_PATHS: dict[str, str] = {
    "given_name": "string",
    "family_name": "string",
    "address.street": "string",
    "address.postal_code": "string",
    "address.city": "string",
    "birthday": "YYYY-MM-DD, or --MM-DD when the year is unknown",
    "salary.amount": "number, no thousands separators",
    "salary.period": "one of: year, month, hour",
    "job.title": "string",
    "job.company": "string",
    "job.description": "string, one or two sentences",
    "kids": "full replacement array of {name, birth_year}",
    "phone": "string",
    "email": "string",
    "tags": "full replacement array of short lowercase strings",
    "how_we_met": "string",
}

_LANGUAGE_NAMES = {"en": "English", "de": "German"}

SYSTEM_PROMPT = """You extract structured facts about a person from a short note \
written by the user after talking to them.

Return ONLY a JSON object of this exact shape:
{{"summary": "<one short sentence>", "changes": [{{"path": "...", "proposed": <value>, \
"reason": "<quote or paraphrase from the note>", "confidence": <0.0-1.0>}}]}}

Rules:
- Only these paths are allowed. Anything else is discarded:
{allowed}
- Propose a change ONLY when the note states or clearly implies it AND the value \
differs from the current profile. If nothing new is stated, return an empty changes array.
- Never guess. If the note is vague about a number or a date, leave it out.
- "reason" must point at the words in the note that justify the change. Do not invent support.
- For "kids" and "tags", return the complete new array, merging what you already \
see in the current profile with what the note adds.
- Confidence below 0.4 means you are unsure; prefer omitting the change instead.
- Salaries are always in euros and addresses are always in Germany, so never \
report a currency or a country.
- The note is written in {language}. Output field values in the same language as \
the source text, except for dates."""


def _get_path(data: dict[str, Any], path: str) -> Any:
    cursor: Any = data
    for part in path.split("."):
        if not isinstance(cursor, dict):
            return None
        cursor = cursor.get(part)
    return cursor


def _set_path(data: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cursor = data
    for part in parts[:-1]:
        cursor = cursor.setdefault(part, {})
    cursor[parts[-1]] = value


def extract(person: Person, note_body: str) -> ExtractionResult:
    profile = person_for_llm(person)
    language = _LANGUAGE_NAMES.get(settings.note_language, settings.note_language)

    system = SYSTEM_PROMPT.format(
        allowed="\n".join(f"  - {p}: {d}" for p, d in ALLOWED_PATHS.items()),
        language=language,
    )
    user = (
        f"Current profile:\n{json.dumps(profile, ensure_ascii=False, indent=2)}\n\n"
        f"New note:\n{note_body}"
    )

    message = client.complete(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        json_object=True,
        temperature=0.0,
        max_tokens=4000,
    )
    parsed = client.parse_json_content(message.get("content") or "")

    current = person.model_dump()
    changes: list[FieldChange] = []
    for raw in parsed.get("changes", []):
        if not isinstance(raw, dict):
            continue
        path = str(raw.get("path", ""))
        if path not in ALLOWED_PATHS:
            continue
        proposed = raw.get("proposed")
        if proposed in (None, "", [], {}):
            continue
        existing = _get_path(current, path)
        if existing == proposed:
            continue
        try:
            confidence = float(raw.get("confidence", 0.5))
        except (TypeError, ValueError):
            confidence = 0.5
        changes.append(
            FieldChange(
                path=path,
                current=existing,
                proposed=proposed,
                reason=str(raw.get("reason") or "")[:400] or None,
                confidence=max(0.0, min(1.0, confidence)),
            )
        )

    summary = parsed.get("summary")
    return ExtractionResult(
        changes=changes,
        summary=str(summary)[:300] if isinstance(summary, str) else None,
    )


def changes_to_patch(person: Person, changes: list[FieldChange]) -> PersonPatch:
    """Fold accepted changes into a validated partial update."""
    merged = person.model_dump(exclude={"photo_url", "photo_key"})
    touched: set[str] = set()

    for change in changes:
        if change.path not in ALLOWED_PATHS:
            continue
        _set_path(merged, change.path, change.proposed)
        touched.add(change.path.split(".")[0])

    payload = {key: merged[key] for key in touched if key in merged}
    payload["version"] = person.version
    return PersonPatch(**payload)
