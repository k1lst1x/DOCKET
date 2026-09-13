"""Runtime settings, read from the environment (and docket/.env when present)."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

AWS_REGION = os.getenv("AWS_REGION", "us-west-2")

# Claude Sonnet on Bedrock, called through the US cross-region inference profile
# (no on-demand throughput in us-west-2). Sonnet 4.6 until the account has Sonnet 5.
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6")
EMBED_MODEL_ID = os.getenv("EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
EMBED_DIMENSIONS = 1024

DATABASE_URL = os.getenv("DATABASE_URL", "")
S3_BUCKET = os.getenv("S3_BUCKET", "")

# LOCAL=1 runs both systems in-process without AgentCore.
LOCAL = os.getenv("LOCAL", "0") == "1"

USER_AGENT = os.getenv(
    "DOCKET_USER_AGENT",
    "DOCKET-civic-research-bot/0.1 (+contact rohitmaruriats@gmail.com)",
)
SOURCES_FILE = ROOT / "config" / "sources.yaml"
