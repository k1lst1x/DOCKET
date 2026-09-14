#!/usr/bin/env bash
# Manages who can get Docket sign-in codes while the SES account is in the sandbox. In the
# sandbox SES only emails verified addresses, and the server refuses to send a code anywhere
# else (src/lib/ses-recipients.ts), so nobody waits for an email that can't arrive. Once SES
# production access is granted, every address gets codes and this list stops mattering.
#
#   add     emails each person the AWS verification link (they must click it), and pre-registers
#           their Cognito account with their name so their first sign-in is a normal code
#   list    shows each tester's SES verification status and Cognito account status
#   resend  sends a fresh verification link (links expire after 24 hours); no emails = everyone unverified
#   remove  stops codes to an address within 10 minutes (the Cognito account and Docket data stay)
#
# The list lives in SES, not in the repo, so nobody's email is committed. Safe to re-run.
#
# Usage (from frontend/; the docket CLI profile or a valid `aws login`):
#   bash scripts/ses-testers.sh add "person@example.com=Full Name" ["other@example.com=Other Name" ...]
#   bash scripts/ses-testers.sh list
#   bash scripts/ses-testers.sh resend [person@example.com ...]
#   bash scripts/ses-testers.sh remove person@example.com

set -euo pipefail

REGION="us-west-2"
ENV_FILE="$(dirname "$0")/../.env.local"
AWS_BIN="${AWS_CLI:-aws}"
export AWS_PAGER=""
# Git Bash would otherwise rewrite arguments starting with "/" into Windows paths.
export MSYS_NO_PATHCONV=1
aws_() { "$AWS_BIN" --region "$REGION" "$@" | tr -d '\r'; }
env_local() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }

POOL_ID="${COGNITO_USER_POOL_ID:-$(env_local COGNITO_USER_POOL_ID)}"
[ -n "$POOL_ID" ] || { echo "COGNITO_USER_POOL_ID is missing from .env.local"; exit 1; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
ses_status() { aws_ sesv2 get-email-identity --email-identity "$1" --query VerificationStatus --output text 2>/dev/null || echo "NOT_ADDED"; }
cognito_status() { aws_ cognito-idp admin-get-user --user-pool-id "$POOL_ID" --username "$1" --query UserStatus --output text 2>/dev/null || echo "NO_ACCOUNT"; }
sender() { aws_ cognito-idp describe-user-pool --user-pool-id "$POOL_ID" --query UserPool.EmailConfiguration.SourceArn --output text | sed 's#.*/##'; }

add() {
  local entry email name status
  for entry in "$@"; do
    email=$(lower "${entry%%=*}")
    name=""
    [ "$entry" = "${entry#*=}" ] || name="${entry#*=}"
    case "$email" in *@*.*) ;; *) echo "skipping '$entry': not an email address"; continue ;; esac

    status=$(ses_status "$email")
    if [ "$status" = "NOT_ADDED" ]; then
      aws_ sesv2 create-email-identity --email-identity "$email" --tags Key=app,Value=docket-fremont Key=purpose,Value=tester >/dev/null
      echo "$email: verification email sent; they must click the link in it"
    else
      echo "$email: already in SES ($status)"
    fi

    status=$(cognito_status "$email")
    if [ "$status" = "NO_ACCOUNT" ]; then
      local attrs=("Name=email,Value=$email" "Name=email_verified,Value=true")
      [ -z "$name" ] || attrs+=("Name=name,Value=$name")
      aws_ cognito-idp admin-create-user --user-pool-id "$POOL_ID" --username "$email" \
        --user-attributes "${attrs[@]}" --message-action SUPPRESS >/dev/null
      echo "$email: Cognito account pre-registered${name:+ as $name}"
    else
      echo "$email: Cognito account exists ($status)"
    fi
    # Admin-created accounts can start in FORCE_CHANGE_PASSWORD. A random password nobody knows
    # confirms the account; signing in stays passwordless (email codes).
    if [ "$(cognito_status "$email")" = "FORCE_CHANGE_PASSWORD" ]; then
      aws_ cognito-idp admin-set-user-password --user-pool-id "$POOL_ID" --username "$email" --permanent \
        --password "$(openssl rand -base64 32 | tr -d '/+=\r\n')Aa1!" >/dev/null
      echo "$email: Cognito account confirmed"
    fi
  done
}

list() {
  local from email status
  from=$(sender)
  echo "SES production access: $(aws_ sesv2 get-account --query ProductionAccessEnabled --output text) (True means codes reach every address)"
  printf '%-40s %-10s %s\n' EMAIL SES COGNITO
  aws_ sesv2 list-email-identities --query "EmailIdentities[?IdentityType=='EMAIL_ADDRESS'].[IdentityName,VerificationStatus]" --output text |
    while read -r email status; do
      printf '%-40s %-10s %s%s\n' "$email" "$status" "$(cognito_status "$email")" "$([ "$email" = "$from" ] && echo "  (sends the codes)" || true)"
    done
}

resend() {
  local email status targets=("$@")
  if [ "${#targets[@]}" -eq 0 ]; then
    mapfile -t targets < <(aws_ sesv2 list-email-identities --query "EmailIdentities[?IdentityType=='EMAIL_ADDRESS' && VerificationStatus!='SUCCESS'].IdentityName" --output text | tr '\t' '\n' | sed '/^$/d')
  fi
  [ "${#targets[@]}" -gt 0 ] || { echo "everyone on the list is verified"; return; }
  for email in "${targets[@]}"; do
    email=$(lower "$email")
    status=$(ses_status "$email")
    case "$status" in
      SUCCESS) echo "$email: already verified" ;;
      NOT_ADDED) echo "$email: not on the list; use add" ;;
      *)
        # SES v1's VerifyEmailIdentity sends a fresh link for an existing, unverified identity.
        aws_ ses verify-email-identity --email-address "$email" >/dev/null
        echo "$email: new verification email sent (was $status)"
        ;;
    esac
  done
}

remove() {
  local from email
  from=$(sender)
  for email in "$@"; do
    email=$(lower "$email")
    if [ "$email" = "$from" ]; then
      echo "$email: not removed; Cognito sends every code from this address"
      continue
    fi
    aws_ sesv2 delete-email-identity --email-identity "$email" >/dev/null
    echo "$email: removed from SES; codes stop within 10 minutes (the Cognito account and Docket data stay)"
  done
}

case "${1:-}" in
  add | list | resend | remove)
    command="$1"
    shift
    "$command" "$@"
    ;;
  *)
    sed -n '2,19p' "$0"
    exit 1
    ;;
esac
