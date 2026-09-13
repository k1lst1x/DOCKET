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
# Optional: run Bedrock model calls in another AWS account by assuming this IAM role there (see
# core/bedrock_session.py). Unset means this account's own Bedrock access.
BEDROCK_ROLE_ARN = os.getenv("BEDROCK_ROLE_ARN", "").strip()
BEDROCK_EXTERNAL_ID = os.getenv("BEDROCK_EXTERNAL_ID", "").strip()

FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "").strip()
# Deployed runtimes read the key from AWS Secrets Manager instead of a plain environment variable.
FIRECRAWL_SECRET_ID = os.getenv("FIRECRAWL_SECRET_ID", "").strip()


def firecrawl_api_key() -> str:
    """The Firecrawl API key from the environment, or from AWS Secrets Manager when deployed."""
    if FIRECRAWL_API_KEY or not FIRECRAWL_SECRET_ID:
        return FIRECRAWL_API_KEY
    import boto3

    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    return client.get_secret_value(SecretId=FIRECRAWL_SECRET_ID)["SecretString"].strip()

# Shared Aurora DSQL cluster (IAM auth, no password). The agent owns only agent_* tables.
# A blank line in .env (e.g. "S3_BUCKET=") counts as unset, so these fall back to the defaults.
DSQL_ENDPOINT = os.getenv("DSQL_ENDPOINT") or "arucmxa62xrerk4vt7b2kveetu.dsql.us-west-2.on.aws"
# S3 for raw originals; S3 Vectors for chunk embeddings keyed by agent_chunks.id.
S3_BUCKET = os.getenv("S3_BUCKET") or "docket-raw-465083445156-us-west-2"
S3_VECTORS_BUCKET = os.getenv("S3_VECTORS_BUCKET") or "docket-vectors-465083445156"
S3_VECTORS_INDEX = os.getenv("S3_VECTORS_INDEX") or "docket-chunks"
# AgentCore Memory resource for chat sessions (scripts/setup_memory.py creates it). Optional:
# chat history is also kept in DSQL, so chat works without it.
MEMORY_ID = os.getenv("DOCKET_MEMORY_ID", "").strip()

# LOCAL=1 runs both systems in-process without AgentCore.
LOCAL = os.getenv("LOCAL", "0") == "1"

USER_AGENT = os.getenv(
    "DOCKET_USER_AGENT",
    "DOCKET-civic-research-bot/0.1 (+contact rohitmaruriats@gmail.com)",
)
SOURCES_FILE = ROOT / "config" / "sources.yaml"
