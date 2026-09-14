#!/usr/bin/env bash
# Creates the private S3 bucket for photos and videos in home feed posts. Safe to re-run.
#
#   - all public access blocked; the app shows files through short-lived signed links
#   - S3-managed encryption
#   - CORS so browsers can upload straight to the bucket from localhost and Amplify
#   - lifecycle: uploads still tagged docket-state=pending (never attached to a post) are deleted after 1 day
#   - grants the docket-local-dev IAM user (scripts/aws-dev-user.sh) access to this bucket only
#   - writes DOCKET_MEDIA_BUCKET to frontend/.env.local
#
# On Amplify, give the SSR compute role the same S3 statement and set DOCKET_MEDIA_BUCKET, and add
# the app's domain to CORS_ORIGINS below if it isn't an *.amplifyapp.com address.
#
# Usage (from frontend/, while signed in with `aws login`):
#   bash scripts/aws-media-bucket.sh

set -euo pipefail

REGION="us-west-2"
ENV_FILE="$(dirname "$0")/../.env.local"
DEV_USER="docket-local-dev"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""
aws_() { "$AWS_BIN" --region "$REGION" "$@" | tr -d '\r'; }

ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
BUCKET="${DOCKET_MEDIA_BUCKET:-docket-media-$ACCOUNT_ID-$REGION}"
echo "== account $ACCOUNT_ID, bucket $BUCKET"

if aws_ s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "bucket exists"
else
  aws_ s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  echo "created bucket"
fi

aws_ s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws_ s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws_ s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=app,Value=docket-fremont},{Key=purpose,Value=post-media}]'
echo "public access blocked, encryption on"

CORS_ORIGINS='"http://localhost:3000","https://*.amplifyapp.com"'
aws_ s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{\"CORSRules\":[{\"AllowedOrigins\":[$CORS_ORIGINS],\"AllowedMethods\":[\"POST\",\"GET\",\"HEAD\"],\"AllowedHeaders\":[\"*\"],\"MaxAgeSeconds\":3000}]}"
echo "CORS set for $CORS_ORIGINS"

aws_ s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [
    {"ID": "expire-unposted-uploads", "Status": "Enabled", "Filter": {"Tag": {"Key": "docket-state", "Value": "pending"}}, "Expiration": {"Days": 1}},
    {"ID": "abort-incomplete-multipart", "Status": "Enabled", "Filter": {"Prefix": ""}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}}
  ]
}'
echo "lifecycle rules set"

if aws_ iam get-user --user-name "$DEV_USER" >/dev/null 2>&1; then
  POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"DocketPostMedia\",\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:PutObjectTagging\"],\"Resource\":\"arn:aws:s3:::$BUCKET/uploads/*\"}]}"
  aws_ iam put-user-policy --user-name "$DEV_USER" --policy-name docket-local-dev-media --policy-document "$POLICY"
  echo "policy docket-local-dev-media applied to $DEV_USER"
else
  echo "no $DEV_USER user; run scripts/aws-dev-user.sh first for local dev"
fi

touch "$ENV_FILE"
if grep -qE '^DOCKET_MEDIA_BUCKET=' "$ENV_FILE"; then
  sed -i.bak -E "s|^DOCKET_MEDIA_BUCKET=.*|DOCKET_MEDIA_BUCKET=$BUCKET|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
else
  printf '\n# Photos and videos in posts (scripts/aws-media-bucket.sh)\nDOCKET_MEDIA_BUCKET=%s\n' "$BUCKET" >> "$ENV_FILE"
fi
echo "DOCKET_MEDIA_BUCKET=$BUCKET in .env.local (restart the dev server)"
