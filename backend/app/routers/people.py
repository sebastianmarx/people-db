from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app import photos, repository
from app.auth import require_auth
from app.llm import extract as extraction
from app.llm.client import LLMDisabled
from app.llm.tools import summarize
from app.models import (
    ApplyExtraction,
    NoteCreated,
    NoteInput,
    Person,
    PersonInput,
    PersonPatch,
    PersonSummary,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/people", tags=["people"])


def _with_photo(person: Person) -> Person:
    person.photo_url = photos.view_url(person.photo_key)
    return person


def _load(sub: str, person_id: str) -> Person:
    try:
        return _with_photo(repository.get_person(sub, person_id))
    except repository.NotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such person.") from None


@router.get("", response_model=list[PersonSummary])
def list_people(sub: str = Depends(require_auth)) -> list[PersonSummary]:
    return [summarize(_with_photo(p)) for p in repository.list_people(sub)]


@router.post("", response_model=Person, status_code=status.HTTP_201_CREATED)
def create_person(body: PersonInput, sub: str = Depends(require_auth)) -> Person:
    if not (body.given_name.strip() or body.family_name.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A first or last name is required.")
    return repository.create_person(sub, body)


@router.get("/{person_id}", response_model=Person)
def get_person(person_id: str, sub: str = Depends(require_auth)) -> Person:
    return _load(sub, person_id)


@router.patch("/{person_id}", response_model=Person)
def update_person(
    person_id: str, body: PersonPatch, sub: str = Depends(require_auth)
) -> Person:
    _load(sub, person_id)
    try:
        return _with_photo(repository.update_person(sub, person_id, body))
    except repository.ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_person(person_id: str, sub: str = Depends(require_auth)) -> None:
    person = _load(sub, person_id)
    photos.delete(person.photo_key)
    repository.delete_person(sub, person_id)


# --------------------------------------------------------------------------
# Notes
# --------------------------------------------------------------------------
@router.get("/{person_id}/notes")
def list_notes(
    person_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    sub: str = Depends(require_auth),
):
    _load(sub, person_id)
    return repository.list_notes(person_id, limit=limit)


@router.post("/{person_id}/notes", response_model=NoteCreated, status_code=201)
def add_note(
    person_id: str,
    body: NoteInput,
    extract: bool = Query(default=False, description="Also propose profile edits."),
    sub: str = Depends(require_auth),
) -> NoteCreated:
    person = _load(sub, person_id)
    note = repository.add_note(person_id, body)

    proposal = None
    error = None
    if extract:
        # The note is already persisted. A failing model call must degrade to
        # "no suggestions", never to losing what the user just wrote.
        try:
            proposal = extraction.extract(person, body.body)
        except LLMDisabled:
            error = "AI features are turned off."
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            log.warning("extraction failed for %s: %s", person_id, exc)
            error = str(exc)

    return NoteCreated(note=note, extraction=proposal, extraction_error=error)


@router.delete("/{person_id}/notes", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(person_id: str, sk: str = Query(...), sub: str = Depends(require_auth)) -> None:
    _load(sub, person_id)
    repository.delete_note(person_id, sk)


@router.post("/{person_id}/apply-extraction", response_model=Person)
def apply_extraction(
    person_id: str, body: ApplyExtraction, sub: str = Depends(require_auth)
) -> Person:
    person = _load(sub, person_id)
    patch = extraction.changes_to_patch(person, body.changes)
    if body.version is not None:
        patch.version = body.version
    try:
        return _with_photo(repository.update_person(sub, person_id, patch))
    except repository.ConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# --------------------------------------------------------------------------
# Photos
# --------------------------------------------------------------------------
class PhotoConfirm(BaseModel):
    key: str


@router.post("/{person_id}/photo-upload")
def photo_upload(person_id: str, sub: str = Depends(require_auth)) -> dict:
    _load(sub, person_id)
    return photos.build_upload(person_id)


@router.post("/{person_id}/photo", response_model=Person)
def photo_confirm(
    person_id: str, body: PhotoConfirm, sub: str = Depends(require_auth)
) -> Person:
    person = _load(sub, person_id)
    # Only accept a key this person's own upload could have produced.
    if not body.key.startswith(f"photos/{person_id}/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid photo key.")
    old = person.photo_key
    updated = repository.set_photo_key(sub, person_id, body.key)
    if old and old != body.key:
        photos.delete(old)
    return _with_photo(updated)


@router.delete("/{person_id}/photo", response_model=Person)
def photo_delete(person_id: str, sub: str = Depends(require_auth)) -> Person:
    person = _load(sub, person_id)
    photos.delete(person.photo_key)
    return _with_photo(repository.set_photo_key(sub, person_id, None))
