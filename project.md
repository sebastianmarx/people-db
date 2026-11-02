# people_db — Personal People Knowledge Base

> A private, mobile-first web app to store everything I know about the people I meet:
> core facts (address, birthday, salary, kids, job) plus free-form conversation notes.
> An LLM extracts structured fields out of the notes I write, and a chat interface
> answers questions across the whole database.

**Status:** deployed and verified
**Owner:** single user (private, single-tenant)
**Live at:** https://people-db.marxai.de
**Last updated:** 2026-08-28

---

## 1. Goals and non-goals

### Goals
1. **Remember people.** Store core profile data and an append-only stream of dated notes per person.
2. **Mobile-first web app.** Usable one-handed on a phone browser, installable as a PWA.
3. **Low friction capture.** Type or dictate a messy note right after meeting someone; the app proposes structured fields from it.
4. **Ask questions in natural language.** "Where does Alex live?", "How many people do I know earning over 50k?", "Who has a birthday this month?"
5. **Effectively zero cost when idle.** No always-on compute, no always-on database.
6. **Private.** Only the owner can reach the application or the data.

### Non-goals
- Multi-user, sharing, or collaboration.
- CRM features (pipelines, reminders, email integration).
- Native mobile apps. PWA only.
- Offline write support.

### Settled decisions
| Question | Answer |
| --- | --- |
| Custom domain | Yes — `people-db.marxai.de`. The `marxai.de` hosted zone already exists (`Z079978511H41VTS0SPET`), so there is no extra Route 53 charge. |
| Birthday reminders | Not now. Kept in the backlog (§12). |
| Chat history | Ephemeral. The transcript lives in the browser tab and is replayed to the API; nothing is stored server-side. |
| UI and note language | English. `note_language = "en"` steers the extraction prompt. |

---

## 2. Architecture

| Concern | Decision | Why |
| --- | --- | --- |
| Frontend | **React 19 + TypeScript + Vite 7**, Tailwind v4, TanStack Query, `vite-plugin-pwa` | §3 |
| Frontend hosting | **S3 (private) + CloudFront** | Static, HTTPS included, 1 TB/mo CloudFront free tier |
| Backend | **Python 3.13 on AWS Lambda (arm64)**, FastAPI + Mangum, one function | Scales to zero; 1M req/mo free forever; arm64 is ~20% cheaper per GB-s |
| API entry | **Lambda Function URL** behind the same CloudFront distribution, OAC + `AWS_IAM` | No API Gateway cost at all, and same-origin means no CORS |
| Database | **DynamoDB, on-demand, single table** | Genuinely $0 when idle, unlike anything RDS-shaped |
| Object storage | **S3**, private, presigned POST for upload and presigned GET for display | Image bytes never pass through Lambda |
| Auth | **Cognito User Pool**, one user, TOTP MFA mandatory, OIDC + PKCE, **tokens held server-side in HttpOnly cookies** | §7 |
| Secrets | **SSM Parameter Store SecureString** with the AWS-managed key | Free; Secrets Manager would be ~$0.40/mo, a CMK ~$1/mo |
| LLM | **OpenCode Go**, `glm-5.3-flash`, OpenAI-compatible, called over plain `httpx` | Flat $10/mo; no vendor SDK to keep the package small |
| IaC | **Terraform ≥1.11**, S3 remote state with native `use_lockfile` locking | No DynamoDB lock table needed |
| CI/CD | **GitHub Actions + AWS OIDC role** | No long-lived AWS keys anywhere |

### Request flow

