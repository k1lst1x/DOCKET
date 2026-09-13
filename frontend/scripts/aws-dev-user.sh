#!/usr/bin/env bash
# Creates a least-privilege IAM user for running the web app locally, so the dev
# server doesn't depend on short-lived `aws login` sessions. Safe to re-run: it
# reuses the user and policy, and only creates access keys when none are saved yet.
#
# The user can only:
#   - connect to the Docket Aurora DSQL cluster (admin role, for local dev and seeding)
#   - invoke the docket_chat AgentCore runtime
# Cognito sign-in uses public APIs and needs no IAM permissions.
#
# Keys are written straight into frontend/.env.local (gitignored) and never printed.
# Rotate:  aws iam delete-access-key --user-name docket-local-dev --access-key-id <id>, then re-run.
# Remove:  delete its keys, delete-user-policy, then delete-user.
#
# Usage (from frontend/, while signed in with `aws login`):
#   bash scripts/aws-dev-user.sh

set -euo pipefail

USER_NAME="docket-local-dev"
POLICY_NAME="docket-local-dev-access"
REGION="us-west-2"
CLUSTER_ID="${DSQL_CLUSTER_ID:-arucmxa62xrerk4vt7b2kveetu}"
ENV_FILE="$(dirname "$0")/../.env.local"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""
aws_() { "$AWS_BIN" "$@" | tr -d '\r'; }

ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
RUNTIME_ARN=$(grep -E '^DOCKET_CHAT_RUNTIME_ARN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
CLUSTER_ARN="arn:aws:dsql:$REGION:$ACCOUNT_ID:cluster/$CLUSTER_ID"

echo "== account $ACCOUNT_ID"
echo "== cluster $CLUSTER_ARN"
echo "== chat runtime ${RUNTIME_ARN:-(not set in .env.local; chat permission skipped)}"

if ! aws_ iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  aws_ iam create-user --user-name "$USER_NAME" --tags Key=app,Value=docket-fremont Key=purpose,Value=local-dev >/dev/null
  echo "created user $USER_NAME"
else
  echo "user $USER_NAME exists"
fi

STATEMENTS=$(cat <<JSON
{"Sid":"DocketDsqlConnect","Effect":"Allow","Action":["dsql:DbConnectAdmin","dsql:DbConnect"],"Resource":"$CLUSTER_ARN"}
JSON
)
if [ -n "$RUNTIME_ARN" ]; then
  STATEMENTS="$STATEMENTS,$(cat <<JSON
{"Sid":"DocketChatInvoke","Effect":"Allow","Action":"bedrock-agentcore:InvokeAgentRuntime","Resource":["$RUNTIME_ARN","$RUNTIME_ARN/runtime-endpoint/*"]}
JSON
)"
fi
POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[$STATEMENTS]}"
aws_ iam put-user-policy --user-name "$USER_NAME" --policy-name "$POLICY_NAME" --policy-document "$POLICY"
echo "policy $POLICY_NAME applied"

if grep -qE '^AWS_ACCESS_KEY_ID=.+' "$ENV_FILE" 2>/dev/null; then
  echo "access keys already in .env.local; not creating new ones"
else
  KEYS=$(aws_ iam create-access-key --user-name "$USER_NAME" --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  KEY_ID=$(printf '%s' "$KEYS" | awk '{print $1}')
  SECRET=$(printf '%s' "$KEYS" | awk '{print $2}')
  touch "$ENV_FILE"
  {
    printf '\n# Local dev IAM user %s (least privilege; created by scripts/aws-dev-user.sh). Never commit.\n' "$USER_NAME"
    printf 'AWS_ACCESS_KEY_ID=%s\n' "$KEY_ID"
    printf 'AWS_SECRET_ACCESS_KEY=%s\n' "$SECRET"
    printf 'AWS_REGION=%s\n' "$REGION"
  } >> "$ENV_FILE"
  unset KEYS SECRET
  echo "wrote access key ${KEY_ID:0:4}…${KEY_ID: -4} to .env.local"
fi

git -C "$(dirname "$0")/.." check-ignore -q .env.local && echo ".env.local is gitignored: ok" || { echo "WARNING: .env.local is NOT gitignored"; exit 1; }
