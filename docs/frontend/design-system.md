# Worker App - Design System

> Status: Step 4 (2026-11-21). Code: `apps/worker-app/src/theme/`, `apps/worker-app/src/components/`.

## 1. Principles

- Trustworthy public-health look: white cards on a light blue-grey background, one primary blue.
- Built for budget Android phones and field use: large text (17 sp body), 48 dp minimum touch
  targets (56 dp for primary actions), light shadows, one icon font.
- Hindi-first: generous line heights, nothing truncated by default, labels wrap instead of clipping.
- Status is never shown by colour alone: always icon + text.
- Components use tokens only. No raw hex values, font sizes or spacing in screens.

## 2. Tokens (`src/theme`)

| File | Contents |
|---|---|
| `colors.ts` | `palette` (raw values), `colors` (semantic names used by components), `fourDColors` |
| `typography.ts` | Type scale (`display`, `title`, `subtitle`, `body`, `bodyStrong`, `label`, `bodySmall`, `caption`, `metric`), `MAX_FONT_SCALE` |
| `spacing.ts` | `spacing` (4-pt scale), `touchTarget`, `layout` (screen padding, max content width, icon sizes), `zIndex` |
| `radius.ts`, `shadows.ts` | Corner radii; `card` / `raised` elevation |

### Colours and contrast (decision H)

The approved palette is used as given, with these documented contrast adjustments. All pairs
are verified by `tests/theme/contrast.test.ts` (WCAG 2.1 AA).

| Token | Value | Note |
|---|---|---|
| `primary` | `#1769AA` | 5.77:1 with white text |
| `secondary` | `#16A6A0` | **Accent only** (3.0:1 vs white - fails for text) |
| `secondaryStrong` | `#0E7C77` | Teal for text and for filled controls with text (5.04:1) |
| `background` | `#F3F7FA` | |
| `surface` | `#FFFFFF` | |
| `textPrimary` | `#1F2937` | 13.6:1 on background |
| `textSecondary` | `#5B6B80` | **Darkened** from `#64748B` (4.42:1 on background fails AA; now 5.05:1) |
| `border` | `#E2E8F0` | Decorative card borders and dividers only |
| `borderStrong` | `#64748B` | Input outlines (meets the 3:1 non-text rule) |

### RBSK 4-D category identities

| Category | Accent | Tint | Icon |
|---|---|---|---|
| Defects at birth | `#1D4ED8` blue | `#EFF6FF` | `baby-face-outline` |
| Deficiencies | `#B45309` amber | `#FFFBEB` | `food-apple-outline` |
| Diseases | `#B91C1C` red | `#FEF2F2` | `virus-outline` |
| Developmental delays | `#6D28D9` violet | `#F5F3FF` | `human-child` |

Violet was chosen over teal for developmental delays so it is not confused with the app's
secondary teal.

### Typography and fonts (decision E)

System fonts only: Android ships Noto Sans and Noto Sans Devanagari, so nothing is bundled.
Line heights are about 1.5x the font size so Devanagari vowel signs are not clipped; never set
`includeFontPadding: false`. System font scaling stays on, capped at 1.8x (`MAX_FONT_SCALE`).
If device testing shows rendering problems on specific phones, bundle Noto Sans Devanagari with
`expo-font` (about 200 KB per weight).

## 3. Components (`src/components`)

Import from `src/components` (barrel). All are typed, use tokens and translated defaults.

| Component | Purpose / accessibility |
|---|---|
| `AppText` | The only text primitive. Variant + colour token. Never truncates unless `numberOfLines` is set |
| `AppIcon` | Material Community icon, hidden from screen readers (meaning must be in text) |
| `AppCard` | White card; optional coloured left edge (`accentColor`) |
| `ScreenContainer` | Safe area, scrolling, max content width, optional keyboard avoidance |
| `SectionHeader` | Section title (header role) + optional action |
| `AppButton` / `PrimaryButton` / `SecondaryButton` | Variants `primary`, `secondary`, `ghost`, `danger`. `loading` shows a spinner, sets `busy` and blocks presses (duplicate-submission guard) |
| `AppInput` | Always-visible label, hint, error announced as an alert, 56 dp field |
| `PasswordInput` | Show/hide toggle (48 dp, labelled), autocorrect and capitalisation off |
| `LanguageSelector` | Hindi / English radio buttons, written in their own script; saves the choice |
| `LoadingIndicator` | Spinner + visible text, announced as busy progress |
| `EmptyState` | Explains emptiness, optional next action |
| `ErrorState` | Safe translated default text, retry with in-progress guard |
| `StatusBadge` | Icon + text pill (`neutral`, `info`, `success`, `warning`, `danger`) |
| `ConfirmationDialog` | Modal confirm/cancel; Android back cancels; blocked while confirming |
| `MetricCard` | States `loading`, `ready`, `unavailable` ("—" + "Not available yet", **never 0**), `error` |
| `ActionCard` | Large task card; without `onPress` it is disabled with a "Coming soon" badge |
| `FourDCategoryCard` | Informational 4-D card: icon + title + colour; shows no results |

| `IconButton` | 48dp icon-only button; a spoken label is required |
| `InlineAlert` | Form-level message (info / warning / danger), announced as an alert |
| `OfflineBanner` | Shown automatically at the top of every `ScreenContainer` while offline |
| `SyncStatusIndicator` | `online`, `offline` (used now); `syncPending`, `syncing`, `syncFailed` reserved for the sync module |

`MetricCard` also accepts `unavailableLabel` (e.g. "Not available for your role").

Deliberately not built (no current use; avoids unused abstractions): a toast system (screens use
`InlineAlert` / `ErrorState`; there are no transient notifications yet) and a custom app header
(the tab navigator's header plus the dashboard greeting cover current needs).

## 4. Rules for new screens

1. Use `ScreenContainer`; do not add your own `ScrollView` at the screen root.
2. Text through `AppText`; strings through `t('key')` - never literal text.
3. Tappable elements: at least `touchTarget.min` (48 dp) and an accessible role and label.
4. No fixed widths on anything that contains text; let Hindi wrap.
5. Show status with `StatusBadge` (icon + text), not with colour alone.
6. Never show `0` for data the backend does not provide - use the `unavailable` state.
