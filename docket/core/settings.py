"""Runtime settings, read from the environment (and docket/.env when present)."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

AWS_REGION = os.getenv("AWS_REGION", "us-west-2")

# Reasoning model on Bedrock. openai.gpt-oss-120b runs on-demand; switch to
# us.openai.gpt-5.6-luna once the account is granted access to it.
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "openai.gpt-oss-120b-1:0")
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
