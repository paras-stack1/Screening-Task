# BalSwasthya AI

AI-assisted **child health screening support** platform for the RBSK programme,
Government of Uttar Pradesh. Built for ASHA and Anganwadi workers: simple,
bilingual (Hindi / English), mobile-first.

> ⚠️ **Screening support, not diagnosis.** This software helps workers screen and refer
> children. It does not diagnose and makes no claim of clinical accuracy.
> Use **synthetic data only** during development.

| Part                          | Tech                                          | Owner     |
|-------------------------------|-----------------------------------------------|-----------|
| `apps/worker-app`             | React Native, Expo SDK 58, expo-router, TS    | App team  |
| `services/api`                | Node.js 22, Express 5, TypeScript, Prisma 6, Zod | App team  |
| `packages/shared-contracts`   | Zod schemas + TS types shared by app and API  | App team  |
| `services/ai-service`         | Python, FastAPI (**placeholder only**)        | AI team   |
| `infrastructure`              | Docker Compose - PostgreSQL 17                | App team  |

Architecture and design decisions: [docs/architecture.md](docs/architecture.md).

---

## Prerequisites

| Tool            | Version            | Check                    |
|-----------------|--------------------|--------------------------|
| Node.js         | 22 LTS (22.12+)    | `node -v`                |
| npm             | 10+                | `npm -v`                 |
| Docker Desktop  | running            | `docker info`            |
| Git             | any recent         | `git --version`          |
| Python          | 3.13 (AI placeholder only) | `py -3.13 --version` |
| Expo Go app     | on your phone (optional) | -                  |

---

## First-time setup (PowerShell)

Run from the repository root (`balswasthya-ai`):

```powershell
# 1. Install all JavaScript dependencies (app + API + shared contracts).
#    This also runs "prisma generate" for the API.
npm install

# 2. Create your local env files from the examples.
Copy-Item .env.example .env
Copy-Item services\api\.env.example services\api\.env
Copy-Item apps\worker-app\.env.example apps\worker-app\.env
```

3. **Edit the secrets** (use a text editor). Generate each random value with:

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')
   ```

   | File | Set | Notes |
   |------|-----|-------|
   | `.env` | `POSTGRES_PASSWORD` | Owner account (migrations only) |
   | `.env` | `APP_DB_PASSWORD` | Runtime account the API uses |
   | `services\api\.env` | `DATABASE_URL` | `balswasthya_app` + the `APP_DB_PASSWORD` value |
   | `services\api\.env` | `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL` | `balswasthya` + the `POSTGRES_PASSWORD` value |
   | `services\api\.env` | `JWT_SECRET` | 32+ characters |

```powershell
# 4. Build the shared contracts package (the app and API import its compiled output).
npm run build:contracts

# 5. Database: start it, apply migrations (owner account), create the runtime account,
#    load synthetic reference data.
npm run db:up
npm run db:migrate
npm run db:setup-roles
npm run db:seed

# 6. (Optional, for `npm run test:db`) create the disposable test database once.
docker exec balswasthya-postgres psql -U balswasthya -d balswasthya_dev -c "CREATE DATABASE balswasthya_test"
```

**Two database accounts.** The API connects as `balswasthya_app`, which can read and write data
but cannot change tables, read migration history or modify the audit log. Only Prisma Migrate uses
the owner account. Details: [docs/database-design.md](docs/database-design.md).

---

## Run locally (PowerShell)

Use a separate terminal for each service.

### Terminal 1 - PostgreSQL (Docker)

```powershell
npm run db:up
docker ps --filter name=balswasthya-postgres   # STATUS should show "(healthy)"
```

### Terminal 2 - API

```powershell
npm run dev:api
```

Check it (in another terminal):

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:4000/api/v1/health/ready
```

`/health/ready` reports `database: up`. `aiService` is `down` if the AI placeholder is not
running - the API then reports `degraded`, which is expected and harmless.

### Terminal 3 - AI service placeholder (optional)

