# Worker App - Navigation

> Status: Step 4 (2026-11-21). Expo Router (SDK 58), file-based routes in `apps/worker-app/app/`.

## Routes

| File | Path | Shown when |
|---|---|---|
| `app/_layout.tsx` | - | Root: providers, start-up states, guards |
| `app/login.tsx` | `/login` | No session |
| `app/change-password.tsx` | `/change-password` | Signed in and `mustChangePassword` |
| `app/(app)/_layout.tsx` | - | Bottom tabs; signed in, no password change pending |
| `app/(app)/index.tsx` | `/` | Home (dashboard) |
| `app/(app)/notifications.tsx` | `/notifications` | Notifications |
| `app/(app)/profile.tsx` | `/profile` | Profile |
| `app/(app)/settings.tsx` | `/settings` | Settings (language, sign out) |
| `app/+not-found.tsx` | any unknown path | Always |

## Start-up sequence

1. The native splash stays up (`SplashScreen.preventAutoHideAsync`).
2. If the build has no valid API address: "App setup problem" screen, no network calls.
3. Language preference and saved session are read; the session is refreshed once.
4. Splash hides. Restoring -> loading screen; server unreachable -> "Cannot connect" screen.
5. Otherwise the Stack renders with exactly one area enabled:

```tsx
<Stack.Protected guard={!signedIn}>                       login
<Stack.Protected guard={mustChangePassword}>              change-password
<Stack.Protected guard={signedIn && !mustChangePassword}> (app) tabs
```

A disabled screen is not mounted at all. Navigating to it (deep link, back button, stale history)
redirects to the first enabled screen. When the session changes (sign-in, sign-out, expiry,
password-change requirement) the guards switch and the router moves automatically - screens never
navigate after login/logout themselves, which avoids navigation loops.

## Deep links

Scheme `balswasthya://`. Without a session every protected link lands on `/login`; after signing in
the user starts at Home (the original link is not resumed - deliberate, so a link cannot carry a
user into an unexpected screen). Unknown paths show the not-found screen with a "Go to home" button.

## Rules

- Route guards are UX only; never treat them as authorisation.
- Screens inside `(app)` use `useAuthenticatedUser()`, which returns `null` during the moment of
  sign-out; render nothing in that case.
- Keep primary navigation at four tabs. New features go inside existing tabs or as stack screens.

## Tests

`tests/navigation/appNavigation.test.tsx` renders the real `app/` directory with
`expo-router/testing-library` and covers start-up, deep links, guards, not-found, login,
logout, session expiry, account switching and the forced password change.
