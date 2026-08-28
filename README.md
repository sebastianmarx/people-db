# people_db

A private, mobile-first web app for remembering the people you meet: core facts,
dated conversation notes, AI-assisted field extraction, and a chat that answers
questions across everything you have stored.

Full specification: **[project.md](project.md)**

- **Live at** https://peopledb.familiemarx.click
- **Costs** ~$0–1.60/month on AWS, plus the $10/month OpenCode Go subscription
- **Reachable by** exactly one Cognito user, with mandatory TOTP MFA

---

## Prerequisites

| Tool | Version used |
| --- | --- |
| Terraform | ≥ 1.11 (native S3 state locking) |
| Python | 3.13 for the build, 3.12+ to run the tests |
| Node | 22+ |
| AWS CLI | v2, credentials for account `473197088636` |

A public Route 53 hosted zone for `familiemarx.click` must already exist. It does.

## First deploy

```bash
# 1. State bucket (once per account)
cd infra/bootstrap && terraform init && terraform apply && cd ../..

# 2. Point the backend at that bucket
terraform -chdir=infra init \
  -backend-config="bucket=people-db-tfstate-473197088636"

# 3. Everything else
./scripts/deploy.sh
```

The first apply takes ~10 minutes, almost all of it CloudFront.

## After the first deploy

```bash
# 1. Store the OpenCode Go API key (never enters Terraform state)
./scripts/set_api_key.sh

# 2. Set a permanent password for the single user
aws cognito-idp admin-set-user-password \
  --user-pool-id "$(terraform -chdir=infra output -raw cognito_user_pool_id)" \
  --username sebastian.sm.marx@gmail.com \
  --password '<a long password from your password manager>' \
  --permanent

# 3. Confirm the SNS subscription in the email AWS just sent, so budget and
#    error alarms can reach you.
```

Then open the app, sign in, and complete the TOTP enrolment the hosted UI
prompts for. **Register a second authenticator as a backup** — losing the only
one means recovering through the AWS console.

## Day-to-day

```bash
./scripts/deploy.sh              # build + apply + publish + invalidate
./scripts/deploy.sh infra        # Terraform only
./scripts/deploy.sh frontend     # SPA only

cd backend && ./.venv/bin/python -m pytest -q    # tests
cd frontend && npm run dev                       # local UI against a local API
```

## Local development

The SPA dev server proxies `/api` to `http://127.0.0.1:8000`:

```bash
cd backend && ./.venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

Local runs need real AWS credentials (DynamoDB, S3, SSM) and the Cognito
environment variables. In practice it is easier to test against the deployed
stack; the local path exists for iterating on UI without redeploying.

## Backup and export

- DynamoDB point-in-time recovery is on (35-day window).
- `GET /api/export` returns a complete JSON dump of every person and note.
- S3 versioning is on for both buckets.

## Turning the AI off

Set `ai_enabled = false` in `infra/envs/prod.tfvars` and re-apply. Extraction and
chat return 503, the UI hides those affordances, and no data leaves AWS. The rest
of the app keeps working as a plain database.
