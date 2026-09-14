"""Amazon Titan Text Embeddings V2 on Bedrock: 1024-dimension normalized vectors.

Returns the model's own input token count, which is what agent_chunks.token_count stores.
"""

import json
import time
from functools import cache

from botocore.exceptions import ClientError

from core import settings
from core.bedrock_session import bedrock_session

RETRYABLE = {"ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException"}


@cache
def _bedrock():
    return bedrock_session().client("bedrock-runtime")


def embed_text(text: str, attempts: int = 5) -> tuple[list[float], int]:
    body = json.dumps({"inputText": text, "dimensions": settings.EMBED_DIMENSIONS, "normalize": True})
    for attempt in range(attempts):
        try:
            response = _bedrock().invoke_model(
                modelId=settings.EMBED_MODEL_ID,
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            payload = json.loads(response["body"].read())
            vector = payload["embedding"]
            if len(vector) != settings.EMBED_DIMENSIONS:
                raise ValueError(f"expected {settings.EMBED_DIMENSIONS} dimensions, got {len(vector)}")
            return vector, int(payload["inputTextTokenCount"])
        except ClientError as error:
            if error.response["Error"]["Code"] not in RETRYABLE or attempt == attempts - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")
