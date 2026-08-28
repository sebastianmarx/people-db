import os

import boto3
import pytest
from moto import mock_aws

os.environ.setdefault("TABLE_NAME", "people-db-test")
os.environ.setdefault("PHOTO_BUCKET", "people-db-photos-test")
os.environ.setdefault("AWS_DEFAULT_REGION", "eu-central-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("OWNER_SUB", "owner-sub")
os.environ.setdefault("AI_ENABLED", "false")


@pytest.fixture()
def aws(monkeypatch):
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="eu-central-1")
        ddb.create_table(
            TableName=os.environ["TABLE_NAME"],
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        s3 = boto3.client("s3", region_name="eu-central-1")
        s3.create_bucket(
            Bucket=os.environ["PHOTO_BUCKET"],
            CreateBucketConfiguration={"LocationConstraint": "eu-central-1"},
        )

        import importlib

        from app import repository

        importlib.reload(repository)
        yield repository
