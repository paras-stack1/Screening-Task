import {
  addMeasurementRequestSchema,
  ageInDaysOn,
  ageOn,
  correctMeasurementRequestSchema,
  FOUR_D_CATEGORIES,
  formatCalendarDate,
  parseCalendarDate,
  saveResponsesRequestSchema,
  startCategoryRequestSchema,
  startScreeningRequestSchema,
  todayInIndia,
  updateCategoryRequestSchema,
  type AnswerType,
  type FourDCategoryCode,
  type ScreeningProtocolDetail,
  type ScreeningResponse,
  type ScreeningSessionDetail,
} from '@balswasthya/shared-contracts';
import type { FakeChildren } from './fakeChildren';

/**
 * In-memory stand-in for the Step 6 screening API (docs/step-6/screening-api.md), used ONLY in
 * tests. Requests are validated with the real shared contracts and the rules the app depends on
 * are mimicked: consent at every write, owner-only changes, optimistic versions (409), required
 * questions before finishing, measurement units/precision. All content is synthetic
 * demonstration content.
 */
type Result = { status: number; body?: unknown };
const err = (status: number, code: string, details?: unknown): Result => ({
  status,
  body: { error: { code, message: `generic ${code}`, requestId: 'req-test', details } },
});
const ok = (status: number, body: unknown): Result => ({ status, body });

const NOW = Date.parse('2026-11-21T09:00:00.000Z');

type Spec = [section: string, type: AnswerType, required: boolean];
const SPECS: Record<FourDCategoryCode, Spec[]> = {
  DEFECTS_AT_BIRTH: [
    ['S_A', 'YES_NO', true],
    ['S_A', 'SINGLE_CHOICE', true],
    ['S_B', 'TEXT', false],
  ],
  DEFICIENCIES: [
    ['S_A', 'YES_NO', true],
    ['S_A', 'MULTI_CHOICE', false],
    ['S_B', 'NUMBER', false],
  ],
  DISEASES: [
    ['S_A', 'YES_NO', true],
    ['S_A', 'NUMBER', false],
    ['S_B', 'TEXT', false],
  ],
  DEVELOPMENTAL_DELAYS_DISABILITIES: [
    ['S_A', 'YES_NO', true],
    ['S_A', 'YES_NO', true],
    ['S_B', 'SINGLE_CHOICE', false],
  ],
};
const OPTIONS = ['A', 'B'].map((x) => ({
  code: `OPT_${x}`,
  label: { hi: `विकल्प ${x}`, en: `Option ${x}` },
}));

function protocolFor(category: FourDCategoryCode, index: number, approved: boolean): ScreeningProtocolDetail {
  const id = `00000000-0000-4000-a000-00000000000${index + 1}`;
  return {
    id,
    code: `DEMO_D${index + 1}`,
    version: 1,
    category,
    name: { hi: `प्रदर्शन ${index + 1}`, en: `Demonstration ${index + 1}` },
    description: null,
    ageMinDays: 0,
    ageMaxDays: 6954,
    sourceReference: 'NONE - synthetic',
    status: approved ? 'ACTIVE' : 'DRAFT',
    isDemonstration: !approved,
    isClinicallyApproved: approved,
    approvalReference: approved ? 'SYNTHETIC-REF' : null,
    clinicalApprovedAt: approved ? new Date(NOW).toISOString() : null,
    effectiveFrom: approved ? new Date(NOW).toISOString() : null,
    retiredAt: null,
    questionCount: 3,
    contentSha256: approved ? 'a'.repeat(64) : null,
    questions: SPECS[category].map(([sectionCode, answerType, isRequired], i) => ({
      id: `00000000-0000-4000-b000-00000${index + 1}00000${i + 1}`,
      code: `Q${i + 1}`,
      sectionCode,
      sortOrder: (i + 1) * 10,
      prompt: { hi: `प्रश्न ${index + 1}.${i + 1}`, en: `Demo question ${index + 1}.${i + 1}` },
      help: null,
      answerType,
      options: answerType === 'SINGLE_CHOICE' || answerType === 'MULTI_CHOICE' ? OPTIONS : null,
      validation:
        answerType === 'NUMBER'
          ? { min: 0, max: 999, maxDecimals: 0 }
          : answerType === 'TEXT'
            ? { maxLength: 500 }
            : null,
      isRequired,
    })),
  };
}

