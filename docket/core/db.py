"""Aurora DSQL connections with short-lived IAM auth tokens.

DSQL uses optimistic concurrency: a conflicting commit fails with SQLSTATE 40001 and must be
retried by the caller. run_with_retry does that for one unit of work.
"""

import time
from collections.abc import Callable
from typing import TypeVar

import boto3
import psycopg

from core import settings

T = TypeVar("T")
SERIALIZATION_FAILURE = "40001"


def connect() -> psycopg.Connection:
    token = boto3.client("dsql", region_name=settings.AWS_REGION).generate_db_connect_admin_auth_token(
        settings.DSQL_ENDPOINT, settings.AWS_REGION
    )
    return psycopg.connect(
        host=settings.DSQL_ENDPOINT,
        port=5432,
        dbname="postgres",
        user="admin",
        password=token,
        sslmode="require",
        connect_timeout=20,
    )


def run_with_retry(conn: psycopg.Connection, work: Callable[[psycopg.Connection], T], attempts: int = 5) -> T:
    """Run work(conn) in one transaction, retrying on DSQL serialization conflicts."""
    for attempt in range(attempts):
        try:
            with conn.transaction():
                return work(conn)
        except psycopg.Error as error:
            if error.sqlstate != SERIALIZATION_FAILURE or attempt == attempts - 1:
                raise
            time.sleep(0.2 * 2**attempt)
    raise RuntimeError("unreachable")
