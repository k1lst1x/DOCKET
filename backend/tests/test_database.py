import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.session import SessionDep, build_engine
from app.main import create_app


class DatabaseTests(unittest.TestCase):
    def test_persistence_rollback_and_foreign_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{Path(directory) / 'test.db'}"
            engine = build_engine(url)
            try:
                with engine.begin() as connection:
                    connection.execute(text("CREATE TABLE parent (id INTEGER PRIMARY KEY)"))
                    connection.execute(
                        text(
                            "CREATE TABLE child (id INTEGER PRIMARY KEY, "
                            "parent_id INTEGER REFERENCES parent(id))"
                        )
                    )
                with Session(engine) as session:
                    session.execute(text("INSERT INTO parent VALUES (1)"))
                    session.commit()
                with Session(engine) as session:
                    session.execute(text("INSERT INTO parent VALUES (2)"))
                with Session(engine) as session:
                    self.assertEqual(session.scalar(text("SELECT count(*) FROM parent")), 1)
                    with self.assertRaises(IntegrityError):
                        session.execute(text("INSERT INTO child VALUES (1, 999)"))
            finally:
                engine.dispose()
            reopened = build_engine(url)
            try:
                with reopened.connect() as connection:
                    self.assertEqual(connection.scalar(text("SELECT id FROM parent")), 1)
            finally:
                reopened.dispose()

    def test_request_session(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(Settings(database_url=f"sqlite:///{Path(directory) / 'api.db'}"))

            @app.get("/test-db")
            def database_probe(session: SessionDep):
                return {"value": session.scalar(text("SELECT 1"))}

            with TestClient(app) as client:
                self.assertEqual(client.get("/test-db").json(), {"value": 1})
                self.assertEqual(client.get("/api/v1/health").status_code, 200)
