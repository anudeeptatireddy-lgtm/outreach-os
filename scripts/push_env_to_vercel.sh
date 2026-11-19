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
  if err=$(printf '%s' "$value" | vercel env add "$name" production --force 2>&1); then
    echo "set   $name"
  else
    echo "FAIL  $name:"
    printf '%s\n' "$err" | grep -iE "error|not|denied|login|scope|link" | head -3 | sed 's/^/      /'
  fi
done
echo
echo "Now on Vercel (production):"
vercel env ls production 2>/dev/null | awk 'NF && $2 == "Hidden" {print "  " $1}'
echo "Done. Redeploy so the new keys take effect: vercel --prod"