```
                     ┌──────────────────────────────┐
  Phone browser ──►  │  CloudFront distribution     │
   (HTTPS)           │  people-db.marxai.de  │
                     └──────┬────────────────┬──────┘
                            │                │
                default     │                │  /api/*
                 ▼          ▼                ▼
          CloudFront   ┌───────────────┐   ┌──────────────────────┐
          Function     │ S3 (SPA)      │   │ Lambda Function URL  │
          (SPA rewrite)│ OAC, private  │   │ OAC, AWS_IAM auth    │
                       └───────────────┘   └──────────┬───────────┘
                                                      │
                                      ┌───────────────┼────────────────┐
                                      ▼               ▼                ▼
                                DynamoDB         S3 photos      OpenCode Go API
                                (people,         (presigned)    (glm-5.3-flash)
                                 notes)
                                      │
                                      ▼
                          Cognito hosted UI (OIDC + PKCE, TOTP MFA)
                          — code exchanged server-side by the Lambda
```

Three independent gates protect the app:
1. CloudFront signs every origin request with SigV4 via OAC, so the Function URL and both S3 buckets are unreachable directly.
2. The Lambda rejects any request without a valid, unexpired Cognito access token in an HttpOnly cookie.
3. It further rejects any token whose `sub` is not the single configured owner, so a second pool user would still get a 403.

### Three implementation details worth knowing

**`x-amz-content-sha256`.** CloudFront's OAC signs requests to a Lambda Function
URL but does not hash the request body. AWS therefore requires the *viewer* to
send the payload hash for `POST`/`PUT`/`PATCH`, or the origin rejects the
signature. `frontend/src/api/client.ts` computes it with `crypto.subtle` and sends
it on every call. The `Managed-AllViewerExceptHostHeader` origin request policy
forwards it (and must exclude `Host`, or the signature will not match).

**OAC needs two Lambda permissions, not one.** Granting only
`lambda:InvokeFunctionUrl` to `cloudfront.amazonaws.com` is not sufficient;
`lambda:InvokeFunction` must be granted as well. Without it every `/api/*`
request comes back as a bare `403 Forbidden` from the Function URL and the
function is never invoked, so **there is no CloudWatch log stream to debug from**
— the absence of logs is the diagnostic. This cost a deploy cycle to find; see
`infra/api.tf`.

**SPA deep links.** CloudFront custom error responses are distribution-wide, so
rewriting 403/404 to `index.html` would also corrupt legitimate 401/403 responses
from the API. Instead a CloudFront Function on the default behaviour rewrites
extension-less paths to `/index.html`, leaving `/api/*` untouched.

---

## 3. Frontend framework choice

**Chosen: React 19 + TypeScript + Vite, Tailwind v4, TanStack Query, PWA via `vite-plugin-pwa`.**

| Option | Verdict |
| --- | --- |
| **React + Vite (SPA)** | ✅ **Chosen.** Pure static output ⇒ S3+CloudFront, no server, no cost. Largest ecosystem for PWA tooling and mobile UI patterns. Ships at 93 KB gzipped. |
| Next.js | ❌ Its value is SSR/ISR/server actions, all of which need compute. That contradicts "no cost if not used". `output: export` reduces it to a heavier Vite. |
| SvelteKit / Solid (static adapter) | 🟡 Smaller and genuinely pleasant; a valid pick. Smaller ecosystem for the PWA and offline plumbing. |
| Flutter Web | ❌ Poor mobile-browser feel, huge initial payload, bad text-input ergonomics — the opposite of a fast note-capture app. |
| HTMX + server templates | ❌ Puts the server in the hot path of every interaction; slower on mobile and more Lambda invocations. |

Supporting choices:
- **No component library.** The app has four screens; hand-written Tailwind is less machinery than pulling in shadcn/ui.
- **Photo handling:** the browser downscales to 512 px JPEG on a `<canvas>` before upload, so no Pillow layer and no image processing in Lambda.
- **Speech input:** the phone keyboard's own dictation key. No API, works offline, free.
- **Service worker:** precaches the shell only. `/api/*` is explicitly never cached — stale personal data is worse than a spinner, and cached responses would outlive sign-out.

---

## 4. Data model (DynamoDB single table)

Table `people-db` — on-demand, PITR on, deletion protection on, encrypted at rest.

| Entity | PK | SK |
| --- | --- | --- |
| Person profile | `U#<cognito_sub>` | `P#<person_id>` |
| Note | `P#<person_id>` | `N#<iso8601_ts>#<ulid>` |
| Relationship | `P#<person_id>` | `R#<other_person_id>` |

