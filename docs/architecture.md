# BalSwasthya AI - Architecture

> **Scope:** BalSwasthya AI supports **screening** of children under the RBSK programme
> (Uttar Pradesh). It does **not** diagnose. Every screen, API response and AI output
> must be framed as screening support that leads to referral and clinical review.

## 1. System overview

```
 ┌──────────────────────────┐        HTTPS / JSON (REST, /api/v1)
 │  Worker app (Expo / RN)  │ ───────────────────────────────────────┐
 │  ASHA & Anganwadi workers│                                        │
 │  apps/worker-app         │  only public config (EXPO_PUBLIC_*)    ▼
 └──────────────────────────┘                          ┌──────────────────────────┐
                                                       │  API (Express + TS)      │
                                                       │  services/api            │
                                                       │  auth, validation (Zod), │
                                                       │  business rules, audit   │
                                                       └─────┬──────────────┬─────┘
                                       Prisma 6 (SQL, pool)  │              │ HTTP + X-API-Key, timeout
                                                             ▼              ▼  (optional dependency)
                                              ┌──────────────────┐  ┌───────────────────────────┐
                                              │  PostgreSQL 17   │  │  AI service (FastAPI)     │
                                              │  Docker (local)  │  │  services/ai-service      │
                                              └──────────────────┘  │  owned by the AI team     │
                                                                    └───────────────────────────┘
```

Shared request/response contracts live in `packages/shared-contracts` and are imported
by both the app and the API.

### Communication rules

| From → To            | Allowed? | How                                                                 |
|----------------------|----------|---------------------------------------------------------------------|
| App → API            | Yes      | REST over HTTPS, JSON, validated with shared Zod schemas            |
| App → Database       | **No**   | Never. The app holds no DB credentials.                             |
| App → AI service     | **No**   | Never. All AI calls go through the API (auth, consent, audit, keys) |
| API → Database       | Yes      | Prisma client (`src/config/database.ts`)                            |
| API → AI service     | Yes      | Only via `src/integrations/ai-service/aiServiceClient.ts`           |

## 2. Repository layout

```
balswasthya-ai/
├── apps/
│   └── worker-app/                 Expo SDK 58, React Native, expo-router, TypeScript
│       ├── app/                    Routes (file-based). _layout.tsx = providers + stack
│       ├── src/
│       │   ├── components/         Reusable UI (AppCard, PrimaryButton, LanguageToggle...)
│       │   ├── constants/          Theme tokens, public config
│       │   ├── hooks/              useTranslation, useApiHealth...
│       │   ├── i18n/               English + Hindi strings, LanguageProvider
│       │   ├── services/           API client (fetch + Zod validation) and API calls
│       │   ├── types/              App-local types
│       │   └── utils/
│       └── assets/
├── services/
│   ├── api/                        Express 5 + TypeScript + Prisma 6 + Zod
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── config/             env.ts (validated env), database.ts (Prisma client)
│   │       ├── middleware/         requestId, requestLogger, validate, errorHandler
│   │       ├── integrations/
│   │       │   └── ai-service/     The ONLY code that talks to the AI service
│   │       ├── modules/            auth, users, children, guardians, consent,
│   │       │                       screening, referrals, facilities (empty in Step 1)
│   │       ├── routes/             /api/v1 router, health routes
│   │       ├── utils/              AppError, logger
│   │       ├── app.ts              Builds the Express app (no listen - testable)
│   │       └── server.ts           Starts HTTP server, graceful shutdown
│   └── ai-service/                 FastAPI placeholder: GET /health only, no models
├── packages/
│   └── shared-contracts/           Zod schemas + TS types shared by app and API
├── infrastructure/
│   └── docker-compose.yml          Local PostgreSQL (named volume + health check)
└── docs/
    └── architecture.md
```

Tooling: **npm workspaces** (one `npm install` at the root). The AI service is Python and
is intentionally **not** an npm workspace.

## 3. Backend design

**Request pipeline** (`app.ts`):
`helmet` → `cors` (allow-list) → `requestId` → `requestLogger` → `express.json (1 MB)`
→ `/api/v1` routes → `notFoundHandler` → `errorHandler`.

