# Worker App - Configuration and Running Locally

> Status: Step 4 (2026-11-21).

## Environment (`apps/worker-app/.env`)

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Production: yes (HTTPS). Development: no | Base URL including `/api/v1` |

Rules (decision J, `src/config/env.ts`):

- Development (`expo start`): defaults to `http://localhost:4000/api/v1`; plain HTTP allowed.
- Production builds (`expo export`, EAS release builds): must be set and must be `https://`.
  Otherwise the app shows "App setup problem" and makes no network calls.
- URLs with credentials, query strings or fragments are rejected.
- Every `EXPO_PUBLIC_*` value is compiled into the app. Never put secrets here.

| Where the app runs | Value |
|---|---|
| Web browser / iOS simulator on this PC | `http://localhost:4000/api/v1` |
| Android emulator | `http://10.0.2.2:4000/api/v1` |
| Phone with Expo Go on the same Wi-Fi | `http://<PC-LAN-IP>:4000/api/v1` (and allow port 4000 in the firewall) |

## Run locally (Windows PowerShell)

```powershell
# once
npm install
Copy-Item .env.example .env                                  # repo root (database)
Copy-Item services/api/.env.example services/api/.env       # set JWT_SECRET etc.
Copy-Item apps/worker-app/.env.example apps/worker-app/.env
npm run db:up
npm run db:migrate
npm run db:setup-roles

# create the first account (prints a one-time temporary password; change it at first sign-in)
npm run db:bootstrap-admin -- --login-id ADMIN-0001 --display-name "Local Administrator"

# every time - two terminals
npm run dev:api
npm run dev:app        # press "a" for an Android emulator, or scan the QR code with Expo Go
```

The API's `CORS_ORIGINS` matters only for the web target; native apps send no Origin header.

## Expo configuration (`app.json`)

| Setting | Value | Why |
|---|---|---|
| `scheme` | `balswasthya` | Deep links |
| `orientation` | `portrait` | Field use, simpler layouts |
| `userInterfaceStyle` | `light` | One tested colour scheme |
| `plugins` | `expo-router`, `expo-localization`, `expo-secure-store` | SecureStore plugin also excludes stored secrets from Android Auto Backup |
| `experiments.typedRoutes` | `true` | Typed `href`s |
