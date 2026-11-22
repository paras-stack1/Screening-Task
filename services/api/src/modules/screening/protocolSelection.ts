import type { FourDCategoryCode, ProtocolStatus } from '@balswasthya/shared-contracts';

/**
 * Which protocol a category uses for a child of a given age (Step 6 decisions B, F, O).
 *
 * Usable protocols:
 *  - ACTIVE, with an effective date that has been reached (operational, clinically approved);
 *  - DRAFT, only where the screening policy allows draft content (never in production).
 * IN_REVIEW, APPROVED-but-not-active and RETIRED protocols are never usable.
 *
 * Selection never guesses:
 *  - an ACTIVE protocol always wins over drafts (the database guarantees at most one ACTIVE per
 *    category and age);
 *  - among drafts, only the highest version of each code counts; if drafts of two different codes
 *    cover the age, the result is AMBIGUOUS_PROTOCOL (a configuration error to fix, not to pick);
 *  - if nothing covers the age, NO_PROTOCOL_FOR_AGE (no "nearest band" fallback).
 */
export interface ScreeningPolicySettings {
  /** DRAFT (incl. demonstration) protocols are usable only outside production. */
  allowDraftProtocols: boolean;
}

export interface ProtocolCandidate {
  id: string;
  code: string;
  version: number;
  category: FourDCategoryCode;
  status: ProtocolStatus;
  ageMinDays: number;
  ageMaxDays: number;
  effectiveFrom: Date | null;
}

export type ProtocolChoice<T extends ProtocolCandidate> =
  { protocol: T; reason: null } | { protocol: null; reason: 'NO_PROTOCOL_FOR_AGE' | 'AMBIGUOUS_PROTOCOL' };

export function isUsable(p: ProtocolCandidate, policy: ScreeningPolicySettings, at: Date): boolean {
  if (p.status === 'ACTIVE') return p.effectiveFrom !== null && p.effectiveFrom.getTime() <= at.getTime();
  return p.status === 'DRAFT' && policy.allowDraftProtocols;
}

export function selectProtocol<T extends ProtocolCandidate>(
  candidates: readonly T[],
  category: FourDCategoryCode,
  ageInDays: number | null,
  policy: ScreeningPolicySettings,
  at: Date,
): ProtocolChoice<T> {
  if (ageInDays === null) return { protocol: null, reason: 'NO_PROTOCOL_FOR_AGE' };
  const covering = candidates.filter(
    (p) =>
      p.category === category &&
      ageInDays >= p.ageMinDays &&
      ageInDays <= p.ageMaxDays &&
      isUsable(p, policy, at),
  );

  const active = covering.filter((p) => p.status === 'ACTIVE');
  if (active.length === 1) return { protocol: active[0]!, reason: null };
  if (active.length > 1) return { protocol: null, reason: 'AMBIGUOUS_PROTOCOL' };

  const latestDraftPerCode = new Map<string, T>();
  for (const p of covering) {
    const current = latestDraftPerCode.get(p.code);
    if (!current || p.version > current.version) latestDraftPerCode.set(p.code, p);
  }
  const drafts = [...latestDraftPerCode.values()];
  if (drafts.length === 1) return { protocol: drafts[0]!, reason: null };
  if (drafts.length > 1) return { protocol: null, reason: 'AMBIGUOUS_PROTOCOL' };
  return { protocol: null, reason: 'NO_PROTOCOL_FOR_AGE' };
}
