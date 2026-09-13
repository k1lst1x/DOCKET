"""Runs one crawl-and-ingest cycle as a subprocess (the same script used by hand) and reads its summary."""

import ast
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class IngestFailed(RuntimeError):
    pass


def run_ingest(sources: list[str], max_docs: int, lookback_days: int) -> dict:
    command = [
        sys.executable,
        str(ROOT / "scripts" / "ingest.py"),
        *sources,
        "--max-docs",
        str(max_docs),
        "--lookback-days",
        str(lookback_days),
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1"},
    )
    lines = completed.stdout.splitlines()
    summary = next((line for line in reversed(lines) if line.startswith("run ")), None)
    if completed.returncode != 0 or summary is None:
        raise IngestFailed(completed.stderr[-2000:] or "ingest produced no summary")
    run_id, _, counts = summary[len("run ") :].partition(": ")
    return {"run_id": run_id, "counts": ast.literal_eval(counts)}