```powershell
cd services\ai-service
py -3.13 -m venv .venv          # first time only
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt  # first time only
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

If PowerShell blocks `Activate.ps1`, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### Terminal 4 - Mobile app (Expo)

```powershell
npm run dev:app
```

Then press `a` for an Android emulator, or scan the QR code with **Expo Go**.

**Signing in:** there are no built-in accounts. Create the first one once (prints a one-time
temporary password that must be changed at first sign-in):

```powershell
npm run db:bootstrap-admin -- --login-id ADMIN-0001 --display-name "Local Administrator"
```

Worker app details: [docs/frontend/README.md](docs/frontend/README.md).

**Phone on Wi-Fi:** `localhost` on a phone means the phone itself. Set
`EXPO_PUBLIC_API_BASE_URL=http://<your-PC-IP>:4000/api/v1` in `apps\worker-app\.env`
(find the IP with `ipconfig`), restart Expo, and allow Node.js through Windows Firewall
on private networks. Android emulator: use `http://10.0.2.2:4000/api/v1`.

### Run the app in a web browser

Fastest way to try the app on a PC - no phone or emulator needed.

```powershell
npm run db:up      # Terminal 1 (if not already running)
npm run dev:api    # Terminal 2
npm run dev:web    # Terminal 3
```

Open **http://localhost:8081** (or press `w` in the Expo terminal). You should see the sign-in
screen. To preview at phone size, press `F12` in the browser and turn on the device toolbar
(`Ctrl+Shift+M`).

Notes:
- Keep `EXPO_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1` for the browser.
- `http://localhost:8081` must be listed in `CORS_ORIGINS` in `services\api\.env` (it is by default).
  If you change the Expo port, add the new origin there and restart the API.
- The web build is for development and demos. The product target is the Android/iOS app; some
  native features added later (camera, offline storage) may behave differently on web.
- On web the sign-in session is kept in memory only: reloading the page signs you out (by design;
  there is no secure storage in a browser).

### Run the admin web portal

For state, district and block administrators and supervisors: accounts, roles and area
assignments (never child data). Details: [docs/admin-portal/README.md](docs/admin-portal/README.md).

```powershell
Copy-Item apps\admin-portal\.env.example apps\admin-portal\.env   # once
npm run dev:api      # Terminal 1 (database running)
npm run dev:admin    # Terminal 2
```

Open **http://localhost:5173**. `services\api\.env` must list the portal in `CORS_ORIGINS`
(`CORS_ORIGINS=http://localhost:8081,http://localhost:5173`); restart the API after changing it.
Forgot a password on your local development database? `npm run db:dev-reset-password -- --login-id
ADMIN-0001` prints a one-time password (development only; refused when `NODE_ENV=production`).

Sign in with an administrator account (`npm run db:bootstrap-admin`); field-worker accounts are
told the portal is for administrators.

### Stop everything

`Ctrl+C` in each terminal, then:

```powershell
npm run db:down        # stops the container; data stays in the named volume
```

To **delete** all local database data: `docker volume rm balswasthya_pgdata` (irreversible).

---

## Useful commands

| Command (from repo root)                                   | What it does                                     |
|------------------------------------------------------------|--------------------------------------------------|
| `npm run check`                                            | **Run before every commit:** format check, typecheck, lint, tests |
| `npm test`                                                 | API unit tests (Vitest + Supertest) and worker-app tests (Jest); no database needed |
| `npm test --workspace @balswasthya/worker-app`             | Worker-app tests only ([docs/frontend/testing.md](docs/frontend/testing.md)) |
| `npm run test:db`                                          | Database tests: access-control scenarios and DB rules (needs Docker + `balswasthya_test`) |
| `npm run db:migrate`                                       | Create/apply migrations in development (owner account) |
| `npm run db:setup-roles`                                   | Create/update the least-privilege runtime account (idempotent; also rotates its password) |
| `npm run db:seed`                                          | Load synthetic reference data (levels, roles, permissions, demo areas) |
| `npm run lint`                                             | ESLint (API/contracts: typed rules; app: `expo lint`) |
| `npm run format`                                           | Formats code with Prettier (`format:check` only checks) |
| `npm run test:watch --workspace @balswasthya/api`          | Re-runs API tests on file changes                |
| `npm run typecheck`                                        | Builds contracts, type-checks app + API          |
| `npm run build --workspace @balswasthya/api`               | Compiles the API to `services/api/dist`          |
| `npm run prisma:validate --workspace @balswasthya/api`     | Checks `schema.prisma`                           |
| `npm run prisma:deploy --workspace @balswasthya/api`       | Applies committed migrations (non-destructive; staging/production) |
| `npm run prisma:studio --workspace @balswasthya/api`       | Opens Prisma Studio database browser             |
| `cd apps\worker-app; npx expo install <pkg>`               | Adds an Expo package with an SDK-compatible version |
| `cd apps\worker-app; npx expo-doctor`                      | Diagnoses Expo dependency problems               |

