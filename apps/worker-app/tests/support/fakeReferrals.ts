/**
 * In-memory stand-in for the Step 7 referral, facility, follow-up and referral-dashboard API, used
 * ONLY in tests. It mirrors what the screens depend on: permissions, versions (409), duplicates,
 * the consent check at issue, source-derived verification, response shapes. Synthetic data only.
 */
import type {
  FacilityOption,
  FollowUpDetail,
  ReferralDetail,
  ReferralStatus,
} from '@balswasthya/shared-contracts';

type Result = { status: number; body?: unknown };
const ok = (status: number, body?: unknown): Result => ({ status, body });
const err = (status: number, code: string, details?: unknown): Result => ({
  status,
  body: { error: { code, message: code, ...(details ? { details } : {}) } },
});
type User = { id: string; name: string; permissions: string[] };
const NOW = '2026-11-24T05:00:00.000Z';
const FINAL: ReferralStatus[] = ['REJECTED', 'CLOSED', 'CANCELLED'];

export function createFakeReferrals(childName: (childId: string) => string) {
  let counter = 0;
  const uuid = () => `00000000-0000-4000-a000-${String(++counter).padStart(12, '0')}`;
  const facilities: FacilityOption[] = [];
  const referrals = new Map<string, ReferralDetail & { createdById: string }>();
  const followUps = new Map<string, FollowUpDetail>();
  const sharingConsent = new Set<string>();
  const requests: Array<{ path: string; body: unknown }> = [];

  const actions = (r: ReferralDetail & { createdById: string }, u: User) => {
    const has = (p: string) => u.permissions.includes(p);
    const creator = r.createdById === u.id && has('referral.create');
    const before = r.status === 'PENDING_APPROVAL' || r.status === 'APPROVED';
    return {
      approve: has('referral.approve') && r.status === 'PENDING_APPROVAL',
      reject: has('referral.approve') && r.status === 'PENDING_APPROVAL',
      changeFacility:
        (r.status === 'PENDING_APPROVAL' && (creator || has('referral.approve'))) ||
        (r.status === 'APPROVED' && has('referral.approve')),
      issue:
        r.status === 'APPROVED' &&
        r.facilityId !== null &&
        (creator || has('referral.approve') || has('referral.update')),
      cancel: FINAL.includes(r.status)
        ? false
        : before
          ? creator || has('referral.approve') || has('referral.update')
          : has('referral.approve') || has('referral.update'),
      reassess: false,
    };
  };
  const view = (r: ReferralDetail & { createdById: string }, u: User) => ({
    referral: { ...r, actions: actions(r, u) },
  });
  const event = (
    r: ReferralDetail,
    u: User,
    to: ReferralStatus,
    extra: Partial<ReferralDetail['history'][number]> = {},
  ) => {
    r.history.push({
      id: uuid(),
      fromStatus: r.status,
      toStatus: to,
      changedByName: u.name,
      actorRoleCode: u.permissions.includes('referral.approve') ? 'MHT_MEDICAL_OFFICER' : 'ASHA',
      changedAt: NOW,
      source: 'APP_USER_DIRECT',
      verificationStatus: 'VERIFIED',
      effectiveAt: null,
      facilityName: r.facilityName,
      correctsEventId: null,
      reason: null,
      note: null,
      ...extra,
    });
    r.status = to;
    r.version += 1;
  };

  function route(method: string, fullPath: string, body: Record<string, unknown>, u: User): Result | null {
    const [path = '', query = ''] = fullPath.split('?');
    const q = new URLSearchParams(query);
    const has = (p: string) => u.permissions.includes(p);
    let m: RegExpMatchArray | null;
    if (method !== 'GET') requests.push({ path, body });

    if (method === 'GET' && path === '/dashboards/referrals') {
      if (!has('child.read')) return err(403, 'FORBIDDEN');
      const all = [...referrals.values()];
      const byStatus = Object.fromEntries(
        [
          'PENDING_APPROVAL',
          'APPROVED',
          'REJECTED',
          'ISSUED',
          'ACKNOWLEDGED',
          'APPOINTMENT_SCHEDULED',
          'VISITED',
          'VISIT_NOT_COMPLETED',
          'UNDER_TREATMENT',
          'FOLLOW_UP_REQUIRED',
          'CLOSED',
          'CANCELLED',
        ].map((s) => [s, all.filter((r) => r.status === s).length]),
      );
      const fus = [...followUps.values()];
      const open = fus.filter((f) => ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(f.status));
      return ok(200, {
        dashboard: {
          referrals: {
            total: all.length,
            byStatus,
            pendingApproval: byStatus.PENDING_APPROVAL,
            issued: all.filter((r) => r.issuedAt).length,
            acknowledged: all.filter((r) => r.history.some((h) => h.toStatus === 'ACKNOWLEDGED')).length,
            visitRecorded: all.filter((r) => r.history.some((h) => h.toStatus === 'VISITED')).length,
            closed: byStatus.CLOSED,
            awaitingReassessment: 0,
          },
          followUps: {
            open: open.length,
            overdue: open.filter((f) => f.overdue).length,
            missed: 0,
            assignedToMe: 0,
          },
          reviewsOpen: has('screening.review') ? 0 : null,
        },
      });
    }
    if (method === 'GET' && path === '/facilities') {
      if (!q.get('childId')) return err(400, 'VALIDATION_FAILED');
      const include = q.get('includeOutOfDistrict') === 'true';
      return ok(200, { items: facilities.filter((f) => include || f.placement === 'IN_DISTRICT') });
    }
    if (method === 'GET' && path === '/referrals') {
      if (!has('child.read')) return err(403, 'FORBIDDEN');
      const status = q.get('status');
      const items = [...referrals.values()]
        .filter(
          (r) =>
            (!status || r.status === status) &&
            (q.get('awaitingApproval') !== 'true' || r.status === 'PENDING_APPROVAL'),
        )
        .map(({ history: _h, reassessments: _r, actions: _a, createdById: _c, ...s }) => s);
      return ok(200, { items, page: 1, pageSize: 20, total: items.length });
    }
    if (method === 'POST' && path === '/referrals') {
      if (!has('referral.create')) return err(403, 'FORBIDDEN');
      const dup = [...referrals.values()].find(
        (r) =>
          r.childId === body.childId &&
          r.sessionId === (body.sessionId ?? null) &&
          r.category === (body.category ?? null) &&
          !FINAL.includes(r.status),
      );
      if (dup) return err(409, 'REFERRAL_ALREADY_ACTIVE', { referralId: dup.id });
      const f = facilities.find((x) => x.id === body.facilityId);
      const r = seed({
        childId: String(body.childId),
        createdById: u.id,
        createdByName: u.name,
        sessionId: (body.sessionId as string) ?? null,
        category: (body.category as never) ?? null,
        priority: body.suggestedPriority as never,
        reasonCode: String(body.reasonCode),
        reasonNote: (body.reasonNote as string) ?? null,
        facility: f ?? null,
        origin: body.reasonCode === 'RULE_RECOMMENDATION' ? 'RULE_RECOMMENDATION' : 'WORKER_CONCERN',
      });
      return ok(201, view(r, u));
    }
    if (
      (m =
        /^\/referrals\/([^/]+)(?:\/(approve|reject|issue|cancel|tracking|close|corrections|facility))?$/.exec(
          path,
        ))
    ) {
      const r = referrals.get(m[1]!);
      if (!r) return err(404, 'NOT_FOUND');
      if (method === 'GET') return ok(200, view(r, u));
      if (body.expectedVersion !== r.version) return err(409, 'VERSION_CONFLICT');
      const a = actions(r, u);
      const track = has('referral.update') || has('referral.approve');
      switch (m[2]) {
        case 'approve':
          if (!a.approve) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          if (body.facilityId) Object.assign(r, facilityFields(String(body.facilityId)));
          r.priority = body.priority as never;
          r.approvedByName = u.name;
          event(r, u, 'APPROVED');
          break;
        case 'reject':
          if (!a.reject) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          event(r, u, 'REJECTED', { reason: String(body.reason) });
          break;
        case 'facility':
          if (!a.changeFacility) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          Object.assign(r, facilityFields(String(body.facilityId)));
          event(r, u, r.status);
          break;
        case 'issue':
          if (!a.issue) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          if (!sharingConsent.has(r.childId)) return err(403, 'CONSENT_REQUIRED');
          r.issuedAt = NOW;
          r.sharingConsentId = uuid();
          r.consentVerifiedAt = NOW;
          event(r, u, 'ISSUED');
          break;
        case 'cancel':
          if (!a.cancel) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          event(r, u, 'CANCELLED', { reason: String(body.reason) });
          break;
        case 'tracking': {
          if (!track) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          const source = String(body.source) as ReferralDetail['history'][number]['source'];
          if (body.appointmentAt) r.appointmentAt = String(body.appointmentAt);
          event(r, u, body.toStatus as ReferralStatus, {
            source,
            verificationStatus: source === 'GUARDIAN_REPORTED' ? 'UNVERIFIED' : 'VERIFIED',
            note: (body.note as string) ?? null,
          });
          break;
        }
        case 'close':
          if (!track) return err(403, 'REFERRAL_ACTION_NOT_ALLOWED');
          if (
            [...followUps.values()].some(
              (f) =>
                f.referralId === r.id && ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'MISSED'].includes(f.status),
            )
          ) {
            return err(409, 'OPEN_FOLLOW_UPS');
          }
          r.closedAt = NOW;
          event(r, u, 'CLOSED', { reason: String(body.reason) });
          break;
        case 'corrections': {
          const latest = r.history.at(-1)!;
          if (latest.id !== body.eventId || !latest.fromStatus) return err(409, 'NOT_CORRECTABLE');
          event(r, u, latest.fromStatus, { correctsEventId: latest.id, reason: String(body.reason) });
          break;
        }
        default:
          return err(404, 'NOT_FOUND');
      }
      return ok(200, view(r, u));
    }
    if (method === 'GET' && path === '/follow-ups') {
      const referralId = q.get('referralId');
      const items = [...followUps.values()]
        .filter(
          (f) =>
            (!referralId || f.referralId === referralId) &&
            (q.get('assigned') !== 'mine' || f.assignedToId === u.id) &&
            (q.get('overdue') !== 'true' || f.overdue),
        )
        .map(
          ({
            history: _h,
            actions: _a,
            reasonNote: _r,
            nextAction: _n,
            outcomeNote: _o,
            completedAt: _c,
            completedByName: _b,
            createdByName: _cr,
            ...s
          }) => ({ ...s, assignedToMe: s.assignedToId === u.id }),
        );
      return ok(200, { items, page: 1, pageSize: 20, total: items.length });
    }
    if (method === 'POST' && path === '/follow-ups') {
      const f = seedFollowUp({
        childId: String(body.childId),
        referralId: (body.referralId as string) ?? null,
        reasonCode: String(body.reasonCode),
        dueDate: String(body.dueDate),
        assignee: has('follow_up.update') ? u : null,
      });
      return ok(201, { followUp: followUpView(f, u) });
    }
    if ((m = /^\/follow-ups\/([^/]+)(?:\/(start|complete|reschedule|miss|cancel))?$/.exec(path))) {
      const f = followUps.get(m[1]!);
      if (!f) return err(404, 'NOT_FOUND');
      if (method === 'GET') return ok(200, { followUp: followUpView(f, u) });
      if (body.expectedVersion !== f.version) return err(409, 'VERSION_CONFLICT');
      const a = followUpView(f, u).actions;
      const step = (
        type: FollowUpDetail['history'][number]['type'],
        to: FollowUpDetail['status'],
        extra = {},
      ) => {
        f.history.push({
          type,
          fromStatus: f.status,
          toStatus: to,
          actorName: u.name,
          assignedToName: null,
          oldDueDate: null,
          newDueDate: null,
          reason: (body.reason as string) ?? null,
          occurredAt: NOW,
          ...extra,
        });
        f.status = to;
        f.version += 1;
      };
      if (!a[m[2] as keyof typeof a]) return err(403, 'FOLLOW_UP_ACTION_NOT_ALLOWED');
      if (m[2] === 'start') step('STARTED', 'IN_PROGRESS');
      if (m[2] === 'complete') {
        f.outcomeNote = String(body.outcomeNote);
        step('COMPLETED', 'COMPLETED');
      }
      if (m[2] === 'reschedule') {
        const old = f.dueDate;
        f.dueDate = String(body.dueDate);
        step('RESCHEDULED', f.status === 'MISSED' ? 'ASSIGNED' : f.status, {
          oldDueDate: old,
          newDueDate: f.dueDate,
        });
      }
      if (m[2] === 'miss') step('MISSED', 'MISSED');
      if (m[2] === 'cancel') step('CANCELLED', 'CANCELLED');
      return ok(200, { followUp: followUpView(f, u) });
    }
    return null;
  }

  function facilityFields(id: string) {
    const f = facilities.find((x) => x.id === id)!;
    return { facilityId: f.id, facilityName: f.name };
  }

  function followUpView(f: FollowUpDetail, u: User): FollowUpDetail {
    const manager = u.permissions.includes('referral.update');
    const assignee = f.assignedToId === u.id && u.permissions.includes('follow_up.update');
    const working = f.status === 'ASSIGNED' || f.status === 'IN_PROGRESS';
    const open = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(f.status);
    return {
      ...f,
      assignedToMe: f.assignedToId === u.id,
      actions: {
        assign: manager && open,
        start: assignee && f.status === 'ASSIGNED',
        complete: (assignee || manager) && working,
        reschedule: (assignee || manager) && (open || f.status === 'MISSED'),
        miss: (assignee || manager) && working,
        cancel: manager && (open || f.status === 'MISSED'),
      },
    };
  }

  function seed(input: {
    childId: string;
    createdById: string;
    createdByName?: string;
    sessionId?: string | null;
    category?: ReferralDetail['category'];
    priority?: ReferralDetail['priority'];
    reasonCode?: string;
    reasonNote?: string | null;
    facility?: FacilityOption | null;
    origin?: ReferralDetail['origin'];
    status?: ReferralStatus;
  }) {
    const id = uuid();
    const r: ReferralDetail & { createdById: string } = {
      id,
      childId: input.childId,
      childName: childName(input.childId),
      sessionId: input.sessionId ?? null,
      category: input.category ?? null,
      origin: input.origin ?? 'WORKER_CONCERN',
      priority: input.priority ?? 'ROUTINE',
      status: 'PENDING_APPROVAL',
      version: 1,
      facilityId: input.facility?.id ?? null,
      facilityName: input.facility?.name ?? null,
      createdAt: NOW,
      updatedAt: NOW,
      pendingReassessments: 0,
      screeningResultId: null,
      clinicalReviewId: null,
      reasonCode: input.reasonCode ?? 'WORKER_OBSERVED_CONCERN',
      reasonNote: input.reasonNote ?? null,
      createdByName: input.createdByName ?? 'Sunita Devi',
      approvedByName: null,
      approvedAt: null,
      issuedAt: null,
      sharingConsentId: null,
      consentVerifiedAt: null,
      consentWithdrawnAfterIssue: false,
      outOfDistrictReason: null,
      appointmentAt: null,
      closedAt: null,
      history: [],
      reassessments: [],
      actions: {
        approve: false,
        reject: false,
        changeFacility: false,
        issue: false,
        cancel: false,
        reassess: false,
      },
      createdById: input.createdById,
    };
    r.history.push({
      id: uuid(),
      fromStatus: null,
      toStatus: 'PENDING_APPROVAL',
      changedByName: r.createdByName,
      actorRoleCode: 'ASHA',
      changedAt: NOW,
      source: 'APP_USER_DIRECT',
      verificationStatus: 'VERIFIED',
      effectiveAt: null,
      facilityName: r.facilityName,
      correctsEventId: null,
      reason: null,
      note: null,
    });
    referrals.set(id, r);
    const sys = { id: 'system', name: 'Synthetic MO', permissions: ['referral.approve'] };
    if (input.status && input.status !== 'PENDING_APPROVAL') {
      event(r, sys, 'APPROVED');
      if (input.status !== 'APPROVED') {
        r.issuedAt = NOW;
        event(r, sys, 'ISSUED');
      }
      if (input.status !== 'APPROVED' && input.status !== 'ISSUED') event(r, sys, input.status);
    }
    return r;
  }

  function seedFollowUp(input: {
    childId: string;
    referralId?: string | null;
    reasonCode: string;
    dueDate: string;
    assignee: { id: string; name: string } | null;
    overdue?: boolean;
  }) {
    const f: FollowUpDetail = {
      id: uuid(),
      childId: input.childId,
      childName: childName(input.childId),
      referralId: input.referralId ?? null,
      sessionId: null,
      clinicalReviewId: null,
      reasonCode: input.reasonCode,
      dueDate: input.dueDate,
      status: input.assignee ? 'ASSIGNED' : 'PENDING',
      overdue: input.overdue ?? false,
      assignedToId: input.assignee?.id ?? null,
      assignedToName: input.assignee?.name ?? null,
      assignedToMe: false,
      version: 1,
      updatedAt: NOW,
      reasonNote: null,
      nextAction: null,
      outcomeNote: null,
      completedAt: null,
      completedByName: null,
      createdByName: 'Sunita Devi',
      history: [
        {
          type: 'CREATED',
          fromStatus: null,
          toStatus: input.assignee ? 'ASSIGNED' : 'PENDING',
          actorName: 'Sunita Devi',
          assignedToName: null,
          oldDueDate: null,
          newDueDate: input.dueDate,
          reason: null,
          occurredAt: NOW,
        },
      ],
      actions: {
        assign: false,
        start: false,
        complete: false,
        reschedule: false,
        miss: false,
        cancel: false,
      },
    };
    followUps.set(f.id, f);
    return f;
  }

  return {
    route,
    requests,
    referrals,
    followUps,
    seedReferral: seed,
    seedFollowUp,
    seedFacility(input: Partial<FacilityOption> & { name: string }) {
      const f: FacilityOption = {
        id: uuid(),
        nameHi: null,
        officialCode: null,
        type: 'PHC',
        areaId: 'area-district-1',
        areaPath: ['Synthetic State', 'Synthetic District'],
        address: null,
        contactPhone: null,
        services: [],
        acceptsReferrals: true,
        verificationStatus: 'VERIFIED',
        isActive: true,
        placement: 'IN_DISTRICT',
        selectable: true,
        ...input,
      };
      facilities.push(f);
      return f;
    },
    grantSharingConsent: (childId: string) => sharingConsent.add(childId),
  };
}

export type FakeReferrals = ReturnType<typeof createFakeReferrals>;
