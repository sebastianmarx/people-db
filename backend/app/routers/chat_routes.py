from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app import repository
from app.auth import require_auth
from app.config import settings
from app.llm import chat as chat_engine
from app.llm.client import LLMDisabled, LLMError
from app.llm.extract import extract as extract_text
from app.models import ChatRequest, ChatResponse, ExtractionResult, Person, utcnow

router = APIRouter(prefix="/api", tags=["ai"])


@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, sub: str = Depends(require_auth)) -> ChatResponse:
    try:
        return chat_engine.ask(sub, body.messages)
    except LLMDisabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "AI features are turned off."
        ) from None
    except LLMError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


class AdHocExtract(BaseModel):
    text: str
    person_id: str | None = None


@router.post("/extract", response_model=ExtractionResult)
def extract(body: AdHocExtract, sub: str = Depends(require_auth)) -> ExtractionResult:
    """Preview an extraction without saving a note. Used by the 'new person' screen."""
    if body.person_id:
        try:
            person = repository.get_person(sub, body.person_id)
        except repository.NotFoundError:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such person.") from None
    else:
        now = utcnow()
        person = Person(id="new", created_at=now, updated_at=now)

    try:
        return extract_text(person, body.text)
    except LLMDisabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "AI features are turned off."
        ) from None
    except LLMError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/config")
def config(sub: str = Depends(require_auth)) -> dict:
    """Lets the UI hide AI affordances when AI is disabled."""
    return {
        "ai_enabled": settings.ai_enabled,
        "model": settings.llm_model if settings.ai_enabled else None,
        "note_language": settings.note_language,
        "redacted_fields": list(settings.ai_redact_fields),
    }


@router.get("/export")
def export(sub: str = Depends(require_auth)) -> dict:
    """Complete JSON dump. No lock-in, and a backup you control."""
    people = repository.list_people(sub)
    return {
        "exported_at": utcnow(),
        "people": [
            {
                "person": p.model_dump(exclude={"photo_url"}),
                "notes": [n.model_dump() for n in repository.list_notes(p.id, limit=500)],
                "relationships": repository.list_relationships(p.id),
            }
            for p in people
        ],
    }
