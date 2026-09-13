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

FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "").strip()

# Shared Aurora DSQL cluster (IAM auth, no password). The agent owns only agent_* tables.
# A blank line in .env (e.g. "S3_BUCKET=") counts as unset, so these fall back to the defaults.
DSQL_ENDPOINT = os.getenv("DSQL_ENDPOINT") or "arucmxa62xrerk4vt7b2kveetu.dsql.us-west-2.on.aws"
# S3 for raw originals; S3 Vectors for chunk embeddings keyed by agent_chunks.id.
S3_BUCKET = os.getenv("S3_BUCKET") or "docket-raw-465083445156-us-west-2"
S3_VECTORS_BUCKET = os.getenv("S3_VECTORS_BUCKET") or "docket-vectors-465083445156"
S3_VECTORS_INDEX = os.getenv("S3_VECTORS_INDEX") or "docket-chunks"

# LOCAL=1 runs both systems in-process without AgentCore.
LOCAL = os.getenv("LOCAL", "0") == "1"

USER_AGENT = os.getenv(
    "DOCKET_USER_AGENT",
    "DOCKET-civic-research-bot/0.1 (+contact rohitmaruriats@gmail.com)",
)
SOURCES_FILE = ROOT / "config" / "sources.yaml"
