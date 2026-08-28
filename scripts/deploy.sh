#!/usr/bin/env bash
# Full deploy: build the Lambda, apply Terraform, publish the SPA, invalidate.
#
#   ./scripts/deploy.sh            # everything
#   ./scripts/deploy.sh infra      # Terraform only
#   ./scripts/deploy.sh frontend   # SPA only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"
TFVARS="$ROOT/infra/envs/prod.tfvars"

tf() { terraform -chdir="$ROOT/infra" "$@"; }

if [[ "$TARGET" == "all" || "$TARGET" == "infra" ]]; then
  "$ROOT/scripts/build_lambda.sh"
  tf init -input=false -upgrade
  tf apply -input=false -var-file="$TFVARS" "${@:2}"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  BUCKET="$(tf output -raw site_bucket)"
  DIST="$(tf output -raw cloudfront_distribution_id)"

  echo "→ building the SPA"
  (cd "$ROOT/frontend" && npm ci --silent && npm run build)

  echo "→ publishing to s3://$BUCKET"
  # Hashed assets are immutable; the entry points must never be cached.
  aws s3 sync "$ROOT/frontend/dist" "s3://$BUCKET" \
    --delete \
    --exclude 'index.html' --exclude 'sw.js' --exclude 'manifest.webmanifest' \
    --cache-control 'public,max-age=31536000,immutable'

  aws s3 sync "$ROOT/frontend/dist" "s3://$BUCKET" \
    --exclude '*' \
    --include 'index.html' --include 'sw.js' --include 'manifest.webmanifest' \
    --cache-control 'no-cache,must-revalidate'

  echo "→ invalidating CloudFront"
  aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' >/dev/null
fi

echo "✓ $(tf output -raw app_url)"
