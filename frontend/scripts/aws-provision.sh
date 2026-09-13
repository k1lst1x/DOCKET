#!/usr/bin/env bash
# Creates Docket's AWS resources in us-west-2. Safe to re-run: each step checks
# whether its resource already exists (by tag or name) before creating it.
#
#   Stage 1  Aurora DSQL cluster + SES sender identity (sends a verification email)
#   Stage 2  Cognito user pool (Essentials, email one-time codes via SES) + app client
#            runs only once the SES sender address is verified
#
# Usage (from frontend/, after `aws login` or `aws configure sso`):
#   SENDER_EMAIL=you@example.com bash scripts/aws-provision.sh
# Writes resource IDs (not secrets) to .env.local.
#
# Cost: DSQL free tier 100k DPUs + 1 GB/month; Cognito Essentials 10k MAU free;
# SES $0.10 per 1,000 emails. Nothing here has an hourly charge.

set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
APP="docket-fremont"
SENDER_EMAIL="${SENDER_EMAIL:?Set SENDER_EMAIL to the address that sends sign-in codes}"
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
ACCOUNT_ID=$($AWS sts get-caller-identity --query Account --output text)

# ---------------------------------------------------------------- Stage 1: DSQL
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

# ------------------------------------------------------------------ Stage 1: SES
say "SES sender identity"
if ! $AWS sesv2 get-email-identity --region "$REGION" --email-identity "$SENDER_EMAIL" >/dev/null 2>&1; then
  $AWS sesv2 create-email-identity --region "$REGION" --email-identity "$SENDER_EMAIL" >/dev/null
  echo "created; AWS sent a verification link to $SENDER_EMAIL"
fi
VERIFIED=$($AWS sesv2 get-email-identity --region "$REGION" --email-identity "$SENDER_EMAIL" --query VerifiedForSendingStatus --output text)
PRODUCTION=$($AWS sesv2 get-account --region "$REGION" --query ProductionAccessEnabled --output text)
echo "verified: $VERIFIED   production access: $PRODUCTION"
if [ "$PRODUCTION" != "True" ]; then
  echo "NOTE: SES is in the sandbox. Codes can only go to verified addresses until"
  echo "      production access is approved (request it in the SES console, usually ~1 day)."
fi
if [ "$VERIFIED" != "True" ]; then
  echo
  echo "Stop here: click the verification link sent to $SENDER_EMAIL, then re-run this script."
  exit 0
fi

# ------------------------------------------------------------ Stage 2: Cognito
say "Cognito user pool"
POOL_ID=$($AWS cognito-idp list-user-pools --region "$REGION" --max-results 60 \
  --query "UserPools[?Name=='$APP'].Id | [0]" --output text)
if [ "$POOL_ID" = "None" ] || [ -z "$POOL_ID" ]; then
  POOL_ID=$($AWS cognito-idp create-user-pool --region "$REGION" \
    --pool-name "$APP" \
    --user-pool-tier ESSENTIALS \
    --username-attributes email \
    --auto-verified-attributes email \
    --mfa-configuration OFF \
    --deletion-protection ACTIVE \
    --policies 'SignInPolicy={AllowedFirstAuthFactors=[PASSWORD,EMAIL_OTP]}' \
    --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
    --email-configuration "EmailSendingAccount=DEVELOPER,SourceArn=arn:aws:ses:$REGION:$ACCOUNT_ID:identity/$SENDER_EMAIL,From=Docket <$SENDER_EMAIL>" \
    --user-pool-tags "app=$APP" \
    --query UserPool.Id --output text)
  echo "created $POOL_ID"
else
  echo "exists  $POOL_ID"
fi
set_env COGNITO_USER_POOL_ID "$POOL_ID"

say "Cognito app client"
CLIENT_ID=$($AWS cognito-idp list-user-pool-clients --region "$REGION" --user-pool-id "$POOL_ID" \
  --query "UserPoolClients[?ClientName=='$APP-web'].ClientId | [0]" --output text)
if [ "$CLIENT_ID" = "None" ] || [ -z "$CLIENT_ID" ]; then
  # Called only from the Next.js server, so no client secret is needed.
  CLIENT_ID=$($AWS cognito-idp create-user-pool-client --region "$REGION" \
    --user-pool-id "$POOL_ID" \
    --client-name "$APP-web" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --prevent-user-existence-errors ENABLED \
    --auth-session-validity 5 \
    --refresh-token-validity 30 \
    --query UserPoolClient.ClientId --output text)
  echo "created $CLIENT_ID"
else
  echo "exists  $CLIENT_ID"
fi
set_env COGNITO_CLIENT_ID "$CLIENT_ID"

say "Done. Wrote IDs to .env.local"
grep -E '^(AWS_REGION|DSQL_ENDPOINT|COGNITO_USER_POOL_ID|COGNITO_CLIENT_ID)=' "$ENV_FILE"
echo
echo "Next: DSQL_ENDPOINT=$DSQL_ENDPOINT node scripts/dsql-migrate.mjs"
