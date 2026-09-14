"""Embedding storage behind a small interface, with an Amazon S3 Vectors implementation.

Vectors are keyed by agent_chunks.id. Metadata stays small and filterable (document_id,
source_id, doc_type, published_at); chunk text lives in DSQL, not in the vector index.
"""

from dataclasses import dataclass, field
from typing import Protocol

import boto3

from core import settings

PUT_BATCH = 500  # S3 Vectors PutVectors accepts up to 500 vectors per call


@dataclass
class VectorItem:
    key: str
    vector: list[float]
    metadata: dict = field(default_factory=dict)


@dataclass
class VectorHit:
    key: str
    distance: float | None
    metadata: dict


class VectorStore(Protocol):
    def upsert(self, items: list[VectorItem]) -> None: ...

    def query(self, vector: list[float], top_k: int = 12, filter: dict | None = None) -> list[VectorHit]: ...

    def delete(self, keys: list[str]) -> None: ...


class S3VectorStore:
    def __init__(
        self, bucket: str = settings.S3_VECTORS_BUCKET, index: str = settings.S3_VECTORS_INDEX
    ) -> None:
        self._client = boto3.client("s3vectors", region_name=settings.AWS_REGION)
        self._target = {"vectorBucketName": bucket, "indexName": index}

    def upsert(self, items: list[VectorItem]) -> None:
        for start in range(0, len(items), PUT_BATCH):
            batch = items[start : start + PUT_BATCH]
            self._client.put_vectors(
                **self._target,
                vectors=[
                    {"key": item.key, "data": {"float32": item.vector}, "metadata": item.metadata}
                    for item in batch
                ],
            )

    def query(self, vector: list[float], top_k: int = 12, filter: dict | None = None) -> list[VectorHit]:
        request = dict(
            **self._target,
            topK=top_k,
            queryVector={"float32": vector},
            returnMetadata=True,
            returnDistance=True,
        )
        if filter:
            request["filter"] = filter
        response = self._client.query_vectors(**request)
        return [
            VectorHit(hit["key"], hit.get("distance"), hit.get("metadata") or {})
            for hit in response.get("vectors", [])
        ]

    def delete(self, keys: list[str]) -> None:
        for start in range(0, len(keys), PUT_BATCH):
            self._client.delete_vectors(**self._target, keys=keys[start : start + PUT_BATCH])
