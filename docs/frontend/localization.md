# Worker App - Localization (Hindi / English)

> Status: Step 4 (2026-11-21). Code: `apps/worker-app/src/localization/`.

## 1. How it works

- `en.ts` is the source of truth for keys. `hi.ts` is typed `Record<TranslationKey, string>`, so a
  missing Hindi key is a **compile error**.
- `LanguageProvider` holds the current language; `useTranslation()` returns `{ language, t,
  setLanguage, applyAccountLanguage, isReady }`.
- No i18n library: the needs are two languages, `{{placeholder}}` interpolation and a fallback.
  Adding a regional language = add `<code>.ts`, add the code to `SUPPORTED_LANGUAGES` in
  `packages/shared-contracts/src/common.ts` and to `LANGUAGE_OPTIONS`.

```tsx
const { t } = useTranslation();
<AppText>{t('metric.a11y.unavailable', { label: t('dashboard.metric.children') })}</AppText>
```

## 2. Which language is shown

| Situation | Language |
|---|---|
| First launch | Hindi, unless the device language is English (Hindi-first) |
| User picked a language on this device | That language, saved in SecureStore (`bs.language`) |
| After sign-in, no choice saved on this device | The account's `preferredLanguage` from the server (decision G) |
| After sign-in, a choice is saved | The saved choice (the account preference does not override it) |

Saving is best effort: if device storage fails, the choice still applies until the app restarts.
The API has no endpoint to update `preferredLanguage`, so a choice made in the app is not sent to
the server (documented gap).

## 3. Rules

1. Every user-visible string comes from a key. No literal text in components or screens.
2. Keys are dotted: `<area>.<screen or component>.<item>`, e.g. `auth.login.title`.
3. Placeholders `{{name}}` must match in every language (tested).
4. Never build sentences by joining translated fragments; add a key with placeholders.
5. Error messages shown to users come from translation keys, never from server or exception text.
6. Language names are written in their own script (`हिंदी`, `English`) and are not translated.
7. Layout: no fixed widths on text, no `numberOfLines` on labels, line heights from the type scale.

## 4. Review status - IMPORTANT

All Hindi text was written by the development team and **must be reviewed by a native Hindi
speaker from the programme before release**. Health and medical terms must be checked by a domain
expert; the team must not improvise clinical translations.

Keys that need **domain-expert** review before release (decision U):

| Keys | Why |
|---|---|
| `fourD.*.title`, `fourD.*.description` | RBSK 4-D category names and short descriptions (kept deliberately generic) |
| `app.screeningDisclaimer` | Medical-safety statement |
| `role.*`, `areaLevel.*` | Mirror the backend tables (`roles.ts`, `prisma/seed.ts`); keep both in step |
| `settings.privacy.body` | Privacy statement (decision T); must match the approved privacy notice |

Keys that mirror server codes (`role.STATE_ADMIN`, `profile.scope.AREA_ONLY`) may contain `_`.

## 5. Tests

`tests/localization/translations.test.ts` checks: same key set, no empty or untrimmed values,
matching placeholders, every Hindi value actually contains Devanagari (catches English pasted
into `hi.ts`), key naming, interpolation and fallback. `tests/localization/LanguageProvider.test.tsx`
covers saved choice, storage failure, account language precedence and a race between a user
choice and the initial storage read.
