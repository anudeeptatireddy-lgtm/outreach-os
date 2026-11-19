#!/bin/sh
# Copy the API keys you filled in .env to the Vercel project's production environment.
# Values are piped straight to the Vercel CLI and never printed. Empty lines in .env are skipped.
# Usage: sh scripts/push_env_to_vercel.sh   (then redeploy: vercel --prod)
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env file found"; exit 1; }

for name in GEMINI_API_KEY HUNTER_API_KEY HUNTER_MONTHLY_BUDGET RESEND_API_KEY GMAIL_USER GMAIL_APP_PASSWORD OWNER_EMAIL; do
  value=$(grep -E "^${name}=" .env | tail -1 | cut -d= -f2- | tr -d '\r')
  if [ -z "$value" ]; then
    echo "skip  $name (empty)"
    continue
  fi
  printf '%s' "$value" | vercel env add "$name" production --force >/dev/null 2>&1 \
    && echo "set   $name" || echo "FAIL  $name (run: vercel env add $name production)"
done
echo "Done. Redeploy so the new keys take effect: vercel --prod"
