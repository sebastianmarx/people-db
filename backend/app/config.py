"""Runtime configuration, read once per cold start from the Lambda environment."""

from __future__ import annotations

import os
from functools import lru_cache


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    table_name: str = os.environ.get("TABLE_NAME", "people-db")
    photo_bucket: str = os.environ.get("PHOTO_BUCKET", "")
    app_url: str = os.environ.get("APP_URL", "http://localhost:5173")
    callback_url: str = os.environ.get("CALLBACK_URL", "http://localhost:5173/auth/callback")

    cognito_region: str = os.environ.get("COGNITO_REGION", "eu-central-1")
    cognito_pool_id: str = os.environ.get("COGNITO_POOL_ID", "")
    cognito_client_id: str = os.environ.get("COGNITO_CLIENT_ID", "")
    cognito_domain: str = os.environ.get("COGNITO_DOMAIN", "")
    owner_sub: str = os.environ.get("OWNER_SUB", "")

    llm_base_url: str = os.environ.get("LLM_BASE_URL", "https://opencode.ai/zen/go/v1")
    llm_model: str = os.environ.get("LLM_MODEL", "glm-5.3-flash")
    llm_key_param: str = os.environ.get("LLM_KEY_PARAM", "")
    ai_enabled: bool = _bool("AI_ENABLED", True)
    note_language: str = os.environ.get("NOTE_LANGUAGE", "en")

    # Dotted paths stripped from every payload before it leaves AWS.
    # Widening this improves privacy but blinds the chat to those fields.
    ai_redact_fields: tuple[str, ...] = tuple(
        f.strip()
        for f in os.environ.get("AI_REDACT_FIELDS", "phone,email,address.street").split(",")
        if f.strip()
    )

    log_level: str = os.environ.get("LOG_LEVEL", "INFO")

    @property
    def issuer(self) -> str:
        return (
            f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_pool_id}"
        )

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer}/.well-known/jwks.json"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
