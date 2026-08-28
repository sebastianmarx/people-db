"""Login handshake endpoints. See app/auth.py for the reasoning behind the BFF."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class CallbackBody(BaseModel):
    code: str
    state: str


def _require_xhr(request: Request) -> None:
    if request.headers.get("x-requested-with") != "people-db":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header.")


@router.get("/login")
def login(response: Response) -> dict[str, str]:
    response.headers["Cache-Control"] = "no-store"
    return {"authorize_url": auth.start_login(response)}


@router.post("/callback")
def callback(
    body: CallbackBody,
    response: Response,
    _: None = Depends(_require_xhr),
    verifier: str | None = Cookie(default=None, alias=auth.VERIFIER_COOKIE),
    state: str | None = Cookie(default=None, alias=auth.STATE_COOKIE),
) -> dict[str, str | None]:
    claims = auth.complete_login(response, body.code, body.state, verifier, state)
    response.headers["Cache-Control"] = "no-store"
    return {"sub": claims.get("sub"), "username": claims.get("username")}


@router.post("/refresh")
def refresh(
    response: Response,
    _: None = Depends(_require_xhr),
    refresh_token: str | None = Cookie(default=None, alias=auth.REFRESH_COOKIE),
) -> dict[str, str | None]:
    claims = auth.refresh_session(response, refresh_token)
    response.headers["Cache-Control"] = "no-store"
    return {"sub": claims.get("sub")}


@router.post("/logout")
def logout(response: Response, _: None = Depends(_require_xhr)) -> dict[str, str]:
    response.headers["Cache-Control"] = "no-store"
    return {"logout_url": auth.logout(response)}


@router.get("/me")
def me(sub: str = Depends(auth.require_auth)) -> dict[str, str]:
    return {"sub": sub}
