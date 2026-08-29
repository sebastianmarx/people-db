"""Tools the chat model may call.

Every aggregation is computed here in Python and handed to the model as a
finished number. The model phrases the answer; it never does the arithmetic.
That is what makes "how many people earn over 50k" reliable.
"""

from __future__ import annotations

import json
from typing import Any

from app import repository
from app.llm.redact import person_for_llm, visible_people
from app.models import Person, PersonSummary

NUMERIC_FIELDS = {"salary_annual", "kids_count", "birth_month", "birth_year"}
TEXT_FIELDS = {"city", "country", "company", "job_title", "tag", "name", "how_we_met"}

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "filter_people",
            "description": (
                "Filter and count people by one attribute. Use this for every "
                "numeric comparison or count; never count by hand."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "field": {
                        "type": "string",
                        "enum": sorted(NUMERIC_FIELDS | TEXT_FIELDS),
                        "description": (
                            "salary_annual is normalised to a yearly figure. "
                            "birth_month is 1-12."
                        ),
                    },
                    "op": {
                        "type": "string",
                        "enum": ["gt", "gte", "lt", "lte", "eq", "contains", "exists"],
                    },
                    "value": {
                        "type": ["string", "number", "boolean"],
                        "description": "Comparison value. Ignored when op is 'exists'.",
                    },
                },
                "required": ["field", "op"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_person",
            "description": (
                "Full profile, recent notes, and this person's connections to "
                "other people (spouse, children, colleagues, and so on)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "person_id": {"type": "string"},
                    "note_limit": {"type": "integer", "default": 10},
                },
                "required": ["person_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_notes",
            "description": (
                "Full-text search across every note. Use this when the answer is "
                "likely something the user wrote down rather than a profile field."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 15},
                },
                "required": ["query"],
            },
        },
    },
]


def summarize(person: Person) -> PersonSummary:
    return PersonSummary(
        id=person.id,
        given_name=person.given_name,
        family_name=person.family_name,
        display_name=person.display_name,
        photo_url=person.photo_url,
        job_title=person.job.title,
        company=person.job.company,
        city=person.address.city,
        tags=person.tags,
    )


def _field_value(person: Person, field: str) -> Any:
    match field:
        case "salary_annual":
            return person.salary.annualized()
        case "kids_count":
            return len(person.kids)
        case "birth_month":
            if not person.birthday:
                return None
            month = (
                person.birthday[2:4]
                if person.birthday.startswith("--")
                else person.birthday[5:7]
            )
            return int(month)
        case "birth_year":
            if not person.birthday or person.birthday.startswith("--"):
                return None
            return int(person.birthday[:4])
        case "city":
            return person.address.city
        case "country":
            return person.address.country
        case "company":
            return person.job.company
        case "job_title":
            return person.job.title
        case "tag":
            return " ".join(person.tags)
        case "name":
            return person.display_name
        case "how_we_met":
            return person.how_we_met
    return None


def _matches(actual: Any, op: str, value: Any) -> bool:
    if op == "exists":
        return actual not in (None, "", [], 0)
    if actual is None:
        return False

    if op == "contains":
        return str(value).strip().lower() in str(actual).lower()

    if op == "eq" and isinstance(actual, str):
        return str(actual).strip().lower() == str(value).strip().lower()

    try:
        left, right = float(actual), float(value)
    except (TypeError, ValueError):
        return False

    return {
        "gt": left > right,
        "gte": left >= right,
        "lt": left < right,
        "lte": left <= right,
        "eq": left == right,
    }.get(op, False)


class ToolRunner:
    """Holds the loaded people so each tool call is served from memory."""

    def __init__(self, sub: str, people: list[Person]):
        self.sub = sub
        self.people = visible_people(people)
        self.by_id = {p.id: p for p in self.people}
        self.referenced: dict[str, Person] = {}

    def index_for_prompt(self) -> str:
        lines = []
        for p in self.people:
            bits = [p.id, p.display_name]
            if p.job.title or p.job.company:
                bits.append(" @ ".join(x for x in [p.job.title, p.job.company] if x))
            if p.address.city:
                bits.append(p.address.city)
            if p.tags:
                bits.append("#" + " #".join(p.tags))
            lines.append(" | ".join(bits))
        return "\n".join(lines) if lines else "(no people stored yet)"

    def run(self, name: str, arguments: dict[str, Any]) -> str:
        match name:
            case "filter_people":
                return self._filter(arguments)
            case "get_person":
                return self._get(arguments)
            case "search_notes":
                return self._search_notes(arguments)
        return json.dumps({"error": f"Unknown tool {name}."})

    def _filter(self, args: dict[str, Any]) -> str:
        field = str(args.get("field", ""))
        op = str(args.get("op", "eq"))
        value = args.get("value")

        matched = [p for p in self.people if _matches(_field_value(p, field), op, value)]
        for p in matched:
            self.referenced[p.id] = p

        payload = {
            "count": len(matched),
            "total_people": len(self.people),
            "people": [
                {
                    "id": p.id,
                    "name": p.display_name,
                    field: _field_value(p, field),
                }
                for p in matched[:60]
            ],
        }
        if len(matched) > 60:
            payload["note"] = "Only the first 60 matches are listed; count is exact."
        return json.dumps(payload, ensure_ascii=False, default=str)

    def _get(self, args: dict[str, Any]) -> str:
        person = self.by_id.get(str(args.get("person_id", "")))
        if not person:
            return json.dumps({"error": "No such person, or they are excluded from AI features."})
        self.referenced[person.id] = person

        limit = int(args.get("note_limit") or 10)
        notes = repository.list_notes(person.id, limit=max(1, min(limit, 30)))

        connections = []
        for rel in repository.list_relationships(person.id):
            other = self.by_id.get(rel["other_id"])
            if other is None:
                continue  # unknown, or opted out of AI features
            self.referenced[other.id] = other
            connections.append({"name": other.display_name, "is_their": rel["type"]})

        return json.dumps(
            {
                "profile": person_for_llm(person),
                "connections": connections,
                "notes": [
                    {"date": n.occurred_on, "body": n.body} for n in notes
                ],
            },
            ensure_ascii=False,
            default=str,
        )

    def _search_notes(self, args: dict[str, Any]) -> str:
        query = str(args.get("query", "")).strip().lower()
        limit = max(1, min(int(args.get("limit") or 15), 40))
        if not query:
            return json.dumps({"matches": []})

        terms = [t for t in query.split() if len(t) > 2] or [query]
        matches: list[dict[str, Any]] = []

        for person in self.people:
            for note in repository.list_notes(person.id, limit=100):
                body = note.body.lower()
                score = sum(1 for t in terms if t in body)
                if score:
                    matches.append(
                        {
                            "person_id": person.id,
                            "name": person.display_name,
                            "date": note.occurred_on,
                            "body": note.body[:600],
                            "_score": score,
                        }
                    )

        matches.sort(key=lambda m: m["_score"], reverse=True)
        for m in matches[:limit]:
            person = self.by_id.get(m["person_id"])
            if person:
                self.referenced[person.id] = person
            m.pop("_score", None)

        return json.dumps({"matches": matches[:limit]}, ensure_ascii=False, default=str)
