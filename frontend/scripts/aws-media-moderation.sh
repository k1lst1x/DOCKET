#!/usr/bin/env bash
# Lets Docket check photos and videos in posts with Amazon Rekognition content moderation. Safe to re-run.
#
#   - grants the docket-local-dev IAM user (scripts/aws-dev-user.sh) rekognition:DetectModerationLabels,
#     DetectText, StartContentModeration and GetContentModeration. Rekognition can't scope these to
#     resources, so the statement uses "*".
#   - Rekognition reads files from the media bucket with the caller's own s3:GetObject permission, which
#     scripts/aws-media-bucket.sh already grants.
#
# On Amplify, add the same statement to the SSR compute role (next to the S3 statement).
# Cost: photos about $0.002 each (moderation + text), videos about $0.10 per minute.
#
# Usage (from frontend/, while signed in with `aws login`):
#   bash scripts/aws-media-moderation.sh

set -euo pipefail

REGION="us-west-2"
DEV_USER="docket-local-dev"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""
aws_() { "$AWS_BIN" --region "$REGION" "$@" | tr -d '\r'; }

ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
echo "== account $ACCOUNT_ID"

POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"DocketMediaModeration","Effect":"Allow","Action":["rekognition:DetectModerationLabels","rekognition:DetectText","rekognition:StartContentModeration","rekognition:GetContentModeration"],"Resource":"*"}]}'

if aws_ iam get-user --user-name "$DEV_USER" >/dev/null 2>&1; then
  aws_ iam put-user-policy --user-name "$DEV_USER" --policy-name docket-local-dev-moderation --policy-document "$POLICY"
  echo "policy docket-local-dev-moderation applied to $DEV_USER"
else
  echo "no $DEV_USER user; run scripts/aws-dev-user.sh first for local dev"
fi

echo "For Amplify, add this statement to the SSR compute role:"
echo "$POLICY"
