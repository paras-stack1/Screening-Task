# BalSwasthya Parent Portal (Expo app)

The parents' app (Step 8, decision PP1): Android and web from one Expo Router project. Hindi by
default, English available. API: [docs/api/parent-portal.md](../../docs/api/parent-portal.md).

## Screens

| Screen | Route | Notes |
|---|---|---|
| Invitation landing | `/invite#<token>` | Reads the token from the link fragment, then removes it from the address bar. Shows only the masked number. |
| Mobile verification / code | `/verify` | 6-digit SMS code, attempts left, resend after 60 s. |
| Create password | `/create-password` | Password + confirmation, privacy notice and terms (placeholder text is marked as draft), "no consent is granted" note. |
| Activation success | `/activated` | Then the parent signs in. |
| Login | `/login` | Mobile number + password; one generic error. |
| Forgot password | `/forgot-password` | Same message for every number; code + new password. |
| Dashboard | `/home` | "Namaste!", child card (initials, age, centre), My Care Plan, Learning Videos, Follow-up Dates, Get Assistance, next check-up. |
| Child selection | `/children` | Only children shared with this parent. |
| Follow-up dates | `/follow-ups` | Upcoming check-ups and doctor appointments (dates only). |
| Get assistance | `/assistance` | Worker name and centre - no phone numbers. |
| Account and security | `/settings`, `/change-password`, `/change-phone` | Masked number, password change, number change (code to the new number), sign out, sign out everywhere, language. |

My Care Plan and Learning Videos show "Coming soon" until the Parent Care content stages (8B-8F).

## Security

- The invitation token and activation ticket stay in memory only; they are never stored.
- Access token: memory only. Refresh token: Android SecureStore; in a browser an httpOnly
  SameSite=Strict cookie set by the API (`/parent/auth/web/*`), never readable by scripts.
- Portal screens are mounted only with a session; the API checks every request on its own and only
  returns children shared with the signed-in parent.
- Children are shown with initials, never photographs. No screening results, notes or diagnoses.
- App code may not log (`no-console` is an error).

## Run locally

```powershell
Copy-Item apps/parent-app/.env.example apps/parent-app/.env   # API address
npm run dev:api                                               # API on :4000
npm run dev:parent-web                                        # web on http://localhost:8082
```

For the web app, add `http://localhost:8082` to `CORS_ORIGINS` in `services/api/.env`. To try the
whole journey, invite a guardian from the worker app (`PARENT_PORTAL_URL=http://localhost:8082`,
`SMS_PROVIDER=mock`, an `OTP_HMAC_KEY` in `services/api/.env`) and open the link and code written to
`services/api/.dev-sms/outbox.log`.

Android: `npm run dev:parent`. A real SMS link (https) opens the web app; opening it in the Android
app needs Android App Links for the production domain (not configured yet).

## Tests

`npm test --workspace @balswasthya/parent-app` - screen tests drive the real routes against an
in-memory fake of the API (tests/support/fakeParentApi.ts), plus translation and configuration checks.