interface Category {
  id: string;
  category: FourDCategoryCode;
  status: 'IN_PROGRESS' | 'COMPLETED';
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  responses: ScreeningResponse[];
}
interface Measurement {
  id: string;
  type: string;
  value: string;
  unit: string;
  source: string;
  quality: string;
  deviceMake: string | null;
  notes: string | null;
  measuredAt: string;
  recordedAt: string;
  supersedesId: string | null;
  correctionReason: string | null;
}
interface Session {
  id: string;
  childId: string;
  ownerId: string;
  ownerName: string;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  version: number;
  startedAt: string;
  completedAt: string | null;
  consentId: string;
  ageInDays: number;
  dob: string;
  dobEstimated: boolean;
  categories: Category[];
  measurements: Measurement[];
}

const UNITS: Record<string, string[]> = {
  WEIGHT: ['kg', 'g'],
  HEIGHT: ['cm', 'mm'],
  LENGTH: ['cm', 'mm'],
  MUAC: ['cm', 'mm'],
  HEAD_CIRCUMFERENCE: ['cm', 'mm'],
};
const DECIMALS: Record<string, number> = { kg: 2, g: 0, cm: 1, mm: 0 };
const TO_DISPLAY: Record<string, [string, number]> = {
  kg: ['kg', 1],
  g: ['kg', 0.001],
  cm: ['cm', 1],
  mm: ['cm', 0.1],
};

