#!/usr/bin/env bash
# Creates Docket's AWS database in us-west-2: an Aurora DSQL cluster. Safe to re-run: it checks
# whether the cluster already exists (by tag) before creating it. Accounts are email and password
# stored in DSQL, so no user pool or email service is needed.
#
# Usage (from frontend/, after `aws login` or `aws configure sso`):
#   bash scripts/aws-provision.sh
# Writes resource IDs (not secrets) to .env.local.
#
# Cost: DSQL free tier 100k DPUs + 1 GB/month. Nothing here has an hourly charge.

set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
APP="docket-fremont"
ENV_FILE="$(dirname "$0")/../.env.local"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""

# The Windows CLI ends text output with CRLF; strip \r so IDs compare and interpolate cleanly.
aws_() { "$AWS_BIN" "$@" | tr -d '\r'; }
AWS=aws_

say() { printf '\n== %s\n' "$*"; }

set_env() { # set_env KEY VALUE: add or replace KEY=VALUE in .env.local
  touch "$ENV_FILE"
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

say "Account"
$AWS sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table

say "Aurora DSQL cluster"
CLUSTER_ID=""
for id in $($AWS dsql list-clusters --region "$REGION" --query 'clusters[].identifier' --output text); do
  arn=$($AWS dsql get-cluster --region "$REGION" --identifier "$id" --query arn --output text)
  if [ "$($AWS dsql list-tags-for-resource --region "$REGION" --resource-arn "$arn" --query 'tags.app' --output text 2>/dev/null)" = "$APP" ]; then
    CLUSTER_ID="$id"
  fi
done
if [ -z "$CLUSTER_ID" ]; then
  CLUSTER_ID=$($AWS dsql create-cluster --region "$REGION" --deletion-protection-enabled \
    --tags "app=$APP,Name=$APP" --query identifier --output text)
  echo "created $CLUSTER_ID"
else
  echo "exists  $CLUSTER_ID"
fi
DSQL_ENDPOINT="$CLUSTER_ID.dsql.$REGION.on.aws"
set_env AWS_REGION "$REGION"
set_env DSQL_ENDPOINT "$DSQL_ENDPOINT"
echo "endpoint $DSQL_ENDPOINT (status: $($AWS dsql get-cluster --region "$REGION" --identifier "$CLUSTER_ID" --query status --output text))"

say "Done. Wrote IDs to .env.local"
grep -E '^(AWS_REGION|DSQL_ENDPOINT)=' "$ENV_FILE"
echo
echo "Next: DSQL_ENDPOINT=$DSQL_ENDPOINT node scripts/dsql-migrate.mjs"
