"""Apply backend/migrations/*.sql to Aurora DSQL, one statement per transaction.

Applied files are recorded in agent_schema_migrations (separate from the web app's
schema_migrations). Statements use IF NOT EXISTS, so re-running a partly applied file is safe.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.db import connect, run_with_retry

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


def statements(sql: str) -> list[str]:
    parts = re.split(r";\s*$", sql, flags=re.MULTILINE)
    cleaned = []
    for part in parts:
        body = "\n".join(line for line in part.splitlines() if not line.strip().startswith("--")).strip()
        if body:
            cleaned.append(body)
    return cleaned


def main() -> None:
    with connect() as conn:
        conn.autocommit = False
        run_with_retry(
            conn,
            lambda c: c.execute(
                "CREATE TABLE IF NOT EXISTS agent_schema_migrations ("
                "filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            ),
        )
        applied = {
            row[0]
            for row in run_with_retry(
                conn, lambda c: c.execute("SELECT filename FROM agent_schema_migrations").fetchall()
            )
        }
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in applied:
                print(f"skip {path.name} (already applied)")
                continue
            for statement in statements(path.read_text(encoding="utf-8")):
                run_with_retry(conn, lambda c, s=statement: c.execute(s))
                print(f"  ok: {statement.splitlines()[0][:90]}")
            run_with_retry(
                conn,
                lambda c, name=path.name: c.execute(
                    "INSERT INTO agent_schema_migrations (filename) VALUES (%s)", (name,)
                ),
            )
            print(f"applied {path.name}")


if __name__ == "__main__":
    main()
