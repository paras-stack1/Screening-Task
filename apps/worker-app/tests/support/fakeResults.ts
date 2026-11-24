/**
 * In-memory stand-in for the Step 7 result, clinical review and notification API, used ONLY in
 * tests. It mirrors the behaviours the screens depend on: permission checks, review claim and
 * version (409), decisions, read marks of one's own notifications, and the response shapes of
 * packages/shared-contracts. All data is synthetic.
 */
import type {
  AppNotification,
  CategoryResult,
  ClinicalReviewDetail,
  FourDCategoryCode,
  ResultOutcome,
  ResultRun,
} from '@balswasthya/shared-contracts';

type Result = { status: number; body?: unknown };
const ok = (status: number, body?: unknown): Result => ({ status, body });
const err = (status: number, code: string): Result => ({ status, body: { error: { code, message: code } } });
const CATEGORIES: FourDCategoryCode[] = [
  'DEFECTS_AT_BIRTH',
  'DEFICIENCIES',
  'DISEASES',
  'DEVELOPMENTAL_DELAYS_DISABILITIES',
];
const STATUS_FOR: Record<string, string> = {
  ACCEPT_RESULT: 'REVIEWED',
  RECOMMEND_REFERRAL: 'REVIEWED',
  REQUEST_ADDITIONAL_SCREENING: 'ADDITIONAL_INFORMATION_REQUIRED',
  ESCALATE_FOR_SPECIALIST_REVIEW: 'ESCALATED',
  REJECT_WITH_REASON: 'REJECTED',
};

interface FakeReview {
  id: string;
  status: ClinicalReviewDetail['status'];
  version: number;
  claimedBy: { id: string; name: string } | null;
  decision: ClinicalReviewDetail['decision'];
  notes: string | null;
  history: ClinicalReviewDetail['history'];
  run: ResultRun;
  conductedById: string;
}