Listing everyone is one `Query` on `PK = U#<sub>, begins_with(SK, "P#")`. At
personal scale (hundreds of people) that is a single page costing a fraction of a
cent per month, so **no GSI is needed**. Search and sorting happen client-side.

### Relationships

A connection is stored **twice**, once in each person's partition, holding the
role the *other* person plays: linking Mila to Alex as his child writes
`P#alex / R#mila → "child"` and `P#mila / R#alex → "parent"`. Both go in one
`TransactWriteItems`, so a half-built connection cannot exist.

The duplication buys a lot: reading someone's connections is a single Query
against their own partition with no scatter-gather, and both profiles show the
link without either being its owner. The cost is that deleting a person must
also reach into the other partitions to clear the mirrors, which
`delete_person` does explicitly and `test_relationships.py` pins.

Symmetric roles (`spouse`, `partner`, `sibling`, `friend`, `colleague`,
`relative`) mirror themselves; `parent`/`child` and `grandparent`/`grandchild`
invert.

This sits alongside the free-text `kids` list rather than replacing it: `kids`
records children who are not themselves people in the database, relationships
link two records that both exist.

IDs are ULIDs (`backend/app/ids.py`) rather than UUIDs, so range keys sort
chronologically for free and notes come back newest-first with
`ScanIndexForward=False`.

### Person item

```jsonc
{
  "PK": "U#<sub>", "SK": "P#01J...", "entity": "person",
  "id": "01J...",
  "given_name": "Alex",
  "family_name": "Meyer",
  "photo_key": "photos/01J.../01J....jpg",   // S3 key, nullable
  "address": { "street": "…", "postal_code": "…", "city": "Berlin", "country": "DE" },
  "birthday": "1988-04-12",                   // or "--04-12" when the year is unknown
  "salary": { "amount": 62000, "currency": "EUR", "period": "year" },
  "job": { "title": "Product Manager", "company": "Acme", "description": "…" },
  "kids": [ { "name": "Mila", "birth_year": 2019 } ],
  "phone": null, "email": null,
  "tags": ["climbing", "ex-colleague"],
  "how_we_met": "Climbing gym, March 2024",
  "ai_optout": false,
  "created_at": "…", "updated_at": "…", "version": 3
}
```

- `kids_count` is always derived from `len(kids)`; never stored twice.
- `version` drives optimistic locking via `ConditionExpression: version = :expected`.
- Numbers round-trip through `Decimal`; `_from_dynamo` converts whole values back
  to `int` so a birth year renders as `2019`, not `2019.0`.

### Note item

```jsonc
{
  "PK": "P#01J...", "SK": "N#2026-08-28T14:05:00Z#01J...",
  "entity": "note",
  "person_id": "01J...",
  "body": "Moving to Munich in October, new job at …",
  "occurred_on": "2026-08-27",
  "source": "manual",
  "created_at": "…"
}
```

---

## 5. API surface

