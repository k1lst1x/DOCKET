from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


def build_engine(database_url: str) -> Engine:
    is_sqlite = make_url(database_url).get_backend_name() == "sqlite"
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False, "timeout": 30} if is_sqlite else {},
        pool_pre_ping=True,
    )
    if is_sqlite:

        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


def get_session(request: Request) -> Iterator[Session]:
    # Routes explicitly commit successful writes; closing rolls back pending work.
    with Session(request.app.state.db_engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
