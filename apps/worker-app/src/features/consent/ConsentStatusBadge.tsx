import type { ConsentPurposeStatus } from '@balswasthya/shared-contracts';
import { StatusBadge, type IconName, type StatusTone } from '../../components';
import { isTranslationKey, useTranslation, type TranslateFn } from '../../localization';

/**
 * Consent display rules (docs/frontend/consent.md):
 *  - ONLY "Granted" is green. "Not recorded" is neutral grey - missing consent never looks like
 *    permission. Refused is red; withdrawn and no-longer-valid are amber.
 *  - Every status is icon + text, never colour alone.
 *  - The app never decides what is permitted: it shows the API's status.
 */
const STYLE: Record<ConsentPurposeStatus['status'], { tone: StatusTone; icon: IconName }> = {
  GRANTED: { tone: 'success', icon: 'check-circle-outline' },
  NOT_RECORDED: { tone: 'neutral', icon: 'help-circle-outline' },
  REFUSED: { tone: 'danger', icon: 'close-circle-outline' },
  WITHDRAWN: { tone: 'warning', icon: 'undo-variant' },
  NOT_VALID: { tone: 'warning', icon: 'alert-circle-outline' },
};

function label(t: TranslateFn, prefix: string, value: string) {
  const key = `${prefix}.${value}`;
  return isTranslationKey(key) ? t(key) : value;
}

export const purposeLabel = (t: TranslateFn, value: string) => label(t, 'consent.purpose', value);
export const methodLabel = (t: TranslateFn, value: string) => label(t, 'consent.method', value);
export const decisionLabel = (t: TranslateFn, value: string) => label(t, 'consent.decision', value);
export const statusLabel = (t: TranslateFn, value: string) => label(t, 'consent.status', value);
export const reasonLabel = (t: TranslateFn, value: string) => label(t, 'consent.reason', value);

export function ConsentStatusBadge({ status }: { status: Pick<ConsentPurposeStatus, 'status'> }) {
  const { t } = useTranslation();
  const style = STYLE[status.status];
  return <StatusBadge label={statusLabel(t, status.status)} tone={style.tone} icon={style.icon} />;
}