Everything under `/api`. All routes except `/api/health` require a valid access
token cookie whose `sub` matches the configured owner.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness. Unauthenticated, returns no data. |
| `GET` | `/api/auth/login` | Returns the hosted-UI URL; sets the PKCE verifier + state as HttpOnly cookies |
| `POST` | `/api/auth/callback` | Exchanges `code` + `state` for tokens, sets the session cookies |
| `POST` | `/api/auth/refresh` | Rotates the access cookie using the refresh cookie |
| `POST` | `/api/auth/logout` | Clears cookies, returns the Cognito logout URL |
| `GET` | `/api/auth/me` | Current session's `sub` |
| `GET` | `/api/config` | `ai_enabled`, model, redacted field list — lets the UI hide AI affordances |
| `GET` | `/api/people` | Compact list for the main screen |
| `POST` | `/api/people` | Create |
| `GET` | `/api/people/{id}` | Full profile |
| `PATCH` | `/api/people/{id}` | Partial update, optimistic-locked on `version` |
| `DELETE` | `/api/people/{id}` | Delete person, cascade-delete notes, delete photo |
| `GET` | `/api/people/{id}/notes` | Notes, newest first |
| `POST` | `/api/people/{id}/notes?extract=true` | Add a note and optionally return a field proposal |
| `DELETE` | `/api/people/{id}/notes?sk=…` | Delete one note |
| `POST` | `/api/people/{id}/apply-extraction` | Persist the changes the user accepted |
| `GET` | `/api/people/{id}/relationships` | Connections, joined to names and photos |
| `POST` | `/api/people/{id}/relationships` | Link two people; writes the mirrored pair |
| `DELETE` | `/api/people/{id}/relationships?other_id=…` | Unlink, both directions |
| `POST` | `/api/people/{id}/photo-upload` | Presigned POST (2 MB cap, 120 s TTL) |
| `POST` | `/api/people/{id}/photo` | Confirm the uploaded key, delete the previous photo |
| `DELETE` | `/api/people/{id}/photo` | Remove the photo |
| `POST` | `/api/extract` | Extract fields from arbitrary text without saving a note |
| `POST` | `/api/chat` | Natural-language question over the database |
| `GET` | `/api/export` | Complete JSON dump of everything |

FastAPI's OpenAPI schema and docs routes are disabled: the API is private and
there is nothing to publish.

---

## 6. AI features

Provider configuration:

- Base URL `https://opencode.ai/zen/go/v1` (OpenAI-compatible)
- `POST {base}/chat/completions`, `Authorization: Bearer <key>`
- Model `glm-5.3-flash` — confirmed present in `GET {base}/models` alongside
  `glm-5.3`, `deepseek-v4-flash`, `qwen3.8-flash`, and the vision-capable
  `deepseek-v4-flash-vision-exp`
- Switching model or provider is one Terraform variable, not a code change

### 6.1 Field extraction

1. The user writes a note and taps **Save + extract**.
2. The note is persisted **first**. Extraction is best-effort — a model outage
   degrades to "no suggestions", never to losing what was just written.
3. The backend sends the note plus the person's current profile, asking for JSON
   containing **proposed changes only**, with `response_format: json_object`.
4. The response is validated against an allow-list of 18 dotted paths. Anything
   outside it, anything unparsable, and anything equal to the current value is
   discarded — the model cannot invent fields.
5. The UI shows a diff card with a checkbox per change, the quote from the note
   that justifies it, and a warning on anything below 0.6 confidence.
6. Only on **Apply** does a write happen, guarded by the record's `version`.

The model never writes to the database. That is the single design decision that
keeps a hallucinated salary out of the record.

The same pipeline backs **Fill from text** on the new-person screen: paste a
message or a typed-out business card and the suggestions land in the form, still
unsaved.

### 6.2 Chat over the database

Stage 1 — the model plans, calling tools in a loop capped at 5 rounds:

| Tool | What it does |
| --- | --- |
| `filter_people(field, op, value)` | Deterministic filter and **exact count** in Python. Fields include `salary_annual`, `kids_count`, `birth_month`, `city`, `company`, `tag`. |
| `get_person(person_id, note_limit)` | Full profile, recent notes, and that person's connections |
| `search_notes(query, limit)` | Term-scored search across every note |

Stage 2 — the model phrases an answer from the tool results. The UI renders the
people it consulted as tappable chips linking to their profiles.

Two things make this reliable:
- **Salaries are annualised before comparison** (`5000/month` → `60000/year`), so
  "over 50k" is right regardless of how the figure was entered.
- **The model never does arithmetic.** Every count and threshold goes through
  `filter_people`, which returns an exact number the model only has to phrase.

The system prompt carries a compact index (`id | name | job @ company | city |
tags`) of everyone stored — roughly 40 tokens per person, so a few hundred people
fit comfortably. Beyond ~800 people, drop the index and make the model retrieve
purely through tools.

