"""Authentication.

The SPA never handles tokens. It sends the user to the Cognito hosted UI, and
this module performs the PKCE code exchange server-side and stores the tokens
in HttpOnly cookies. That removes the whole class of XSS token-theft bugs that
a browser-side token store has, and it works because the SPA and the API are
served from the same CloudFront domain.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import Cookie, HTTPException, Request, Response, status
from jwt import PyJWKClient

from app.config import settings

log = logging.getLogger(__name__)

ACCESS_COOKIE = "pdb_at"
REFRESH_COOKIE = "pdb_rt"
VERIFIER_COOKIE = "pdb_pkce"
STATE_COOKIE = "pdb_state"

# The refresh cookie is only ever needed by the auth endpoints, so the browser
# is told not to send it anywhere else.
REFRESH_PATH = "/api/auth"

ACCESS_MAX_AGE = 15 * 60
REFRESH_MAX_AGE = 30 * 24 * 3600
HANDSHAKE_MAX_AGE = 10 * 60

_jwk_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    """Cached across warm invocations so JWKS is fetched once per container."""
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=3600)
    return _jwk_client


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _secure_cookie(
    response: Response, name: str, value: str, max_age: int, path: str = "/"
) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=max_age,
        path=path,
        httponly=True,
        secure=True,
        samesite="lax",
    )


def _clear_cookie(response: Response, name: str, path: str = "/") -> None:
    response.delete_cookie(key=name, path=path, httponly=True, secure=True, samesite="lax")


# --------------------------------------------------------------------------
# Login handshake
# --------------------------------------------------------------------------
def start_login(response: Response) -> str:
    """Returns the hosted-UI URL and stashes the PKCE verifier in a cookie."""
    verifier = _b64url(os.urandom(32))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    state = _b64url(os.urandom(16))

    _secure_cookie(response, VERIFIER_COOKIE, verifier, HANDSHAKE_MAX_AGE)
    _secure_cookie(response, STATE_COOKIE, state, HANDSHAKE_MAX_AGE)

    query = urlencode(
        {
            "client_id": settings.cognito_client_id,
            "response_type": "code",
            "scope": "openid email profile",
            "redirect_uri": settings.callback_url,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{settings.cognito_domain}/oauth2/authorize?{query}"


def _token_request(payload: dict[str, str]) -> dict[str, Any]:
    with httpx.Client(timeout=10) as client:
        resp = client.post(
            f"{settings.cognito_domain}/oauth2/token",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        log.warning("cognito token endpoint returned %s", resp.status_code)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token exchange failed.")
    return resp.json()


def complete_login(
    response: Response,
    code: str,
    state: str,
    verifier: str | None,
    expected_state: str | None,
) -> dict[str, Any]:
    if not verifier or not expected_state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Login session expired. Try again.")
    if not secrets.compare_digest(state, expected_state):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "State mismatch.")

    tokens = _token_request(
        {
            "grant_type": "authorization_code",
            "client_id": settings.cognito_client_id,
            "code": code,
            "redirect_uri": settings.callback_url,
            "code_verifier": verifier,
        }
    )

    claims = verify_access_token(tokens["access_token"])

    _clear_cookie(response, VERIFIER_COOKIE)
    _clear_cookie(response, STATE_COOKIE)
    _secure_cookie(response, ACCESS_COOKIE, tokens["access_token"], ACCESS_MAX_AGE)
    if "refresh_token" in tokens:
        _secure_cookie(
            response, REFRESH_COOKIE, tokens["refresh_token"], REFRESH_MAX_AGE, REFRESH_PATH
        )
    return claims


def refresh_session(response: Response, refresh_token: str | None) -> dict[str, Any]:
    if not refresh_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session.")

    tokens = _token_request(
        {
            "grant_type": "refresh_token",
            "client_id": settings.cognito_client_id,
            "refresh_token": refresh_token,
        }
    )
    claims = verify_access_token(tokens["access_token"])
    _secure_cookie(response, ACCESS_COOKIE, tokens["access_token"], ACCESS_MAX_AGE)
    return claims


def logout(response: Response) -> str:
    _clear_cookie(response, ACCESS_COOKIE)
    _clear_cookie(response, REFRESH_COOKIE, REFRESH_PATH)
    query = urlencode({"client_id": settings.cognito_client_id, "logout_uri": settings.app_url})
    return f"{settings.cognito_domain}/logout?{query}"


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------
def verify_access_token(token: str) -> dict[str, Any]:
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.issuer,
            # Cognito access tokens carry `client_id` rather than `aud`.
            options={"verify_aud": False, "require": ["exp", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "expired") from exc
    except jwt.PyJWTError as exc:
        log.warning("token rejected: %s", exc)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token.") from exc

    if claims.get("token_use") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type.")
    if claims.get("client_id") != settings.cognito_client_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong client.")

    # Second gate: even a valid token from another pool user is rejected. This
    # app is single-tenant by construction, not by convention.
    if settings.owner_sub and claims.get("sub") != settings.owner_sub:
        log.warning("rejected non-owner sub")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised.")

    return claims


def require_auth(
    request: Request,
    pdb_at: str | None = Cookie(default=None, alias=ACCESS_COOKIE),
) -> str:
    """FastAPI dependency. Returns the caller's Cognito `sub`."""
    # Cookies alone would be replayable by a cross-site form post. Requiring a
    # custom header means only same-origin XHR can reach a mutating endpoint.
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and request.headers.get("x-requested-with") != "people-db"
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-Requested-With header.")

    if not pdb_at:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")

    claims = verify_access_token(pdb_at)
    return str(claims["sub"])
