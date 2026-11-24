import type { FourDCategoryCode } from '@balswasthya/shared-contracts';
import type { Href } from 'expo-router';

/** Links to the referral and follow-up screens. Only opaque ids and codes go into URLs. */
const seg = (value: string) => encodeURIComponent(value);

export const referralRoutes = {
  home: '/referrals' as Href,
  referral: (referralId: string) => `/referrals/${seg(referralId)}` as Href,
  /** New referral for a child; from a screening result also the session and category. */
  create: (
    childId: string,
    from?: { sessionId: string; category: FourDCategoryCode; recommended: boolean },
  ) =>
    (from
      ? `/referrals/new?childId=${seg(childId)}&sessionId=${seg(from.sessionId)}&category=${from.category}${
          from.recommended ? '&recommended=1' : ''
        }`
      : `/referrals/new?childId=${seg(childId)}`) as Href,
  followUps: '/referrals/follow-ups' as Href,
  followUp: (followUpId: string) => `/referrals/follow-ups/${seg(followUpId)}` as Href,
};