### 6.3 Not built (deliberately)

Business-card OCR via `deepseek-v4-flash-vision-exp`. `glm-5.3-flash` is
text-only, and the text pipeline already handles a typed-out card.

---

## 7. Security

The app holds sensitive third-party personal data — addresses, salaries,
children's names. Security is a first-class requirement here, not an afterthought.

### Session handling: why the tokens live on the server

The obvious SPA design keeps tokens in `sessionStorage` and attaches them as
`Authorization` headers. That makes every XSS bug a full account compromise.

Because the SPA and the API share one CloudFront origin, a better option is
available at no extra cost: the **backend-for-frontend** pattern.

- `GET /api/auth/login` mints the PKCE verifier server-side and stores it in an
  HttpOnly cookie. **The verifier is never reachable from JavaScript.**
- Cognito redirects to `/auth/callback`; the SPA forwards `code` + `state` to
  `POST /api/auth/callback`.
- The Lambda validates `state` with a constant-time comparison, exchanges the
  code, verifies the resulting access token, and sets:
  - `pdb_at` — access token, HttpOnly, Secure, SameSite=Lax, 15 min, path `/`
  - `pdb_rt` — refresh token, HttpOnly, Secure, SameSite=Lax, 30 days, **path
    `/api/auth`** so the browser never sends it to any other endpoint
- On a 401 the client calls `/api/auth/refresh` once and retries. Concurrent 401s
  collapse into a single refresh call.

**No token is ever readable by page JavaScript.**

### CSRF

Cookie auth alone is replayable by a cross-site form post. Every mutating request
must carry `X-Requested-With: people-db`; only same-origin XHR can set a custom
header, and the app is same-origin throughout. `SameSite=Lax` is a second layer.

### Access control
- Cognito user pool with **one** user, `allow_admin_create_user_only = true`, no
  identity pool, no public sign-up path.
- **TOTP MFA is mandatory** (`mfa_configuration = "ON"`).
- Password policy: 14 characters, mixed case, digits, symbols.
- Authorization Code + PKCE is the only enabled flow; the client has no secret.
- Access and ID tokens live 15 minutes; refresh tokens 30 days with revocation
  enabled. `prevent_user_existence_errors` is on.
- The Lambda verifies signature against cached JWKS, `iss`, `exp`, `token_use ==
  "access"`, `client_id`, **and `sub == OWNER_SUB`**.

### Network and infrastructure
- Function URL auth type `AWS_IAM`; `lambda:InvokeFunctionUrl` granted only to
  this distribution's ARN. The URL is unusable from outside CloudFront.
- Both S3 buckets: full public-access block, versioning, SSE-S3, and an explicit
  `aws:SecureTransport = false` deny. The site bucket is readable only by this
  distribution's OAC; the photo bucket only through presigned URLs.
- CloudFront: `redirect-to-https`, TLS 1.2_2021 minimum, HTTP/3, `PriceClass_100`,
  geo-restricted to DE/AT/CH.
- Response headers policy: HSTS (2 years, preload), `nosniff`, `frame-options:
  DENY`, `strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy`,
  `Permissions-Policy` denying microphone/geolocation/payment/USB and allowing
  camera only to `self`, and a CSP of `default-src 'self'` with `script-src
  'self'`, `object-src 'none'`, `frame-ancestors 'none'`.
- Photo `img-src`/`connect-src` are pinned to the exact photo bucket hostname,
  not a wildcard.
- **AWS WAF is deliberately omitted.** At $5/mo base plus per-rule and
  per-request charges it would be the single largest line item, and the Cognito
  gate already blocks unauthenticated traffic. Revisit only if abuse appears.

### Data protection
- DynamoDB: encryption at rest, PITR (35 days), deletion protection.
- S3 photos: SSE-S3, versioning, `INTELLIGENT_TIERING` after 90 days, noncurrent
  versions expired after 30.