---

## Environment variables & secrets

| File                         | Contains                                | Committed? |
|------------------------------|-----------------------------------------|------------|
| `.env`                       | Docker Postgres owner + runtime account passwords, port | **No** |
| `services/api/.env`          | `DATABASE_URL` (runtime), `MIGRATION_DATABASE_URL` (owner), `TEST_DATABASE_URL`, `JWT_SECRET`, AI key | **No** |
| `apps/worker-app/.env`       | `EXPO_PUBLIC_API_BASE_URL` only         | **No**     |
| `*.env.example`              | Placeholder values, documentation       | Yes        |

**Rule:** anything named `EXPO_PUBLIC_*` is compiled into the app and readable by anyone.
Never put passwords, database URLs, JWT secrets or API keys there.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm install` fails with `EPERM ... query_engine-windows.dll.node` | The API is running and Windows has locked Prisma's engine file. Stop **every** API terminal (`Ctrl+C`), then run `npm install` again. Check for leftover servers with `Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| Select ProcessId, CommandLine`. |
| `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` | An earlier install was interrupted. Stop all dev servers, delete `node_modules\.prisma\client\*.tmp*`, and run `npm install` again. |
| `failed to connect to the docker API` | Start Docker Desktop and wait until it says "Engine running". |
| Port 5433 already in use | Change `POSTGRES_HOST_PORT` in `.env` **and** the port in `DATABASE_URL`. |
| API exits with `Invalid environment configuration` | The message lists which variables are missing/invalid in `services/api/.env`. |
| `password authentication failed for user "balswasthya_app"` | Run `npm run db:setup-roles` (it sets the password from `APP_DB_PASSWORD`), and check `DATABASE_URL` uses the same password. |
| `npm run test:db` fails with `database "balswasthya_test" does not exist` | Create it once - see First-time setup step 6. |
| Prisma refuses `migrate reset` ("invoked by Claude Code" / an AI agent) | Intended safety check. Run destructive commands yourself, only against a development database. |
| App shows "Cannot reach the server" on a phone | See "Phone on Wi-Fi" above. |
| App shows "App setup problem" | A production build (`expo export`, release build) needs an `https://` `EXPO_PUBLIC_API_BASE_URL`. Use `npm run dev:app` for local development. |
| Type errors about route paths (`"/profile" is not assignable...`) after adding a screen | Typed routes are regenerated by `npm run dev:app`; start it once, then re-run the type check. |
| `expo-doctor` reports duplicate `react` | Keep the root `overrides.react` equal to the app's `react` version, then delete `package-lock.json` and `node_modules` and run `npm install`. |

---

## Project status

**Step 1 - Foundation: done.** Monorepo, app shell (routing, theme, Hindi/English,
API health card), API skeleton (config, middleware, error handling, health/readiness),
Prisma 6 connection, Docker PostgreSQL, AI placeholder, shared contracts, docs.

**Step 1b - Quality and hardening: done.** ESLint, Prettier, Vitest + Supertest API tests,
pino logging with redaction, production configuration guard, readiness caching, AI client
size/redirect limits, safer error handling. See [docs/architecture.md](docs/architecture.md) §3 and §7.

**Step 2 - Database design: approved.** [docs/database-design.md](docs/database-design.md) (v0.1).