export function createFakeResults() {
  let counter = 0;
  const uuid = () => `00000000-0000-4000-9000-${String(++counter).padStart(12, '0')}`;
  const runs = new Map<string, ResultRun[]>(); // sessionId -> runs, newest first
  const reviews = new Map<string, FakeReview>();
  const notifications: Array<AppNotification & { userId: string }> = [];
  const decisions: unknown[] = [];

  function category(c: FourDCategoryCode, outcome: ResultOutcome): CategoryResult {
    const assessed = outcome !== 'NOT_ASSESSED';
    return {
      id: uuid(),
      category: c,
      outcome,
      sessionCategoryId: assessed ? uuid() : null,
      protocol: assessed
        ? { id: uuid(), code: 'DEMO_D1', version: 1, isDemonstration: true, statusAtStart: 'DRAFT' }
        : null,
      ruleSet:
        assessed && outcome !== 'NOT_INTERPRETED'
          ? {
              id: uuid(),
              code: 'DEMO_RULES',
              version: 1,
              status: 'DRAFT',
              isDemonstration: true,
              isOperational: false,
            }
          : null,
      referralRecommended: outcome === 'URGENT_EVALUATION_RECOMMENDED',
      suggestedPriority: outcome === 'URGENT_EVALUATION_RECOMMENDED' ? 'URGENT' : null,
      rules:
        assessed && outcome !== 'NOT_INTERPRETED'
          ? [
              {
                ruleId: 'DEMO_R1',
                name: { en: 'Demonstration rule DEMO_R1', hi: 'प्रदर्शन नियम DEMO_R1' },
                clinicalReference: 'NONE - demonstration',
                outcomeIfMet: 'URGENT_EVALUATION_RECOMMENDED',
                result: outcome === 'URGENT_EVALUATION_RECOMMENDED' ? 'MET' : 'NOT_MET',
                evidence: [],
              },
            ]
          : [],
      limitations: assessed ? [{ code: 'RULE_SET_NOT_APPROVED' }] : [{ code: 'CATEGORY_NOT_STARTED' }],
    };
  }

  const summary = (run: ResultRun) => {
    const { categories, ...rest } = run;
    return {
      ...rest,
      categoryOutcomes: categories.map((c) => ({ category: c.category, outcome: c.outcome })),
    };
  };
  const reviewSummary = (r: FakeReview, userId: string) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    resultRunId: r.run.id,
    sessionId: r.run.sessionId,
    childId: r.run.childId,
    childName: r.run.childName,
    screeningVersion: r.run.screeningVersion,
    isCurrent: r.run.isCurrent,
    overallOutcome: r.run.overallOutcome,
    usesUnapprovedContent: r.run.usesUnapprovedContent,
    claimedByName: r.claimedBy?.name ?? null,
    claimedByMe: r.claimedBy?.id === userId,
    decision: r.decision,
    decidedByName: r.decision ? (r.claimedBy?.name ?? null) : null,
    decidedAt: r.decision ? '2026-11-24T06:00:00.000Z' : null,
    createdAt: r.run.generatedAt,
  });
  const reviewDetail = (r: FakeReview, userId: string): ClinicalReviewDetail => {
    const mine = r.claimedBy?.id === userId;
    const claimable = ['PENDING_REVIEW', 'ESCALATED', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(r.status);
    return {
      ...reviewSummary(r, userId),
      decidedByRoleCode: r.decision ? 'MHT_MEDICAL_OFFICER' : null,
      notes: r.notes,
      conductedByReviewer: r.conductedById === userId,
      result: { ...r.run, review: { id: r.id, status: r.status, decision: r.decision, decidedAt: null } },
      history: r.history,
      referralIds: [],
      followUpIds: [],
      canClaim: r.run.isCurrent && claimable,
      canRelease: r.status === 'UNDER_REVIEW' && mine,
      canDecide: r.run.isCurrent && r.status === 'UNDER_REVIEW' && mine,
    } as ClinicalReviewDetail;
  };

  function route(
    method: string,
    fullPath: string,
    body: Record<string, unknown>,
    user: { id: string; name: string; permissions: string[] },
  ): Result | null {
    const [path = '', query = ''] = fullPath.split('?');
    const params = new URLSearchParams(query);
    const read = user.permissions.includes('child.read');
    const reviewer = user.permissions.includes('screening.review');
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '/notifications') {
      const mine = notifications.filter((n) => n.userId === user.id);
      const items = mine.map(({ userId: _u, ...n }) => n);
      return ok(200, {
        items,
        unread: mine.filter((n) => !n.readAt).length,
        page: 1,
        pageSize: 20,
        total: items.length,
      });
    }
    if (method === 'POST' && (m = /^\/notifications\/([^/]+)\/read$/.exec(path))) {
      const n = notifications.find((x) => x.id === m![1] && x.userId === user.id);
      if (!n) return err(404, 'NOT_FOUND');
      n.readAt ??= '2026-11-24T07:00:00.000Z';
      const { userId: _u, ...dto } = n;
      return ok(200, { notification: dto });
    }
    if (method === 'GET' && (m = /^\/screenings\/([^/]+)\/results$/.exec(path))) {
      if (!read) return err(403, 'FORBIDDEN');
      const list = runs.get(m[1]!) ?? [];
      return ok(200, { current: list.find((r) => r.isCurrent) ?? null, history: list.map(summary) });
    }
    if (method === 'GET' && path === '/screening-results') {
      if (!read) return err(403, 'FORBIDDEN');
      const outcome = params.get('outcome');
      const items = [...runs.values()]
        .flat()
        .filter((r) => r.isCurrent && (!outcome || r.overallOutcome === outcome))
        .map(summary);
      return ok(200, { items, page: 1, pageSize: 20, total: items.length });
    }
    if (method === 'GET' && path === '/dashboards/results') {
      if (!read) return err(403, 'FORBIDDEN');
      const current = [...runs.values()].flat().filter((r) => r.isCurrent);
      const count = (o: string[]) => current.filter((r) => o.includes(r.overallOutcome)).length;
      return ok(200, {
        dashboard: {
          completedScreenings: current.length,
          awaitingReview: [...reviews.values()].filter((r) =>
            ['PENDING_REVIEW', 'UNDER_REVIEW'].includes(r.status),
          ).length,
          furtherEvaluation: count(['FURTHER_EVALUATION_RECOMMENDED']),
          urgentEvaluation: count(['URGENT_EVALUATION_RECOMMENDED']),
          incompleteOrUndetermined: count(['INCOMPLETE', 'UNABLE_TO_DETERMINE']),
          notInterpreted: count(['NOT_INTERPRETED']),
          includesUnapprovedContent: current.some((r) => r.usesUnapprovedContent),
        },
      });
    }
    if (path.startsWith('/clinical-reviews')) {
      if (!reviewer) return err(403, 'FORBIDDEN');
      if (method === 'GET' && path === '/clinical-reviews') {
        const items = [...reviews.values()]
          .filter((r) => r.run.isCurrent && !['REVIEWED', 'REJECTED'].includes(r.status))
          .map((r) => reviewSummary(r, user.id));
        return ok(200, { items, page: 1, pageSize: 20, total: items.length });
      }
      m = /^\/clinical-reviews\/([^/]+)(?:\/(claim|release|decision))?$/.exec(path);
      const r = m ? reviews.get(m[1]!) : undefined;
      if (!m || !r) return err(404, 'NOT_FOUND');
      if (method === 'GET' && !m[2]) return ok(200, { review: reviewDetail(r, user.id) });
      if (method !== 'POST') return err(404, 'NOT_FOUND');
      if (body.expectedVersion !== r.version) return err(409, 'VERSION_CONFLICT');
      const event = (toStatus: FakeReview['status'], decision: FakeReview['decision'] = null) => {
        r.history.push({
          fromStatus: r.status,
          toStatus,
          decision,
          actorName: user.name,
          actorRoleCode: 'MHT_MEDICAL_OFFICER',
          notes: typeof body.notes === 'string' ? body.notes : null,
          occurredAt: '2026-11-24T06:00:00.000Z',
        });
        r.status = toStatus;
        r.version += 1;
      };
      if (m[2] === 'claim') {
        if (r.status === 'UNDER_REVIEW') return err(409, 'REVIEW_CLAIMED');
        r.claimedBy = { id: user.id, name: user.name };
        r.decision = null;
        event('UNDER_REVIEW');
      } else if (m[2] === 'release') {
        if (r.claimedBy?.id !== user.id) return err(409, 'NOT_YOUR_REVIEW');
        r.claimedBy = null;
        event('PENDING_REVIEW');
      } else {
        if (r.status !== 'UNDER_REVIEW' || r.claimedBy?.id !== user.id) return err(409, 'NOT_YOUR_REVIEW');
        const decision = String(body.decision) as NonNullable<FakeReview['decision']>;
        if (decision !== 'ACCEPT_RESULT' && !body.notes) return err(400, 'VALIDATION_FAILED');
        decisions.push(body);
        r.decision = decision;
        r.notes = typeof body.notes === 'string' ? body.notes : null;
        event(STATUS_FOR[decision] as FakeReview['status'], decision);
      }
      return ok(200, { review: reviewDetail(r, user.id) });
    }
    return null;
  }

  return {
    route,
    decisions,
    /** Seeds a current result run (and optionally its pending review) for a completed session. */
    seedResult(input: {
      sessionId: string;
      childId: string;
      childName: string;
      outcomes?: Partial<Record<FourDCategoryCode, ResultOutcome>>;
      unapproved?: boolean;
      withReview?: { conductedById: string };
    }): { run: ResultRun; reviewId: string | null } {
      const previous = runs.get(input.sessionId) ?? [];
      for (const p of previous) p.isCurrent = false;
      const categories = CATEGORIES.map((c) => category(c, input.outcomes?.[c] ?? 'NOT_ASSESSED'));
      const rank: ResultOutcome[] = [
        'NO_CONCERN_IN_COMPLETED_ITEMS',
        'NOT_ASSESSED',
        'NOT_INTERPRETED',
        'INCOMPLETE',
        'UNABLE_TO_DETERMINE',
        'FURTHER_EVALUATION_RECOMMENDED',
        'URGENT_EVALUATION_RECOMMENDED',
      ];
      const overall = categories
        .map((c) => c.outcome)
        .reduce((a, b) => (rank.indexOf(b) > rank.indexOf(a) ? b : a));
      const run: ResultRun = {
        id: uuid(),
        sessionId: input.sessionId,
        childId: input.childId,
        childName: input.childName,
        screeningVersion: previous.length + 1,
        isCurrent: true,
        supersededAt: null,
        overallOutcome: overall,
        usesUnapprovedContent: input.unapproved ?? true,
        engineVersion: 'rule-engine/1',
        generatedAt: '2026-11-24T05:00:00.000Z',
        generatedByName: null,
        review: null,
        categories,
      };
      let reviewId: string | null = null;
      if (input.withReview) {
        reviewId = uuid();
        reviews.set(reviewId, {
          id: reviewId,
          status: 'PENDING_REVIEW',
          version: 1,
          claimedBy: null,
          decision: null,
          notes: null,
          history: [
            {
              fromStatus: null,
              toStatus: 'PENDING_REVIEW',
              decision: null,
              actorName: null,
              actorRoleCode: null,
              notes: null,
              occurredAt: run.generatedAt,
            },
          ],
          run,
          conductedById: input.withReview.conductedById,
        });
        run.review = { id: reviewId, status: 'PENDING_REVIEW', decision: null, decidedAt: null };
      }
      runs.set(input.sessionId, [run, ...previous]);
      return { run, reviewId };
    },
    seedNotification(userId: string, n: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>) {
      const row = { ...n, id: uuid(), userId, createdAt: '2026-11-24T05:30:00.000Z', readAt: null };
      notifications.unshift(row);
      return row;
    },
    notifications,
    /** Another reviewer claims the review behind the app's back (for 409 tests). */
    claimAs(reviewId: string, other: { id: string; name: string }) {
      const r = reviews.get(reviewId)!;
      r.claimedBy = other;
      r.status = 'UNDER_REVIEW';
      r.version += 1;
    },
  };
}

export type FakeResults = ReturnType<typeof createFakeResults>;
