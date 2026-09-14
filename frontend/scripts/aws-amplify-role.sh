#!/usr/bin/env bash
# Creates the IAM role the Amplify Hosting SSR compute (the Next.js server) runs as, so production
# chat, media uploads, moderation and DSQL work with no stored keys. Safe to re-run.
#
# The role can only:
#   - connect to the Docket Aurora DSQL cluster
#   - invoke the docket_chat AgentCore runtime
#   - read, write and tag files under uploads/ in the post media bucket (scripts/aws-media-bucket.sh)
#   - call Rekognition content moderation (scripts/aws-media-moderation.sh; it can't be scoped to resources)
# Accounts are email and password in DSQL, so sign-in needs no other AWS service.
#
# With an app id, it also attaches the role to the app and sets the server's environment variables
# (amplify.yml copies them into .env.production at build time). SESSION_SECRET is generated once and
# never printed. Amplify doesn't allow variable names starting with AWS_, hence DOCKET_MEDIA_REGION.
#
# Usage (from frontend/; the docket CLI profile or a valid `aws login`):
#   bash scripts/aws-amplify-role.sh                       # role only
#   bash scripts/aws-amplify-role.sh <amplify-app-id> [branch]  # role + attach + env vars (branch: main)

set -euo pipefail

APP_ID="${1:-}"
BRANCH="${2:-main}"
ROLE_NAME="docket-amplify-compute"
REGION="us-west-2"
CLUSTER_ID="${DSQL_CLUSTER_ID:-arucmxa62xrerk4vt7b2kveetu}"
ENV_FILE="$(dirname "$0")/../.env.local"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""
aws_() { "$AWS_BIN" --region "$REGION" "$@" | tr -d '\r'; }
env_local() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }

ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
CLUSTER_ARN="arn:aws:dsql:$REGION:$ACCOUNT_ID:cluster/$CLUSTER_ID"
BUCKET="${DOCKET_MEDIA_BUCKET:-docket-media-$ACCOUNT_ID-$REGION}"
RUNTIME_ARN="${DOCKET_CHAT_RUNTIME_ARN:-$(env_local DOCKET_CHAT_RUNTIME_ARN)}"
if [ -z "$RUNTIME_ARN" ]; then
  RUNTIME_ARN=$(aws_ bedrock-agentcore-control list-agent-runtimes \
    --query "agentRuntimes[?agentRuntimeName=='docket_docket_chat'].agentRuntimeArn | [0]" --output text)
fi
case "$RUNTIME_ARN" in arn:aws:bedrock-agentcore:*) ;; *) echo "could not find the docket_chat runtime ARN"; exit 1 ;; esac

echo "== account $ACCOUNT_ID"
echo "== cluster $CLUSTER_ARN"
echo "== chat runtime $RUNTIME_ARN"
echo "== media bucket $BUCKET"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"amplify.amazonaws.com"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"aws:SourceAccount":"'"$ACCOUNT_ID"'"}}}]}'
if aws_ iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_ iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
  echo "role $ROLE_NAME exists (trust policy refreshed)"
else
  aws_ iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST" \
    --description "Amplify SSR compute role for the Docket web app" \
    --tags Key=app,Value=docket-fremont Key=purpose,Value=amplify-compute >/dev/null
  echo "created role $ROLE_NAME"
fi

POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
{"Sid":"DocketDsqlConnect","Effect":"Allow","Action":["dsql:DbConnectAdmin","dsql:DbConnect"],"Resource":"$CLUSTER_ARN"},
{"Sid":"DocketChatInvoke","Effect":"Allow","Action":"bedrock-agentcore:InvokeAgentRuntime","Resource":["$RUNTIME_ARN","$RUNTIME_ARN/runtime-endpoint/*"]},
{"Sid":"DocketPostMedia","Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:PutObjectTagging"],"Resource":"arn:aws:s3:::$BUCKET/uploads/*"},
{"Sid":"DocketMediaModeration","Effect":"Allow","Action":["rekognition:DetectModerationLabels","rekognition:DetectText","rekognition:StartContentModeration","rekognition:GetContentModeration"],"Resource":"*"}
]}
JSON
)
aws_ iam put-role-policy --role-name "$ROLE_NAME" --policy-name docket-amplify-compute-access --policy-document "$POLICY"
ROLE_ARN=$(aws_ iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)
echo "policy docket-amplify-compute-access applied; role $ROLE_ARN"

if [ -z "$APP_ID" ]; then
  echo "No app id given. After connecting the repo in the Amplify console, re-run: bash scripts/aws-amplify-role.sh <app-id>"
  exit 0
fi

aws_ amplify update-app --app-id "$APP_ID" --compute-role-arn "$ROLE_ARN" >/dev/null
DOMAIN=$(aws_ amplify get-app --app-id "$APP_ID" --query app.defaultDomain --output text)
APP_URL="https://$BRANCH.$DOMAIN"
echo "role attached to app $APP_ID ($APP_URL)"

# Keep an existing SESSION_SECRET so signed-in residents stay signed in across re-runs.
EXISTING=$(aws_ amplify get-branch --app-id "$APP_ID" --branch-name "$BRANCH" --query 'branch.environmentVariables' --output json)
SESSION_SECRET=$(printf '%s' "$EXISTING" | sed -n 's/.*"SESSION_SECRET": *"\([^"]*\)".*/\1/p')
[ -n "$SESSION_SECRET" ] || SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n=+/')

VARS="APP_URL=$APP_URL,SESSION_SECRET=$SESSION_SECRET"
VARS="$VARS,DSQL_ENDPOINT=$CLUSTER_ID.dsql.$REGION.on.aws,DSQL_USER=admin"
VARS="$VARS,DOCKET_CHAT_RUNTIME_ARN=$RUNTIME_ARN,DOCKET_MEDIA_BUCKET=$BUCKET,DOCKET_MEDIA_REGION=$REGION"
for NAME in NEXT_PUBLIC_GOOGLE_MAPS_API_KEY NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID; do
  VALUE="$(env_local "$NAME")"
  [ -z "$VALUE" ] || VARS="$VARS,$NAME=$VALUE"
done
aws_ amplify update-branch --app-id "$APP_ID" --branch-name "$BRANCH" --environment-variables "$VARS" >/dev/null
unset SESSION_SECRET VARS
echo "environment variables set on branch $BRANCH (values not printed)"
echo "Add $APP_URL to the Google Maps browser key's allowed referrers, then start a build:"
echo "  aws amplify start-job --region $REGION --app-id $APP_ID --branch-name $BRANCH --job-type RELEASE"
