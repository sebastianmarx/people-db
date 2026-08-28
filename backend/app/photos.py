"""Profile photos.

Uploads go straight from the browser to S3 with a presigned POST, so image
bytes never pass through Lambda. The POST policy caps the size, which a plain
presigned PUT cannot do.
"""

from __future__ import annotations

import boto3
from botocore.config import Config

from app.config import settings
from app.ids import new_ulid

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
UPLOAD_TTL = 120
VIEW_TTL = 3600

# virtual addressing keeps the upload host at <bucket>.s3.<region>.amazonaws.com,
# which is what the CloudFront CSP pins connect-src to.
_s3 = boto3.client(
    "s3",
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)


def build_upload(person_id: str) -> dict:
    key = f"photos/{person_id}/{new_ulid()}.jpg"
    presigned = _s3.generate_presigned_post(
        Bucket=settings.photo_bucket,
        Key=key,
        Fields={"Content-Type": "image/jpeg"},
        Conditions=[
            {"Content-Type": "image/jpeg"},
            ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ],
        ExpiresIn=UPLOAD_TTL,
    )
    return {"key": key, "url": presigned["url"], "fields": presigned["fields"]}


def view_url(key: str | None) -> str | None:
    if not key:
        return None
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.photo_bucket, "Key": key},
        ExpiresIn=VIEW_TTL,
    )


def delete(key: str | None) -> None:
    if not key:
        return
    _s3.delete_object(Bucket=settings.photo_bucket, Key=key)
