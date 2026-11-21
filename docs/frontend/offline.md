# Worker App - Offline Foundation

> Status: Step 4 (2026-11-21). Foundation only: detection, UI and request behaviour. No data is
> stored for offline use and nothing is synchronised in this phase.

## What exists

| Piece | File | Behaviour |
|---|---|---|
| Detection | `src/services/network/connectivity.ts` | `expo-network`. Offline only when the OS is sure: no connection, or internet unreachable (captive portal). A momentary "unknown" is not treated as offline |
| Provider | `src/services/network/ConnectivityProvider.tsx` | One listener for the app; cleaned up on unmount |
| Query pause | `connectQueryOnlineManager()` | TanStack Query pauses requests while offline and resumes them afterwards |
| Banner | `OfflineBanner` in every `ScreenContainer` | "You are offline. Information will load when the connection returns." (announced) |
| Status badge | `SyncStatusIndicator` | `online`, `offline` now; `syncPending`, `syncing`, `syncFailed` reserved for the sync module |
| Start-up offline | `SessionRestoreErrorScreen` | Saved session kept; Try again / Sign out (decision M) |

## Request rules

- **Reads (GET):** retried automatically up to 2 times, only for no-response, timeout or 5xx
  (exponential back-off 2 s, 4 s). Never for 4xx.
- **Writes (POST/PATCH/DELETE):** never retried automatically. They need idempotency keys first.
- **Offline before data ever loaded:** shown as "Could not load" with a retry, not a spinner.
- **Already-loaded data:** stays on screen when a background refresh fails.
- Timeout: 20 s per request (slow networks; Argon2 login).

## Rules for the future offline module

1. Do not store child, guardian, consent or screening data on the device until the approved
   offline-security design exists (encryption at rest, key management, wipe on sign-out,
   account switching).
2. Every queued write needs a client-generated idempotency key the API honours.
3. Show `syncPending` / `syncing` / `syncFailed` only from a real sync engine; never claim data is
   synchronised without confirmation from the server.
4. Sign-out must wipe local data; account switching must never expose another worker's records.
5. SQLite (`expo-sqlite`) is the expected store, behind a repository interface in `src/services`.
