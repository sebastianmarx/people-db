"""All DynamoDB access lives here. Nothing else in the app talks to boto3."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from app.config import settings
from app.ids import new_ulid
from app.models import (
    RELATIONSHIP_INVERSE,
    Note,
    NoteInput,
    Person,
    PersonInput,
    PersonPatch,
    utcnow,
)

_dynamodb = boto3.resource("dynamodb")
_table = _dynamodb.Table(settings.table_name)


class ConflictError(Exception):
    """Raised when an optimistic-locking check fails."""


class NotFoundError(Exception):
    pass


def _to_dynamo(value: Any) -> Any:
    """DynamoDB rejects float; round-trip through JSON to get Decimals."""
    return json.loads(json.dumps(value), parse_float=Decimal)


def _from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        # Keep integers as int so `kids[].birth_year` doesn't render as 2019.0.
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    return value


def _person_pk(sub: str) -> str:
    return f"U#{sub}"


def _person_sk(person_id: str) -> str:
    return f"P#{person_id}"


def _note_pk(person_id: str) -> str:
    return f"P#{person_id}"


def _rel_sk(other_id: str) -> str:
    return f"R#{other_id}"


def _item_to_person(item: dict[str, Any]) -> Person:
    clean = _from_dynamo(item)
    clean.pop("PK", None)
    clean.pop("SK", None)
    clean.pop("entity", None)
    return Person(**clean)


# --------------------------------------------------------------------------
# People
# --------------------------------------------------------------------------
def list_people(sub: str) -> list[Person]:
    people: list[Person] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(_person_pk(sub)) & Key("SK").begins_with("P#"),
    }
    while True:
        resp = _table.query(**kwargs)
        people.extend(_item_to_person(i) for i in resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    people.sort(key=lambda p: (p.family_name.lower(), p.given_name.lower()))
    return people


def get_person(sub: str, person_id: str) -> Person:
    resp = _table.get_item(Key={"PK": _person_pk(sub), "SK": _person_sk(person_id)})
    item = resp.get("Item")
    if not item:
        raise NotFoundError(person_id)
    return _item_to_person(item)


def create_person(sub: str, data: PersonInput) -> Person:
    now = utcnow()
    person = Person(
        id=new_ulid(),
        created_at=now,
        updated_at=now,
        version=1,
        **data.model_dump(),
    )
    item = _to_dynamo(person.model_dump(exclude={"photo_url"}))
    item.update({"PK": _person_pk(sub), "SK": _person_sk(person.id), "entity": "person"})
    _table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    return person


def update_person(sub: str, person_id: str, patch: PersonPatch) -> Person:
    current = get_person(sub, person_id)

    if patch.version is not None and patch.version != current.version:
        raise ConflictError(
            f"This record was changed elsewhere (expected v{patch.version}, "
            f"found v{current.version})."
        )

    updates = patch.model_dump(exclude_none=True, exclude={"version"})
    merged = current.model_dump(exclude={"photo_url"})
    merged.update(updates)
    merged["updated_at"] = utcnow()
    merged["version"] = current.version + 1

    updated = Person(**merged)
    item = _to_dynamo(updated.model_dump(exclude={"photo_url"}))
    item.update({"PK": _person_pk(sub), "SK": _person_sk(person_id), "entity": "person"})

    try:
        _table.put_item(
            Item=item,
            ConditionExpression="version = :expected",
            ExpressionAttributeValues={":expected": current.version},
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ConflictError("This record was changed by another request.") from exc
        raise
    return updated


def set_photo_key(sub: str, person_id: str, photo_key: str | None) -> Person:
    current = get_person(sub, person_id)
    _table.update_item(
        Key={"PK": _person_pk(sub), "SK": _person_sk(person_id)},
        UpdateExpression="SET photo_key = :k, updated_at = :u, version = version + :one",
        ExpressionAttributeValues={":k": photo_key, ":u": utcnow(), ":one": 1},
    )
    current.photo_key = photo_key
    current.version += 1
    return current


def delete_person(sub: str, person_id: str) -> None:
    get_person(sub, person_id)  # 404 rather than a silent no-op

    # Each relationship is stored twice, once in each person's partition. The
    # mirror lives under the other person, so it has to be deleted explicitly
    # or their profile would keep pointing at someone who no longer exists.
    mirrors = [rel["other_id"] for rel in list_relationships(person_id)]

    # Notes are a separate partition, so they must be removed explicitly.
    with _table.batch_writer() as batch:
        for other_id in mirrors:
            batch.delete_item(Key={"PK": _note_pk(other_id), "SK": _rel_sk(person_id)})

        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(_note_pk(person_id)),
            "ProjectionExpression": "PK, SK",
        }
        while True:
            resp = _table.query(**kwargs)
            for item in resp.get("Items", []):
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
            if "LastEvaluatedKey" not in resp:
                break
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

        batch.delete_item(Key={"PK": _person_pk(sub), "SK": _person_sk(person_id)})


# --------------------------------------------------------------------------
# Notes
# --------------------------------------------------------------------------
def _item_to_note(item: dict[str, Any]) -> Note:
    clean = _from_dynamo(item)
    return Note(
        sk=clean["SK"],
        person_id=clean["person_id"],
        body=clean["body"],
        occurred_on=clean.get("occurred_on"),
        source=clean.get("source", "manual"),
        created_at=clean["created_at"],
    )


def list_notes(person_id: str, limit: int = 200) -> list[Note]:
    resp = _table.query(
        KeyConditionExpression=Key("PK").eq(_note_pk(person_id)) & Key("SK").begins_with("N#"),
        ScanIndexForward=False,  # newest first
        Limit=limit,
    )
    return [_item_to_note(i) for i in resp.get("Items", [])]


def add_note(person_id: str, data: NoteInput, source: str = "manual") -> Note:
    now = utcnow()
    sk = f"N#{now}#{new_ulid()}"
    item = {
        "PK": _note_pk(person_id),
        "SK": sk,
        "entity": "note",
        "person_id": person_id,
        "body": data.body,
        "occurred_on": data.occurred_on or now[:10],
        "source": source,
        "created_at": now,
    }
    _table.put_item(Item=item)
    return _item_to_note(item)


def delete_note(person_id: str, sk: str) -> None:
    if not sk.startswith("N#"):
        raise NotFoundError(sk)
    _table.delete_item(Key={"PK": _note_pk(person_id), "SK": sk})


def all_notes_for_search(person_ids: list[str], per_person: int = 50) -> list[Note]:
    """Used by the chat's note search. Fine at personal scale (hundreds of people)."""
    notes: list[Note] = []
    for pid in person_ids:
        notes.extend(list_notes(pid, limit=per_person))
    return notes


