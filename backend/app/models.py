"""Pydantic schemas. These are the contract shared with the frontend."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class Address(BaseModel):
    # `country` is accepted so records written before it was dropped still load,
    # but it is no longer edited or displayed: everything here is Germany.
    model_config = ConfigDict(extra="ignore")

    street: str | None = None
    postal_code: str | None = None
    city: str | None = None
    country: str | None = None

    def one_line(self) -> str:
        parts = [self.street, " ".join(p for p in [self.postal_code, self.city] if p)]
        return ", ".join(p for p in parts if p)


class Salary(BaseModel):
    # Same as Address.country: kept for older records, never edited. Everything
    # is in euros.
    model_config = ConfigDict(extra="ignore")

    amount: float | None = None
    currency: str = "EUR"
    period: Literal["year", "month", "hour"] = "year"

    def annualized(self) -> float | None:
        """Normalized to a yearly figure so numeric comparisons are meaningful."""
        if self.amount is None:
            return None
        return {"year": 1, "month": 12, "hour": 1720}[self.period] * self.amount


class Job(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    company: str | None = None
    description: str | None = None


class Kid(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    birth_year: int | None = None


class PersonInput(BaseModel):
    """Everything the user may set. Server-managed fields live on `Person`."""

    model_config = ConfigDict(extra="forbid")

    given_name: str = ""
    family_name: str = ""
    address: Address = Field(default_factory=Address)
    # Full ISO date, or "--MM-DD" when the year is unknown.
    birthday: str | None = None
    salary: Salary = Field(default_factory=Salary)
    job: Job = Field(default_factory=Job)
    kids: list[Kid] = Field(default_factory=list)
    phone: str | None = None
    email: str | None = None
    tags: list[str] = Field(default_factory=list)
    how_we_met: str | None = None
    # When true this person is never included in any payload sent to the LLM.
    ai_optout: bool = False

    @field_validator("birthday")
    @classmethod
    def _check_birthday(cls, v: str | None) -> str | None:
        if not v:
            return None
        if v.startswith("--"):
            datetime.strptime(v[2:], "%m-%d")
        else:
            datetime.strptime(v, "%Y-%m-%d")
        return v


class Person(PersonInput):
    id: str
    photo_key: str | None = None
    photo_url: str | None = None
    created_at: str
    updated_at: str
    version: int = 1

    @property
    def display_name(self) -> str:
        return " ".join(p for p in [self.given_name, self.family_name] if p) or "(unnamed)"


class PersonSummary(BaseModel):
    """The compact shape used by the list screen and by LLM prompts."""

    id: str
    given_name: str
    family_name: str
    display_name: str
    photo_url: str | None = None
    job_title: str | None = None
    company: str | None = None
    city: str | None = None
    tags: list[str] = Field(default_factory=list)


class PersonPatch(BaseModel):
    """Partial update. Only the provided keys are written."""

    model_config = ConfigDict(extra="forbid")

    given_name: str | None = None
    family_name: str | None = None
    address: Address | None = None
    birthday: str | None = None
    salary: Salary | None = None
    job: Job | None = None
    kids: list[Kid] | None = None
    phone: str | None = None
    email: str | None = None
    tags: list[str] | None = None
    how_we_met: str | None = None
    ai_optout: bool | None = None
    version: int | None = Field(default=None, description="Optimistic-locking guard.")


class NoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=20000)
    occurred_on: str | None = None


class Note(BaseModel):
    sk: str
    person_id: str
    body: str
    occurred_on: str | None = None
    source: Literal["manual", "ai_import"] = "manual"
    created_at: str


class FieldChange(BaseModel):
    """One proposed edit produced by the extraction model."""

    path: str = Field(description="Dotted path, e.g. 'address.city' or 'kids'.")
    current: Any = None
    proposed: Any = None
    reason: str | None = None
    confidence: float = 0.5


class ExtractionResult(BaseModel):
    changes: list[FieldChange] = Field(default_factory=list)
    summary: str | None = None


class ApplyExtraction(BaseModel):
    changes: list[FieldChange]
    version: int | None = None


class NoteCreated(BaseModel):
    note: Note
    extraction: ExtractionResult | None = None
    # Extraction is best-effort: the note is always saved even if the model
    # call fails, and the failure is reported here rather than as an error.
    extraction_error: str | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Chat is ephemeral: the client holds the transcript and replays it.
    messages: list[dict[str, str]] = Field(max_length=40)


class ChatResponse(BaseModel):
    answer: str
    people: list[PersonSummary] = Field(default_factory=list)
    tool_trace: list[str] = Field(default_factory=list)