**Step 3 - Database foundation: done.** Full schema and first migration (with hierarchy trigger,
assignment-overlap exclusion, append-only audit), least-privilege runtime account, synthetic seed,
area-scoped access-control module, and database tests for the design's scenarios.

**Step 3 (authentication & authorization) - done.**
Stage 2 done: Argon2id passwords, login with generic errors and temporary lockout, 15-minute JWT
access tokens, rotating refresh tokens with reuse detection, session revocation, password change,
rate limiting ([docs/authentication.md](docs/authentication.md)).
Stage 3 done: role-based permissions, area-scoped access for every child-linked record, read-only
child list/profile, user and assignment administration, first-admin bootstrap
([docs/authorization.md](docs/authorization.md)).
Stage 4 done (delivered with Step 4): the worker app signs in, refreshes and signs out against this
API, verified live ([docs/frontend/authentication.md](docs/frontend/authentication.md)).

**Step 4 - Frontend foundation: submitted for review.** Design system, Hindi/English localization,
secure sign-in with token refresh, forced password change, protected navigation, dashboard (real
registered-children total; other metrics marked "not available yet"), profile, settings, offline
indicator. See [docs/frontend/README.md](docs/frontend/README.md).

Not implemented yet (by design): child registration, guardians, consent, screening, AI, referrals,
follow-ups, notifications, offline data storage and sync.


---

<!-- The section below is the README of the Child Health Screening Platform (backend/, frontend/), kept as it was. -->

# Child Health Screening Platform (Across the 4Ds + Skin & Eye)

A multi-modal pediatric health screening web application combining **Deep Learning Computer Vision** (Skin & Eye models) with a **Privacy-First Real-Time Video Biomechanical Screening Module** mapped across **The 4Ds**:
1. **Defects at birth** (e.g., Congenital hip dysplasia, club foot, spinal dysraphism)
2. **Deficiencies** (e.g., Nutritional Rickets / lower-limb bowing, severe stunting)
3. **Diseases** (e.g., Cerebral palsy spasticity, neuromuscular dystrophies, ataxias)
4. **Development delays & disabilities** (e.g., Gross motor delays, autism auditory orienting latency, stereotypies)

Built with **FastAPI**, **MediaPipe Tasks Vision**, and an interactive **Chart.js** frontend with live biomechanical telemetry.

---

## 🎯 Modules & Features

### 1. 🎥 Real-Time Video Child Screening (Across the 4Ds)
- **Zero Video Storage / Privacy-First Architecture**:
  - Raw video streams are processed exclusively inside the browser via client-side WebAssembly (**MediaPipe Tasks Vision `PoseLandmarker`**).
  - **No `.mp4` video files are ever recorded, saved, or uploaded.**
  - Extracts 33 3D skeletal landmarks and face metrics at `10 FPS` over a guided 10–15s protocol (~50 KB JSON payload) sent to `POST /analyze-video-landmarks`.
- **Live Canvas HUD Overlay**:
  - Draws glowing skeletal joints and connecting bones live on a canvas overlaid on the video feed.
  - Live full-body framing indicator badge (detects head and ankle visibility).
  - Auditory cue prompt (Web Audio API 880 Hz chime) at 3.0s for social orienting tasks.
- **Live Biomechanical Telemetry Panel**:
  - Real-time live readings of:
    - Full-body framing status (`Head & Ankles Visible`)
    - Left & Right knee angles (degrees)
    - Spine tilt angle from vertical (degrees)
    - Stride / ankle separation
    - Head yaw angle & camera gaze status