# --------------------------------------------------------------------------
# Relationships
#
# Stored as a mirrored pair: (a -> b) records what b is to a, and (b -> a)
# records the inverse. Both are written in one transaction so a half-built
# connection cannot exist. Reading a person's connections is then a single
# Query against their own partition, with no scatter-gather.
# --------------------------------------------------------------------------
def list_relationships(person_id: str) -> list[dict[str, Any]]:
    resp = _table.query(
        KeyConditionExpression=Key("PK").eq(_note_pk(person_id)) & Key("SK").begins_with("R#"),
    )
    out = []
    for item in resp.get("Items", []):
        clean = _from_dynamo(item)
        out.append(
            {
                "other_id": clean["other_id"],
                "type": clean["type"],
                "note": clean.get("note"),
                "created_at": clean.get("created_at", ""),
            }
        )
    return out


def set_relationship(
    person_id: str, other_id: str, rel_type: str, note: str | None = None
) -> None:
    if person_id == other_id:
        raise ValueError("A person cannot be related to themselves.")
    inverse = RELATIONSHIP_INVERSE.get(rel_type)
    if inverse is None:
        raise ValueError(f"Unknown relationship type: {rel_type}")

    now = utcnow()

    def item(owner: str, other: str, kind: str) -> dict[str, Any]:
        entry = {
            "PK": _note_pk(owner),
            "SK": _rel_sk(other),
            "entity": "relationship",
            "person_id": owner,
            "other_id": other,
            "type": kind,
            "created_at": now,
        }
        if note:
            entry["note"] = note
        return entry

    table = settings.table_name
    _dynamodb.meta.client.transact_write_items(
        TransactItems=[
            {"Put": {"TableName": table, "Item": item(person_id, other_id, rel_type)}},
            {"Put": {"TableName": table, "Item": item(other_id, person_id, inverse)}},
        ]
    )


def delete_relationship(person_id: str, other_id: str) -> None:
    _dynamodb.meta.client.transact_write_items(
        TransactItems=[
            {
                "Delete": {
                    "TableName": settings.table_name,
                    "Key": {"PK": _note_pk(person_id), "SK": _rel_sk(other_id)},
                }
            },
            {
                "Delete": {
                    "TableName": settings.table_name,
                    "Key": {"PK": _note_pk(other_id), "SK": _rel_sk(person_id)},
                }
            },
        ]
    )