**Module pattern** (see `services/api/src/modules/README.md`):
`routes → (validate middleware) → controller → service → Prisma / integrations`.

**Errors:** every error response uses one shape, defined in shared-contracts:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "requestId": "..." } }
```

Unexpected errors return a generic 500 message; details go to logs only.

**Configuration:** `src/config/env.ts` validates all environment variables with Zod at
startup. The process exits with a list of the invalid *variable names* (never their values).

### Health endpoints

| Endpoint                     | Purpose   | Behaviour                                                               |
|------------------------------|-----------|-------------------------------------------------------------------------|
| `GET /api/v1/health`         | Liveness  | Always 200 while the process runs. No DB access.                        |
| `GET /api/v1/health/ready`   | Readiness | DB down → **503 unavailable**. AI down → **200 degraded**. All up → 200 ready. AI URL empty → `not_configured`. |
| `GET /health` (ai-service)   | Liveness  | `{status, service, version, modelsLoaded}` - `modelsLoaded` is `false` in the placeholder. |

## 4. AI service integration (future)

The AI team builds the Python service independently. Integration is designed so the
application architecture does not change when their endpoints arrive:

1. Agree the request/response schema and add it to `packages/shared-contracts/src/ai.ts`.
2. Add a function (e.g. `requestScreeningSupport()`) to `aiServiceClient.ts`.
3. Call it from `modules/screening/screening.service.ts`.

**Resilience rules**
- Every AI call has a timeout (`AI_SERVICE_TIMEOUT_MS`).
- AI failure never blocks the workflow: the questionnaire is saved, and the result is
  marked "AI support unavailable".
- No AI result is ever fabricated or simulated in production code paths.
- Stored AI outputs must record the model name/version and be labelled as screening
  support, not diagnosis. Clinical accuracy claims require validated evidence.

## 5. Security & privacy baseline

| Area               | Decision                                                                                       |
|--------------------|------------------------------------------------------------------------------------------------|
| Secrets            | Only in `services/api/.env` (git-ignored). Never in `EXPO_PUBLIC_*` variables.                 |
| Mobile config      | Only the API base URL is public. Verified: the compiled app bundle contains no secrets.       |
| Database exposure  | Docker binds PostgreSQL to `127.0.0.1` only.                                                   |
| Logging            | Method, path, status, duration, request id. **No bodies, query strings, names, or identifiers.** |
| Headers            | `helmet` defaults; `X-Powered-By` disabled.                                                    |
| CORS               | Explicit browser-origin allow-list. Native apps send no Origin and are unaffected.             |
| Auth (next steps)  | JWT (short-lived access token) + secure password hashing; role-based access per module.        |
| Consent            | Explicit, timestamped, versioned consent record checked before any screening is stored.        |
| Data               | Synthetic data only in development and test. Real child data never committed or logged.       |
| IDs                | UUID primary keys so record ids are not guessable.                                            |

## 6. Frontend design

- **Navigation:** expo-router, file-based routes in `app/`.
- **i18n:** all strings in `src/i18n/translations.ts`. Hindi must define every English key
  (enforced by TypeScript). The default follows the device language and can be switched in-app.
  Hindi copy should be reviewed by programme staff before release.
- **Accessibility:** touch targets ≥ 48 dp (primary buttons 56 dp), body text 17 pt,
  `accessibilityRole` / labels on interactive elements, high-contrast colours.
- **Theme:** primary `#1769AA`, secondary/teal `#16A6A0`, background `#F3F7FA`, white cards
  (`src/constants/theme.ts`).
- **Data access:** `src/services/apiClient.ts` validates every response against the shared
  Zod schema and returns friendly errors (timeout, offline, contract mismatch).

## 7. Local ports

| Service          | Port                         |
|------------------|------------------------------|
| API              | 4000                         |
| AI placeholder   | 8000                         |
| PostgreSQL       | 5433 on host → 5432 in container (5432 is often used by a native Postgres install) |
| Expo dev server  | 8081                         |

## 8. Deployment (later)

Local first. For the cloud: containerise the API, use a managed PostgreSQL with backups and
encryption at rest, keep secrets in a secret manager, TLS everywhere, and build the app with
EAS. Data residency for Indian government health data must be confirmed before choosing a
region/provider.