- `GET /api/export` gives a complete JSON dump. No lock-in.
- `OPENCODE_API_KEY` lives in SSM SecureString, read once per cold start and
  cached. Terraform creates the parameter with a placeholder and
  `ignore_changes = [value]`, so **the real key never enters Terraform state**,
  the repository, or the SPA bundle.
- Least-privilege IAM: the Lambda role can touch exactly one table, the
  `photos/*` prefix of one bucket, one SSM parameter, one KMS alias, and its own
  log group. Nothing else.
- Unhandled exceptions log the detail and return a bare `{"detail": "Internal
  error."}` — error bodies are a disclosure channel.
- CloudWatch log retention: 30 days.

### Privacy — read this before going live

Notes and profile fields are sent to a **third-party LLM provider**. This is
personal data about people who have not consented, which matters under GDPR if
you are in the EU.

Controls built in:
- **Per-person `ai_optout`.** Those records are dropped from every prompt, every
  tool result, and the chat index. `get_person` on an opted-out person returns an
  error, and the index never mentions them.
- **`AI_REDACT_FIELDS`**, default `phone,email,address.street`. These dotted paths
  are stripped from anything leaving AWS. `address.city` is deliberately kept so
  "who do I know in Munich?" still works; `salary` is kept so the salary query
  you asked for still works. Widening the list improves privacy and blinds the
  chat to those fields in equal measure — it is a dial, and the trade-off is real.
- **`ai_enabled = false`** disables every outbound call. The app stays fully
  usable as a plain database.
- The chat prompt carries only the compact index until the model explicitly
  retrieves a person or searches notes.

Keeping the app to personal and household use is what keeps it outside GDPR's
business scope. Do not give anyone else access.

---

## 8. Cost model

| Item | Monthly | Notes |
| --- | --- | --- |
| Lambda (arm64) | **$0** | 1M requests + 400k GB-s free tier, permanent |
| DynamoDB on-demand | **~$0** | A few thousand RRU/WRU; storage far under 25 GB |
| S3 (site + photos) | **< $0.05** | ~50 MB total |
| CloudFront | **$0** | 1 TB out + 10M requests/mo free tier, permanent |
| CloudFront Function | **$0** | 2M invocations/mo free, then $0.10/M |
| Cognito | **$0** | 1 MAU |
| SSM Parameter Store | **$0** | Standard parameters, AWS-managed key |
| CloudWatch Logs | **< $0.10** | 30-day retention |
| Route 53 | **$0** | The hosted zone already exists and is already paid for |
| ACM certificate | **$0** | Free for CloudFront |
| **AWS total** | **≈ $0.15 / month** | |
| OpenCode Go subscription | **$10.00** | Flat, and the dominant cost |

Idle cost with no traffic is a few cents of S3 storage. Nothing bills per hour.

Guardrails: an AWS Budget at $5 with alerts at 80% actual and 100% forecast, a
CloudWatch alarm on Lambda errors, and one on invocation volume above 2000/hour —
a personal app should never see that, so it means something is broken or abused.

---

## 9. Repository layout

