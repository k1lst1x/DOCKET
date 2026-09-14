"""Boto3 session for Amazon Bedrock model calls (the reasoning model and Titan embeddings).

By default model calls use this account's credentials. When BEDROCK_ROLE_ARN is set, they run in the account
that owns that DocketBedrockAccess role instead: the session assumes the role and refreshes its temporary credentials
before they expire. Everything else (AgentCore, DSQL, S3, S3 Vectors, Secrets Manager) stays in this account.
"""

from functools import cache

import boto3
from botocore.credentials import RefreshableCredentials
from botocore.session import get_session

from core import settings

ROLE_SESSION_NAME = "docket-bedrock"


@cache
def bedrock_session() -> boto3.Session:
    if not settings.BEDROCK_ROLE_ARN:
        return boto3.Session(region_name=settings.AWS_REGION)
    sts = boto3.client("sts", region_name=settings.AWS_REGION)

    def assume_role() -> dict:
        params = {"RoleArn": settings.BEDROCK_ROLE_ARN, "RoleSessionName": ROLE_SESSION_NAME}
        if settings.BEDROCK_EXTERNAL_ID:
            params["ExternalId"] = settings.BEDROCK_EXTERNAL_ID
        credentials = sts.assume_role(**params)["Credentials"]
        return {
            "access_key": credentials["AccessKeyId"],
            "secret_key": credentials["SecretAccessKey"],
            "token": credentials["SessionToken"],
            "expiry_time": credentials["Expiration"].isoformat(),
        }

    botocore_session = get_session()
    botocore_session._credentials = RefreshableCredentials.create_from_metadata(
        metadata=assume_role(), refresh_using=assume_role, method="sts-assume-role"
    )
    botocore_session.set_config_variable("region", settings.AWS_REGION)
    return boto3.Session(botocore_session=botocore_session)
