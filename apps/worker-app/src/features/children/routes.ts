import type { Href } from 'expo-router';

/**
 * Links to the children screens. Only opaque ids go into URLs - never names, dates of birth or
 * phone numbers (they could end up in logs or crash reports).
 *
 * Plain paths are used deliberately: the typed-route object form for a dynamic folder's index
 * ('/children/[childId]/index') type-checks but does not resolve at runtime (caught by the screen
 * tests), so every link is built here, in one place, and covered by navigation tests.
 */
const seg = (value: string) => encodeURIComponent(value);

export const childRoutes = {
  list: '/children' as Href,
  register: (siblingOf?: string) =>
    (siblingOf ? `/children/register?siblingOf=${seg(siblingOf)}` : '/children/register') as Href,
  profile: (childId: string) => `/children/${seg(childId)}` as Href,
  edit: (childId: string) => `/children/${seg(childId)}/edit` as Href,
  addGuardian: (childId: string) => `/children/${seg(childId)}/add-guardian` as Href,
  link: (childId: string, relationshipId: string) =>
    `/children/${seg(childId)}/link/${seg(relationshipId)}` as Href,
  guardian: (guardianId: string) => `/children/guardian/${seg(guardianId)}` as Href,
  consentHistory: (childId: string) => `/children/${seg(childId)}/consent` as Href,
  recordConsent: (childId: string) => `/children/${seg(childId)}/consent/record` as Href,
  withdrawConsent: (childId: string, consentId: string) =>
    `/children/${seg(childId)}/consent/withdraw/${seg(consentId)}` as Href,
};