```
people_db/
├── project.md                     # this document
├── README.md                      # deploy + operate quickstart
├── .github/workflows/
│   ├── ci.yml                     # ruff, pytest, tsc+vite build, terraform validate
│   └── deploy.yml                 # OIDC → deploy.sh
├── scripts/
│   ├── build_lambda.sh            # cross-builds aarch64 wheels → backend/build/lambda.zip
│   ├── deploy.sh                  # build + apply + s3 sync + invalidate
│   └── set_api_key.sh             # writes the OpenCode key to SSM
├── infra/                         # Terraform (flat, grouped by concern)
│   ├── bootstrap/main.tf          # state bucket, run once
│   ├── providers.tf               # aws + aws.us_east_1 (ACM for CloudFront)
│   ├── variables.tf  locals.tf  outputs.tf
│   ├── data.tf                    # DynamoDB table, photo bucket
│   ├── auth.tf                    # Cognito pool, client, domain, the one user
│   ├── api.tf                     # Lambda, Function URL, IAM, SSM, log group
│   ├── frontend.tf                # site bucket, OACs, CF function, headers, distribution
│   ├── dns.tf                     # ACM certificate, validation, A/AAAA aliases
│   ├── observability.tf           # budget, alarms, SNS
│   └── envs/prod.tfvars
├── backend/
│   ├── requirements.txt           # runtime deps only, pinned
│   ├── pyproject.toml             # ruff, pytest, mypy config
│   ├── app/
│   │   ├── main.py                # FastAPI app + Mangum handler
│   │   ├── config.py              # env-backed settings
│   │   ├── ids.py                 # ULID
│   │   ├── models.py              # pydantic schemas — the frontend contract
│   │   ├── repository.py          # the only module that talks to DynamoDB
│   │   ├── auth.py                # PKCE exchange, cookies, JWT verification, CSRF
│   │   ├── photos.py              # presigned POST/GET
│   │   ├── llm/
│   │   │   ├── client.py          # OpenCode Go over httpx
│   │   │   ├── redact.py          # privacy filter, applied before every call
│   │   │   ├── extract.py         # note → allow-listed field diff
│   │   │   ├── tools.py           # deterministic filter/aggregate/search
│   │   │   └── chat.py            # tool-calling loop
│   │   └── routers/
│   │       ├── auth_routes.py  people.py  chat_routes.py
│   └── tests/                     # pytest + moto
└── frontend/
    ├── vite.config.ts             # react, tailwind v4, PWA
    ├── public/                    # icon.svg, icon-maskable.svg, robots.txt
    └── src/
        ├── main.tsx               # routes + auth gate
        ├── api/                   # client.ts (sha256 + CSRF + refresh), hooks.ts, types.ts
        ├── auth/AuthProvider.tsx
        ├── lib/format.ts          # dates, salary, birthdays, image resize
        ├── components/            # Chrome, Avatar, NoteComposer, ExtractionDiff
        └── pages/                 # PeopleList, PersonDetail, PersonEdit, Chat, SignIn, AuthCallback
```

---

## 10. Screens

### 10.1 People list (`/`)
Sticky search field filtering client-side across name, city, company and tags as
you type, multi-term. Rows show a 44 px avatar (or initials), **Family name, Given
name**, and a subtitle of job title · city. Sorted by family name. Floating `+`
button bottom-right, thumb-reachable. Bottom tab bar: People | Chat.

### 10.2 Person detail (`/p/:id`)
The header card is always at the top and holds exactly the fields called out as
important: photo, name, address, birthday, salary, children, job title and
description — plus contact and "how we met" when present. Empty fields render as
a tappable `+ add` rather than disappearing, and birthdays show `turns 38 · in 12
days`.

Below the header card, **Connections** lists linked people with their role,
tapping through to their profile; adding one is a role dropdown plus a person
search. Then the notes timeline, newest first, each with its conversation date.
The composer is pinned to the bottom with **Save** and **Save + extract**; the
extraction diff card appears above it. Tapping the avatar opens the camera or
photo picker; the image is downscaled in-browser before upload.

### 10.3 Person edit (`/p/new`, `/p/:id/edit`)
The full form, including a repeating children editor, chip-based tags, and the
**Exclude from AI** toggle. Birthday is a numeric `DD.MM.YYYY` field rather than
a native date picker, which took many taps to reach a 1980s year; the year is
optional and a day-and-month-only entry is stored as the ISO yearless form.

The new-person screen adds two ways to avoid typing:

- **Import from contacts.** The Contact Picker API (`navigator.contacts`) where
  it exists — Chrome on Android only — and a `.vcf` file import everywhere else,
  which is the route iOS users take (open the contact, Share, save the card).
  The file is parsed in the browser and never uploaded. The parser handles RFC
  6350 line folding, escaped characters, `N` versus `FN`, `ADR` field order, and
  yearless `BDAY`.
- **Fill from text.** Runs extraction over pasted text straight into the form.

Neither saves anything until Save is tapped.

