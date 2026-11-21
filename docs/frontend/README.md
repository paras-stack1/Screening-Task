# Worker App (Frontend) - Architecture

> Status: Step 4 complete, submitted for review (2026-11-21). App: `apps/worker-app`.
> Stack: Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 (strict), Expo Router 58,
> TanStack Query 5, React Hook Form 7 + Zod 4, Expo SecureStore, expo-network.

| Topic | Document |
|---|---|
| Run it locally, environment, Expo config | [configuration.md](configuration.md) |
| Design tokens and components | [design-system.md](design-system.md) |
| Hindi / English | [localization.md](localization.md) |
| Routes, guards, deep links | [navigation.md](navigation.md) |
| Sign-in, tokens, refresh, API client | [authentication.md](authentication.md) |
| Offline foundation | [offline.md](offline.md) |
| Accessibility | [accessibility.md](accessibility.md) |
| Tests | [testing.md](testing.md) |

## 1. Folder structure

```text
apps/worker-app/
  app/                       Routes only (Expo Router). Thin screens composed from src/.
    _layout.tsx              Providers, start-up states, Stack.Protected guards
    login.tsx  change-password.tsx  +not-found.tsx
    (app)/                   Signed-in tabs: index (Home), notifications, profile, settings
  src/
    config/env.ts            Validated public config (API URL, HTTPS rule)
    theme/                   Tokens: colors, typography, spacing, radius, shadows
    components/              Reusable UI (buttons/, cards/, common/, feedback/, forms/)
    localization/            en.ts (source of keys), hi.ts, provider, translate()
    services/
      api/                   http.ts (transport), client.ts (authenticated), errors, messages
      storage/               secureStorage.ts - the only persistent store
      query/                 TanStack Query client and keys
      network/               Connectivity detection + provider
      appServices.tsx        Creates the single instance of each service
    features/
      auth/                  SessionManager, auth API, AuthProvider, forms, validation
      dashboard/             Metrics hook, dashboard sections
      profile/               Role / area display names
  tests/                     Jest + Testing Library (mirrors src/), fake backend, live suite
```

## 2. Layers and data flow

```text
screen (app/)  ->  feature hook (useMe, useRegisteredChildren)  ->  TanStack Query cache
                                                                     |
                                                       api client (client.ts)
                                                                     |
                                     SessionManager.authorized()  (token, 1 refresh + 1 retry)
                                                                     |
                                                       http.ts  ->  Express API /api/v1
```

- Screens never call `fetch`; features never build URLs with personal data.
- Responses are validated against `@balswasthya/shared-contracts` (the same Zod schemas the API
  uses), so a contract break fails loudly instead of rendering wrong data.

## 3. State

| Kind | Where | Persisted? |
|---|---|---|
| Session (status, signed-in user) | `SessionManager` -> `useAuth()` (via `useSyncExternalStore`) | Refresh token only, in SecureStore |
| Access token | `SessionManager` memory | Never |
| Server data (`/auth/me`, children total) | TanStack Query, keys prefixed with user id | Never (memory; cleared at sign-out) |
| Language | `LanguageProvider` | SecureStore `bs.language` |
| Connectivity | `ConnectivityProvider` | No |
| Form input | React Hook Form, per screen | No |

No Redux/Zustand: the app has one piece of global client state (the session), which a small
class plus React context covers.

## 4. Dependencies added in Step 4

All installed with `npx expo install` (SDK-checked) or pinned, each released at least two weeks
before installation.

| Package | Version | Kind | Purpose |
|---|---|---|---|
| `expo-secure-store` | ~58.0.3 | runtime | Refresh token, language |
| `expo-network` | ~58.0.5 | runtime | Connectivity |
| `@expo/vector-icons` | ^15.0.2 | runtime | One icon font (Material Community) |
| `@tanstack/react-query` | ^5.108.2 | runtime | Server state |
| `react-hook-form` | ^7.92.0 | runtime | Forms |
| `@hookform/resolvers` | ^7.0.8 | runtime | Zod resolver |
| `jest-expo` | ~58.0.15 | dev | Jest preset for SDK 58 |
| `jest` / `@types/jest` | ~30.5.2 / ~30.0.0 | dev | Test runner |
| `@testing-library/react-native` / `test-renderer` | 14.1.0 / 1.0.0 | dev | Component tests |
| `@types/node` | ^22.20.5 | dev | Test helpers only |

Android release bundle (Hermes): about 4.4 MB; one font file.

## 5. Known limitations (Step 4)

| Area | Limitation |
|---|---|
| Device testing | Not run on an Android device or emulator (none available to the team that built Step 4). Keyboard behaviour on Android, real Devanagari rendering and TalkBack must be checked manually |
| Hindi text | Written by the development team; needs native-speaker review. 4-D category wording needs domain-expert review |
| Dashboard | Only "Registered children" has an API source. Screened today, follow-ups, referrals and notifications have no endpoints yet |
| Language | Not synced to the account (no API endpoint) |
| Offline | Detection and UI only; no offline data or sync (later phase) |
| Sessions | "Sign out everywhere" and the session list exist in the API but have no UI yet |
| Web | Development only; session not kept across reloads |
| Tab accessibility | React Navigation exposes tabs as buttons with a selected state (read as "Home, button, selected") |
| Security | Refresh tokens are bearer tokens (no device binding); a rooted device can read SecureStore |
