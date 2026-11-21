# Worker App - Accessibility Guidelines

> Status: Step 4 (2026-11-21). Target: WCAG 2.1 AA where applicable to mobile, Android TalkBack.

## Rules (enforced in components and tests)

| Rule | How |
|---|---|
| Touch targets >= 48 dp (primary actions 56 dp) | `touchTarget` tokens; tests assert `minHeight`/`minWidth` |
| Text contrast >= 4.5:1, UI outlines >= 3:1 | `tests/theme/contrast.test.ts` checks every token pair |
| Never colour alone | `StatusBadge`, `InlineAlert`, `SyncStatusIndicator`, 4-D cards always have icon + text |
| Every control has a role and a spoken name | Tests query by role and name (`getByRole('button', { name })`) |
| Icon-only buttons need a label | `IconButton` requires `accessibilityLabel` |
| Icons are decorative | `AppIcon` is hidden from screen readers |
| Visible labels on inputs | `AppInput` always renders its label; placeholders are not labels |
| Errors announced | Field errors and form alerts use `accessibilityRole="alert"` + live regions |
| Loading announced | `LoadingIndicator`: progressbar role, busy state, visible text |
| Disabled / busy states exposed | `accessibilityState` on buttons, action cards |
| Font scaling on | `AppText` keeps system scaling, capped at 1.8x (`MAX_FONT_SCALE`) |
| No truncation | No `numberOfLines` on labels; layouts wrap; no fixed widths around text |
| Hindi | Line heights ~1.5x for Devanagari; language options in their own script |
| Simple navigation | Four tabs; dialogs cancel with Android back |

## Manual checks still required (not automatable here)

- TalkBack walk-through of login, change password, every tab and the sign-out dialog.
- Android font size "Largest" + display size "Large" on a 360 dp-wide phone, in Hindi.
- Keyboard: focused field stays visible on the login and change-password screens.
- Contrast outdoors in sunlight on a budget screen.

## Known gaps

- Tab bar items are announced as buttons with a selected state (React Navigation behaviour), not
  as tabs.
- No haptic or sound feedback; no high-contrast theme.