- **Two-Stage Invariant Biomechanical Analysis**:
  - **Stage 1 (Coordinate Normalization)**:
    - Origin Shift: Subtract Mid-Hip $H_{mid} = \frac{P_{23} + P_{24}}{2}$
    - Scale Normalization: Divide by Torso Length $L_{torso} = \|S_{mid} - H_{mid}\|_2$
  - **Stage 2 (Time-Series Algorithms)**:
    - **Spine Tilt ($\theta_{spine}$)**: Angle of torso vector relative to vertical (Baseline: Green $\le 12^\circ$, Yellow $12^\circ–22^\circ$, Red $> 22^\circ$).
    - **Gait Symmetry Index (GSI)**: Ratio of left vs right step amplitude (Baseline: Green $\ge 0.85$, Yellow $0.70–0.84$, Red $< 0.70$).
    - **Lower-Limb Alignment**: Inter-condylar vs inter-malleolar distance ratio for age $> 24$ mo (Bowed legs / Knock knees / Rickets).
    - **Balance Sway ($\sigma$)**: Lateral center-of-mass oscillation standard deviation.
    - **FFT Tremor / Stereotypy**: Fast Fourier Transform on wrist velocity detecting rhythmic oscillations in the 1.5–4.5 Hz band.
    - **Auditory Orienting Latency ($\Delta t$)**: Time to head turn ($>10^\circ$) after name call (Baseline: Green $\le 2.0$s, Yellow $2.0–4.0$s, Red $> 4.0$s).
    - **Eye Contact %**: Percentage of frames maintaining forward central gaze.

---

### 2. 📸 Skin Image Classifier (`skin_model.keras`)
- Classifies 8 skin condition classes: `Acne_Mild`, `Acne_Moderate`, `Acne_Severe`, `Eczema_Mild`, `Eczema_Moderate`, `Eczema_Severe`, `Normal`, `Xyz`.
- Returns top condition, confidence percentage, and full probability breakdown with interactive Chart.js bar and doughnut charts.

---

### 3. 👁️ Eye Health Classifier (`best_eye_mobilenetv3_small.keras`)
- Classifies 5 eye conditions: `Cataract`, `Conjunctivitis`, `Eyelid`, `Normal`, `Uveitis`.
- Uses **Test-Time Augmentation (Flip TTA)**: Averages predictions on the original and horizontally flipped images (`(probs_orig + probs_flip) / 2.0`) for enhanced clinical accuracy.

---

## 📁 Repository Structure

```
Screening-Task/
├── backend/
│   ├── main.py                             # FastAPI server (Skin, Eye & Video routes)
│   ├── video_analyzer.py                   # 4Ds Biomechanical Normalization & Time-Series Engine
│   ├── requirements.txt                    # Python dependencies
│   ├── skin_model.keras                    # Trained skin classification model
│   └── best_eye_mobilenetv3_small.keras    # Trained eye classification model
├── frontend/
│   ├── index.html                          # Single-page UI with 3 screening tabs
│   ├── style.css                           # Modern responsive styling & HUD telemetry
│   └── script.js                           # MediaPipe Pose tracking, Chart.js & API client
├── Dockerfile                              # Production Docker image
├── docker-compose.yml                      # 1-command Docker Compose setup
├── deploy_ec2.sh                           # 1-click automated setup script for AWS EC2
└── README.md
```

---

## 💻 Local Setup & Execution

### Prerequisites
- Python 3.10 or 3.11 (64-bit)

### Run with Python & Uvicorn

1. **Clone the repository:**
   ```bash
   git clone https://github.com/paras-stack1/Screening-Task.git
   cd Screening-Task
   ```

2. **Create and activate a virtual environment:**
   - **Windows:**
     ```powershell
     python -m venv .venv
     .venv\Scripts\activate
     ```
   - **Linux / macOS:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install dependencies:**
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Start the application:**
   ```bash
   cd backend
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

5. Open your browser at:
   - **Web UI:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
   - **Swagger API Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## ☁️ Deployment on AWS EC2

### Update Running EC2 Instance
If already deployed on your EC2 instance (`16.179.162.6`):

```bash
ssh -i /path/to/aws-eye-key.pem ubuntu@16.179.162.6
cd Screening-Task
git pull origin main
sudo systemctl restart screening
```

---

## ⚠️ Medical Disclaimer
This platform is a **developmental screening and triage prototype**. The machine learning models and biomechanical algorithms are non-diagnostic and not validated for clinical diagnosis. Always consult a qualified pediatrician or medical professional for health evaluations and treatment decisions.
