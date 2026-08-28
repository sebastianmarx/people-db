#!/usr/bin/env bash
# Writes the OpenCode Go API key into SSM. Run once, and again whenever the key
# rotates. The value never enters Terraform state or the repository.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARAM="$(terraform -chdir="$ROOT/infra" output -raw api_key_parameter)"

read -rsp "OpenCode Go API key: " KEY
echo

aws ssm put-parameter --name "$PARAM" --type SecureString --value "$KEY" --overwrite >/dev/null
echo "✓ stored in $PARAM"
echo "Restart the Lambda's containers so the new key is picked up:"
echo "  aws lambda update-function-configuration \\"
echo "    --function-name $(terraform -chdir="$ROOT/infra" output -raw lambda_function_name) \\"
echo "    --description \"key rotated \$(date -u +%FT%TZ)\""
