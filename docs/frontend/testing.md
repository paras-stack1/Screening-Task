# Worker App - Testing

> Status: Step 4 (2026-11-21).

## Commands

```powershell
npm test --workspace @balswasthya/worker-app        # app tests only
npm run test:watch --workspace @balswasthya/worker-app
npm run test:coverage --workspace @balswasthya/worker-app
npm run check                                       # whole repo: format, typecheck, lint, all tests
```

## Tooling

| Package | Version | Why |
|---|---|---|
| `jest-expo` | ~58.0.15 | Jest preset matching Expo SDK 58 (React Native environment, native modules mocked) |
| `jest` | ~30.5.2 | Test runner (jest-expo supports 29 and 30) |
| `@testing-library/react-native` | 14.1.0 | Queries by role/label like a screen-reader user. v14 APIs are async: `await render(...)`, `await fireEvent.press(...)` |
| `test-renderer` | 1.0.0 | Renderer required by Testing Library 14 |
| `@types/node` | ^22.20.5 | Node types for test helpers only (same range as the API) |

## Type checking

`npm run typecheck` runs two programs: `tsconfig.json` (app code: **no** Node or Jest globals, so
`Buffer`, `jest` etc. cannot slip into code that runs on phones) and `tests/tsconfig.json`
(tests: Jest + Node types).

## Test doubles (tests only)

- `tests/support/fakeBackend.ts`: an in-memory `fetch` that behaves like the Step 3 auth API
  (rotation, reuse detection, logout, `mustChangePassword` gate, generic 401, error envelope), with
  controls for offline, hanging requests and one-off responses.
- `tests/support/testServices.ts`: the **real** services (HTTP layer, SessionManager, API client,
  query cache) wired to the fake backend and an in-memory store, plus a controllable clock.
- `tests/support/renderApp.tsx`: renders the real `app/` routes with `expo-router/testing-library`.
- `tests/support/mockNetwork.ts`: controllable `expo-network` (online / offline) for screen tests.

These exist only under `tests/`. Production code has no mock data or simulated login.

## Live contract check (opt-in)

`tests/live/liveApi.test.ts` runs the real app modules against a running API. It is skipped unless
the variables below are set, so `npm test` never contacts a server. It needs a fresh account with
`mustChangePassword = true` (e.g. from `db:bootstrap-admin`) and changes that account's password.

```powershell
npm run dev:api                                   # in another terminal
$env:LIVE_API_URL="http://localhost:4000/api/v1"
$env:LIVE_LOGIN_ID="ADMIN-0001"
$env:LIVE_PASSWORD="<temporary password>"
$env:LIVE_NEW_PASSWORD="<new password, 8+ characters>"
cd apps\worker-app; npx jest tests/live
```

React Native's Jest setup replaces `fetch` with a polyfill that cannot reach a server, so this file
uses a small adapter over Node's `http` module.

## Conventions

- Tests live in `apps/worker-app/tests/`, mirroring `src/`.
- Render with `renderWithProviders` (`tests/utils/render.tsx`): safe-area + language providers,
  English by default, a fresh in-memory store. Pass `{ language: 'hi' }` to test Hindi.
- Query by role and accessible name (`getByRole('button', { name: ... })`); this doubles as an
  accessibility check. Use `testID` only when there is no accessible name.
- Any `console.error` during a test (React warnings, act() problems) fails the test.
- Never call a real backend or real device storage. Mocks exist only in `tests/`.
- Per-test timeout is 15 s because the first render in each Jest worker is slow on Windows.