export function createFakeScreening(children: FakeChildren) {
  let seq = 0;
  let clock = NOW;
  const tick = () => new Date((clock += 1000)).toISOString();
  const uuid = () => `00000000-0000-4000-c000-${String((seq += 1)).padStart(12, '0')}`;
  let approved = false;
  let protocols = FOUR_D_CATEGORIES.map((c, i) => protocolFor(c, i, approved));
  const sessions = new Map<string, Session>();
  /** Categories with no protocol for any age (to test "not available"). */
  const unavailable = new Set<FourDCategoryCode>();

  const protocolOf = (category: FourDCategoryCode) => protocols.find((p) => p.category === category)!;
  const summary = (p: ScreeningProtocolDetail) => {
    const { questions: _questions, contentSha256: _hash, ...rest } = p;
    return rest;
  };

  function childAge(childId: string) {
    const child = children.children.get(childId)!;
    const birth = parseCalendarDate(child.dateOfBirth)!;
    const today = todayInIndia(new Date(clock));
    return { child, days: ageInDaysOn(birth, today), age: ageOn(birth, today) };
  }

  function detail(s: Session, userId: string): ScreeningSessionDetail {
    const child = children.children.get(s.childId)!;
    const birth = parseCalendarDate(s.dob)!;
    const started = new Set(s.categories.map((c) => c.category));
    const order = (c: FourDCategoryCode) => FOUR_D_CATEGORIES.indexOf(c);
    const cats = [...s.categories].sort((a, b) => order(a.category) - order(b.category));
    return {
      id: s.id,
      childId: s.childId,
      childName: child.fullName,
      status: s.status,
      version: s.version,
      screeningDate: formatCalendarDate(todayInIndia(new Date(s.startedAt))),
      startedAt: s.startedAt,
      updatedAt: new Date(clock).toISOString(),
      completedAt: s.completedAt,
      cancelledAt: null,
      conductedByName: s.ownerName,
      isMine: s.ownerId === userId,
      ageInDaysAtStart: s.ageInDays,
      dobEstimatedAtStart: s.dobEstimated,
      categories: cats.map((c) => ({ category: c.category, status: c.status })),
      usesUnapprovedContent: !approved && s.categories.length > 0,
      dateOfBirthAtStart: s.dob,
      ageAtStart: ageOn(birth, todayInIndia(new Date(s.startedAt))),
      screeningConsentId: s.consentId,
      cancelReason: null,
      cancelledByName: null,
      canEdit: s.ownerId === userId && (s.status === 'DRAFT' || s.status === 'IN_PROGRESS'),
      sessionCategories: cats.map((c) => {
        const p = protocolOf(c.category);
        const answered = new Map(c.responses.map((r) => [r.questionId, r]));
        return {
          id: c.id,
          category: c.category,
          status: c.status,
          protocol: summary(p),
          protocolStatusAtStart: p.status,
          usedApprovedContent: approved,
          notes: c.notes,
          startedAt: c.startedAt,
          completedAt: c.completedAt,
          completeness: {
            totalQuestions: p.questions.length,
            requiredQuestions: p.questions.filter((q) => q.isRequired).length,
            requiredAddressed: p.questions.filter((q) => q.isRequired && answered.has(q.id)).length,
            answered: c.responses.filter((r) => r.status === 'ANSWERED').length,
            unknown: c.responses.filter((r) => r.status === 'UNKNOWN').length,
            notAssessed: c.responses.filter(
              (r) => r.status === 'NOT_ASSESSED' || r.status === 'UNABLE_TO_ASSESS',
            ).length,
            notAnswered: p.questions.filter((q) => !answered.has(q.id)).length,
          },
          responses: [...c.responses].sort((a, b) => a.questionCode.localeCompare(b.questionCode)),
        };
      }),
      categoriesNotAssessed: FOUR_D_CATEGORIES.filter((c) => !started.has(c)),
      measurements: s.measurements.map((m) => {
        const [unit, factor] = TO_DISPLAY[m.unit]!;
        return {
          ...m,
          method: null,
          deviceModel: null,
          deviceSerial: null,
          recordedByName: s.ownerName,
          converted: { value: String(Number((Number(m.value) * factor).toFixed(4))), unit },
          isCurrent: !s.measurements.some((x) => x.supersedesId === m.id),
        };
      }),
      screeningRulesApplied: false,
    };
  }

  function eligibility(childId: string) {
    const { child, days, age } = childAge(childId);
    const consent = children.consentStatus(childId, 'SCREENING');
    const open = [...sessions.values()].find(
      (s) => s.childId === childId && (s.status === 'DRAFT' || s.status === 'IN_PROGRESS'),
    );
    const categories = FOUR_D_CATEGORIES.map((category) => {
      const available = days !== null && !unavailable.has(category);
      return {
        category,
        available,
        reason: available ? null : ('NO_PROTOCOL_FOR_AGE' as const),
        protocol: available ? summary(protocolOf(category)) : null,
      };
    });
    const blockers: string[] = [];
    if (!consent.permitted) blockers.push('CONSENT_NOT_PERMITTED');
    if (days === null) blockers.push('AGE_NOT_DETERMINABLE');
    else if (!categories.some((c) => c.available)) blockers.push('NO_CATEGORY_AVAILABLE');
    if (open) blockers.push('OPEN_SESSION_EXISTS');
    return {
      childId,
      screeningDate: formatCalendarDate(todayInIndia(new Date(clock))),
      dateOfBirth: child.dateOfBirth,
      dobIsEstimated: child.dobIsEstimated,
      ageInDays: days,
      age: days === null ? null : age,
      consent,
      openSessionId: open?.id ?? null,
      categories,
      canStart: blockers.length === 0,
      blockers,
      usesUnapprovedContent: !approved,
    };
  }

  /** Common write guards, in the API's order. */
  function guard(
    s: Session | undefined,
    userId: string,
    expectedVersion: number,
    needConsent = true,
  ): Result | null {
    if (!s) return err(404, 'NOT_FOUND');
    if (s.ownerId !== userId) return err(403, 'NOT_SESSION_OWNER');
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED') return err(409, 'SESSION_FINAL');
    if (s.version !== expectedVersion) return err(409, 'VERSION_CONFLICT', { currentVersion: s.version });
    if (needConsent && !children.consentStatus(s.childId, 'SCREENING').permitted)
      return err(403, 'CONSENT_REQUIRED');
    return null;
  }
  const touched = (s: Session) => {
    s.version += 1;
    if (s.status === 'DRAFT') s.status = 'IN_PROGRESS';
    tick();
  };

  function route(
    method: string,
    fullPath: string,
    rawBody: unknown,
    user: { id: string; name: string; permissions: string[] },
  ): Result | null {
    const [path, query = ''] = fullPath.split('?');
    const params = new URLSearchParams(query);
    const conduct = user.permissions.includes('screening.conduct');
    const read = user.permissions.includes('child.read');
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = /^\/screening-protocols\/([^/]+)$/.exec(path!))) {
      const p = protocols.find((x) => x.id === m![1]);
      return p ? ok(200, { protocol: p }) : err(404, 'NOT_FOUND');
    }
    if (method === 'GET' && (m = /^\/children\/([^/]+)\/screening-eligibility$/.exec(path!))) {
      if (!conduct) return err(403, 'FORBIDDEN');
      if (!children.children.has(m[1]!)) return err(404, 'NOT_FOUND');
      return ok(200, eligibility(m[1]!));
    }
    if (!path!.startsWith('/screenings')) return null;

    if (method === 'GET' && path === '/screenings/summary') {
      if (!conduct) return err(403, 'FORBIDDEN');
      const mine = [...sessions.values()].filter((s) => s.ownerId === user.id);
      return ok(200, {
        date: formatCalendarDate(todayInIndia(new Date(clock))),
        completedToday: mine.filter((s) => s.status === 'COMPLETED').length,
        inProgress: mine.filter((s) => s.status === 'IN_PROGRESS').length,
        drafts: mine.filter((s) => s.status === 'DRAFT').length,
      });
    }
    if (method === 'GET' && path === '/screenings') {
      if (!read) return err(403, 'FORBIDDEN');
      const items = [...sessions.values()]
        .filter((s) => params.get('mine') !== 'true' || s.ownerId === user.id)
        .filter((s) => !params.get('status') || s.status === params.get('status'))
        .map((s) => {
          const d = detail(s, user.id);
          return {
            id: d.id,
            childId: d.childId,
            childName: d.childName,
            status: d.status,
            version: d.version,
            screeningDate: d.screeningDate,
            startedAt: d.startedAt,
            updatedAt: d.updatedAt,
            completedAt: d.completedAt,
            cancelledAt: d.cancelledAt,
            conductedByName: d.conductedByName,
            isMine: d.isMine,
            ageInDaysAtStart: d.ageInDaysAtStart,
            dobEstimatedAtStart: d.dobEstimatedAtStart,
            categories: d.categories,
            usesUnapprovedContent: d.usesUnapprovedContent,
          };
        });
      return ok(200, { items, page: 1, pageSize: 20, total: items.length });
    }
    if (method === 'POST' && path === '/screenings') {
      if (!conduct) return err(403, 'FORBIDDEN');
      const parsed = startScreeningRequestSchema.safeParse(rawBody);
      if (!parsed.success) return err(400, 'VALIDATION_ERROR');
      const childId = parsed.data.childId;
      if (!children.children.has(childId)) return err(404, 'NOT_FOUND');
      const e = eligibility(childId);
      if (!e.consent.permitted) return err(403, 'CONSENT_REQUIRED');
      if (e.openSessionId) return err(409, 'OPEN_SESSION_EXISTS', { sessionId: e.openSessionId });
      if (e.ageInDays === null) return err(422, 'AGE_NOT_DETERMINABLE');
      const child = children.children.get(childId)!;
      const s: Session = {
        id: uuid(),
        childId,
        ownerId: user.id,
        ownerName: user.name,
        status: 'DRAFT',
        version: 1,
        startedAt: tick(),
        completedAt: null,
        consentId: e.consent.consentId!,
        ageInDays: e.ageInDays,
        dob: child.dateOfBirth,
        dobEstimated: child.dobIsEstimated,
        categories: [],
        measurements: [],
      };
      sessions.set(s.id, s);
      return ok(201, { session: detail(s, user.id) });
    }

    const sm = /^\/screenings\/([^/]+)(\/.*)?$/.exec(path!);
    if (!sm) return null;
    const s = sessions.get(sm[1]!);
    const rest = sm[2] ?? '';
    if (!read || (method !== 'GET' && !conduct)) return err(403, 'FORBIDDEN');
    if (!s) return err(404, 'NOT_FOUND');

    if (method === 'GET' && rest === '') return ok(200, { session: detail(s, user.id) });

    if (method === 'POST' && rest === '/categories') {
      const parsed = startCategoryRequestSchema.safeParse(rawBody);
      if (!parsed.success) return err(400, 'VALIDATION_ERROR');
      const blocked = guard(s, user.id, parsed.data.expectedVersion);
      if (blocked) return blocked;
      if (s.categories.some((c) => c.category === parsed.data.category))
        return err(409, 'CATEGORY_ALREADY_STARTED');
      if (unavailable.has(parsed.data.category)) return err(422, 'CATEGORY_NOT_AVAILABLE');
      s.categories.push({
        id: uuid(),
        category: parsed.data.category,
        status: 'IN_PROGRESS',
        notes: null,
        startedAt: tick(),
        completedAt: null,
        responses: [],
      });
      touched(s);
      return ok(201, { session: detail(s, user.id) });
    }

    const cm = /^\/categories\/([A-Z_]+)(\/responses)?$/.exec(rest);
    if (cm) {
      const category = cm[1] as FourDCategoryCode;
      const cat = s.categories.find((c) => c.category === category);
      if (method === 'POST' && cm[2]) {
        const parsed = saveResponsesRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        const blocked = guard(s, user.id, parsed.data.expectedVersion);
        if (blocked) return blocked;
        if (!cat) return err(409, 'CATEGORY_NOT_STARTED');
        if (cat.status === 'COMPLETED') return err(409, 'CATEGORY_COMPLETED');
        const p = protocolOf(category);
        for (const r of parsed.data.responses) {
          const q = p.questions.find((x) => x.id === r.questionId);
          if (!q) return err(422, 'QUESTION_NOT_IN_PROTOCOL', { questionId: r.questionId });
          if (r.status === 'ANSWERED') {
            const bad =
              (q.answerType === 'YES_NO' && typeof r.value !== 'boolean') ||
              (q.answerType === 'NUMBER' && (typeof r.value !== 'number' || r.value > 999 || r.value < 0)) ||
              (q.answerType === 'TEXT' && typeof r.value !== 'string') ||
              (q.answerType === 'SINGLE_CHOICE' && typeof r.value !== 'string') ||
              (q.answerType === 'MULTI_CHOICE' && !Array.isArray(r.value));
            if (bad) return err(422, 'INVALID_RESPONSE', { questionCode: q.code });
          }
        }
        for (const r of parsed.data.responses) {
          const q = p.questions.find((x) => x.id === r.questionId)!;
          cat.responses = cat.responses.filter((x) => x.questionId !== q.id);
          cat.responses.push({
            id: uuid(),
            questionId: q.id,
            questionCode: q.code,
            status: r.status,
            source: r.source,
            value: r.value ?? null,
            notAssessedReason: r.notAssessedReason ?? null,
            notes: r.notes ?? null,
            recordedAt: tick(),
            updatedAt: new Date(clock).toISOString(),
            recordedByName: user.name,
          });
        }
        cat.responses = cat.responses.filter((x) => !parsed.data.cleared.includes(x.questionId));
        touched(s);
        return ok(200, { session: detail(s, user.id) });
      }
      if (method === 'PATCH' && !cm[2]) {
        const parsed = updateCategoryRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        const blocked = guard(s, user.id, parsed.data.expectedVersion);
        if (blocked) return blocked;
        if (!cat) return err(409, 'CATEGORY_NOT_STARTED');
        if (parsed.data.status === 'COMPLETED') {
          const answered = new Set(cat.responses.map((r) => r.questionId));
          const missing = protocolOf(category).questions.filter((q) => q.isRequired && !answered.has(q.id));
          if (missing.length > 0) {
            return err(422, 'REQUIRED_QUESTIONS_MISSING', { questionCodes: missing.map((q) => q.code) });
          }
          cat.status = 'COMPLETED';
          cat.completedAt = tick();
        } else if (parsed.data.status === 'IN_PROGRESS') {
          cat.status = 'IN_PROGRESS';
          cat.completedAt = null;
        }
        if (parsed.data.notes !== undefined) cat.notes = parsed.data.notes;
        touched(s);
        return ok(200, { session: detail(s, user.id) });
      }
    }

    const mm = /^\/measurements(?:\/([^/]+)\/corrections)?$/.exec(rest);
    if (method === 'POST' && mm) {
      const correcting = mm[1];
      const parsed = correcting
        ? correctMeasurementRequestSchema.safeParse(rawBody)
        : addMeasurementRequestSchema.safeParse(rawBody);
      if (!parsed.success) return err(400, 'VALIDATION_ERROR');
      const blocked = guard(s, user.id, parsed.data.expectedVersion);
      if (blocked) return blocked;
      const original = correcting ? s.measurements.find((x) => x.id === correcting) : undefined;
      if (correcting && !original) return err(404, 'NOT_FOUND');
      if (original && s.measurements.some((x) => x.supersedesId === original.id)) {
        return err(409, 'MEASUREMENT_ALREADY_CORRECTED');
      }
      const type = original ? original.type : (parsed.data as { type: string }).type;
      const body = parsed.data;
      if (!UNITS[type]!.includes(body.unit)) return err(422, 'INVALID_UNIT');
      const decimals = body.value.includes('.') ? body.value.split('.')[1]!.length : 0;
      if (decimals > DECIMALS[body.unit]!) return err(422, 'TOO_MANY_DECIMALS');
      const display = Number(body.value) * TO_DISPLAY[body.unit]![1];
      if (type === 'WEIGHT' && (display < 0.2 || display > 250)) return err(422, 'IMPLAUSIBLE_VALUE');
      s.measurements.push({
        id: uuid(),
        type,
        value: body.value,
        unit: body.unit,
        source: body.source,
        quality: body.quality,
        deviceMake: body.deviceMake ?? null,
        notes: body.notes ?? null,
        measuredAt: body.measuredAt,
        recordedAt: tick(),
        supersedesId: original?.id ?? null,
        correctionReason: 'correctionReason' in body ? body.correctionReason : null,
      });
      touched(s);
      return ok(201, { session: detail(s, user.id) });
    }
    return err(404, 'NOT_FOUND');
  }

  return {
    route,
    sessions,
    protocols: () => protocols,
    /** Approved (ACTIVE) content instead of demonstration drafts. */
    useApprovedContent() {
      approved = true;
      protocols = FOUR_D_CATEGORIES.map((c, i) => protocolFor(c, i, true));
    },
    markUnavailable(category: FourDCategoryCode) {
      unavailable.add(category);
    },
    /** Simulates another device changing the session (bumps the version). */
    bumpVersion(sessionId: string) {
      sessions.get(sessionId)!.version += 1;
    },
    question(category: FourDCategoryCode, code: string) {
      return protocolOf(category).questions.find((q) => q.code === code)!;
    },
    /** Seeds a session owned by `ownerId` (synthetic). */
    seedSession(childId: string, ownerId: string, ownerName = 'Sunita Devi') {
      const { child, days } = childAge(childId);
      const s: Session = {
        id: uuid(),
        childId,
        ownerId,
        ownerName,
        status: 'DRAFT',
        version: 1,
        startedAt: tick(),
        completedAt: null,
        consentId: children.consentStatus(childId, 'SCREENING').consentId ?? uuid(),
        ageInDays: days ?? 0,
        dob: child.dateOfBirth,
        dobEstimated: child.dobIsEstimated,
        categories: [],
        measurements: [],
      };
      sessions.set(s.id, s);
      return s;
    },
  };
}

export type FakeScreening = ReturnType<typeof createFakeScreening>;
