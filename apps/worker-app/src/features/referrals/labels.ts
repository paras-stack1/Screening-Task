import type { ReferralStatus } from '@balswasthya/shared-contracts';
import type { TranslationKey } from '../../localization';

export const referralStatusKey = (s: ReferralStatus) => `referrals.status.${s}` as TranslationKey;
export const followUpStatusKey = (s: string) => `followUps.status.${s}` as TranslationKey;

/** Today as YYYY-MM-DD in India (for due-date hints and defaults). */
export function indiaToday(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