### 10.4 Chat (`/chat`)
A message thread with the input pinned at the bottom. Assistant answers list the
people consulted as chips linking to their profiles. Empty-state suggestions:
*"Whose birthday is this month?"*, *"How many people do I know earning over
50k?"*, *"Who do I know in Munich?"* The transcript is cleared on reload — chat is
ephemeral by design.

---

## 11. Build, test, deploy

```bash
./scripts/build_lambda.sh    # → backend/build/lambda.zip (7.4 MB, cp313 aarch64 wheels)
./scripts/deploy.sh          # build + terraform apply + s3 sync + invalidate
./scripts/deploy.sh infra    # Terraform only
./scripts/deploy.sh frontend # SPA only
```

Dependencies are cross-downloaded as `manylinux2014_aarch64` / cp313 wheels, so
the artefact is byte-identical whether built on the laptop or in CI. The zip is
assembled with Python's `zipfile` at a fixed mtime rather than shelling out to
`zip`, which keeps the build reproducible and dependency-free.

State so far:

| Check | Result |
| --- | --- |
| `terraform validate` | passes |
| `terraform fmt -check -recursive` | clean |
| `ruff check app tests` | clean |
| `tsc -b && vite build` | passes — 93 KB gzipped |
| Lambda package | 7.4 MB |
| Backend tests | 20 passed |
| vCard parser | 16 checks passed against a realistic multi-card file |
| Live smoke test | `/api/health` 200, unauthenticated `/api/people` 401, POST without the CSRF header 403, login handshake sets HttpOnly cookies |

The tests cover the parts most expensive to get wrong: optimistic locking,
cascade delete, cross-user isolation, `Decimal` round-tripping, salary
annualisation, exact counting, and the guarantee that an opted-out person never
appears in an LLM payload.

First-deploy steps are in [README.md](README.md).

---

## 12. Backlog

1. **Birthday reminders** — EventBridge Scheduler on a daily cron + SNS email,
   roughly $0. Deferred by choice.
2. Business-card / screenshot import via `deepseek-v4-flash-vision-exp`.
3. Passkey (WebAuthn) sign-in — better on mobile than TOTP, needs the Cognito
   Essentials tier configuration.
4. Semantic note search, if substring search starts missing things.
5. Persisted chat history, if the ephemeral transcript turns out to be annoying.
6. `mypy --strict` in CI.

---

## 13. Known risks and how they are handled

| Risk | Handling |
| --- | --- |
| The model hallucinates a field value | It never writes; every change is a user-confirmed diff against an 18-path allow-list |
| The model miscounts an aggregation | Counting happens in Python in `filter_people`; the model only phrases the result |
| Third-party personal data leaves AWS | `ai_optout` per person, `AI_REDACT_FIELDS`, and an `ai_enabled` kill switch |
| An extraction failure loses a note | The note is persisted before the model is called; failures return `extraction_error` and the note survives |
| Lambda cold start on a phone | One small arm64 function, no VPC, ~400–700 ms. Provisioned concurrency is deliberately **not** used — it bills hourly |
| Accidental data loss | PITR 35 days, S3 versioning, DynamoDB deletion protection, `GET /api/export` |
| Cost surprise from a runaway loop | $5 budget alert, 5-round tool cap, invocation-volume alarm |
| OpenCode Go changes model ids | The model is one Terraform variable; `GET /models` is the check |
| Losing the only MFA device | Register two authenticators. Recovery path is Cognito admin access via the AWS console |
| Concurrent edits from two tabs | `version` guard returns 409 rather than silently overwriting |
| The model returns no JSON at all | `glm-5.3-flash` reasons before answering and reasoning is billed against `max_tokens`; too small a budget returns empty content with `finish_reason: "length"`. Thinking cannot be disabled, so requests send `reasoning_effort: "low"` with a 4000-token budget and retry once at double |
| A 403 on `/api/*` with no Lambda logs | Almost always the OAC permission pair above, not the application. Check `aws lambda get-policy` for both statements before looking anywhere else |
