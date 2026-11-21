import { colors, fourDColors } from '../../src/theme';

/** WCAG 2.1 relative luminance / contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const TEXT_AA = 4.5;
const NON_TEXT_AA = 3;

describe('colour contrast (WCAG AA)', () => {
  const textPairs: [string, string, string][] = [
    ['primary text on background', colors.textPrimary, colors.background],
    ['primary text on surface', colors.textPrimary, colors.surface],
    ['secondary text on background', colors.textSecondary, colors.background],
    ['secondary text on surface', colors.textSecondary, colors.surface],
    ['secondary text on muted surface', colors.textSecondary, colors.surfaceMuted],
    ['button text on primary', colors.textOnPrimary, colors.primary],
    ['button text on pressed primary', colors.textOnPrimary, colors.primaryPressed],
    ['text on strong teal', colors.textOnPrimary, colors.secondaryStrong],
    ['text on danger', colors.textOnPrimary, colors.danger],
    ['primary-coloured text on surface', colors.primary, colors.surface],
    ['primary-coloured text on background', colors.primary, colors.background],
    ['danger text on surface', colors.danger, colors.surface],
    ['success badge', colors.success, colors.successSurface],
    ['warning badge', colors.warning, colors.warningSurface],
    ['danger badge', colors.danger, colors.dangerSurface],
    ['info badge', colors.info, colors.infoSurface],
    ['neutral badge', colors.textSecondary, colors.surfaceMuted],
  ];

  it.each(textPairs)('%s meets 4.5:1', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it.each(Object.entries(fourDColors))(
    '4-D category %s text meets 4.5:1 on its tint and on white',
    (_name, tone) => {
      expect(contrast(tone.accent, tone.surface)).toBeGreaterThanOrEqual(TEXT_AA);
      expect(contrast(tone.accent, colors.surface)).toBeGreaterThanOrEqual(TEXT_AA);
    },
  );

  it('input outlines meet the 3:1 non-text contrast rule', () => {
    expect(contrast(colors.borderStrong, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT_AA);
    expect(contrast(colors.focus, colors.surface)).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });

  it('documents that the accent teal is NOT safe for text', () => {
    expect(contrast(colors.secondary, colors.surface)).toBeLessThan(TEXT_AA);
  });
});
