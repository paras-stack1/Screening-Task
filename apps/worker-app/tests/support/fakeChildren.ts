import {
  addGuardianLinkRequestSchema,
  compareCalendarDates,
  maskIndianMobile,
  parseCalendarDate,
  registerChildRequestSchema,
  subtractYearsMonths,
  todayInIndia,
  updateChildRequestSchema,
  updateGuardianLinkRequestSchema,
  updateGuardianRequestSchema,
  type ChildDetail,
} from '@balswasthya/shared-contracts';

/**
 * In-memory stand-in for the Step 5 children / guardians API (docs/api/children.md), used ONLY in
 * tests. Requests are validated with the real shared contracts, and the rules the app depends on
 * are mimicked: duplicate warnings, retries by clientOperationId, stale-record conflicts, the
 * last-guardian rule and masked phones. All data is synthetic.
 */
type Result = { status: number; body?: unknown };
const err = (status: number, code: string, details?: unknown): Result => ({
  status,
  body: { error: { code, message: `generic ${code}`, requestId: 'req-test', details } },
});

interface Guardian {
  id: string;
  fullName: string;
  phone: string | null;
  preferredLanguage: string;
  updatedAt: string;
}
interface Link {
  id: string;
  childId: string;
  guardianId: string;
  relationship: string;
  isPrimaryContact: boolean;
  canGiveConsent: boolean;
  linkedAt: string;
  endedAt: string | null;
}
interface Child {
  id: string;
  fullName: string;
  dateOfBirth: string;
  dobIsEstimated: boolean;
  sexAtBirth: string;
  areaId: string;
  registeredAt: string;
  updatedAt: string;
}

export const FAKE_AREA = {
  id: '0a0a0a0a-0000-4000-8000-00000000a001',
  nameEn: 'Rampur (synthetic)',
  nameHi: 'रामपुर (कृत्रिम)',
};

export function createFakeChildren() {
  let seq = 0;
  let clock = Date.parse('2026-11-21T09:00:00.000Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const children = new Map<string, Child>();
  const guardians = new Map<string, Guardian>();
  const links = new Map<string, Link>();
  const operations = new Map<string, { key: string; entityId: string }>();
  let areas = [FAKE_AREA];

  const uuid = () => {
    seq += 1;
    return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  };

  const activeLinks = (childId: string) =>
    [...links.values()].filter((l) => l.childId === childId && !l.endedAt);

  function linkDto(link: Link) {
    const guardian = guardians.get(link.guardianId)!;
    return {
      relationshipId: link.id,
      guardianId: guardian.id,
      fullName: guardian.fullName,
      relationship: link.relationship,
      isPrimaryContact: link.isPrimaryContact,
      canGiveConsent: link.canGiveConsent,
      phoneMasked: guardian.phone ? maskIndianMobile(guardian.phone) : null,
      preferredLanguage: guardian.preferredLanguage,
      linkedAt: link.linkedAt,
      endedAt: link.endedAt,
    };
  }

  function summary(child: Child) {
    return {
      id: child.id,
      fullName: child.fullName,
      dateOfBirth: child.dateOfBirth,
      dobIsEstimated: child.dobIsEstimated,
      sexAtBirth: child.sexAtBirth,
      areaId: child.areaId,
      areaName: FAKE_AREA.nameEn,
      areaNameHi: FAKE_AREA.nameHi,
      registeredAt: child.registeredAt,
    };
  }

  function detail(child: Child): ChildDetail {
    return {
      ...summary(child),
      updatedAt: child.updatedAt,
      registeredByName: 'Sunita Devi',
      guardians: activeLinks(child.id)
        .sort((a, b) => Number(b.isPrimaryContact) - Number(a.isPrimaryContact))
        .map(linkDto),
    };
  }

  function birth(input: { dateOfBirth?: string; ageEstimate?: { years: number; months: number } }) {
    const today = todayInIndia(new Date(clock));
    if (input.ageEstimate) {
      const date = subtractYearsMonths(today, input.ageEstimate.years, input.ageEstimate.months);
      const iso = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
      return { ok: true as const, dateOfBirth: iso, dobIsEstimated: true };
    }
    const date = parseCalendarDate(input.dateOfBirth ?? '');
    if (!date) return { ok: false as const, code: 'INVALID_DATE_OF_BIRTH' };
    if (compareCalendarDates(date, today) > 0) return { ok: false as const, code: 'DATE_OF_BIRTH_IN_FUTURE' };
    return { ok: true as const, dateOfBirth: input.dateOfBirth!, dobIsEstimated: false };
  }

  function createGuardian(input: { fullName: string; phone?: string; preferredLanguage: string }) {
    const guardian: Guardian = {
      id: uuid(),
      fullName: input.fullName,
      phone: input.phone ?? null,
      preferredLanguage: input.preferredLanguage,
      updatedAt: tick(),
    };
    guardians.set(guardian.id, guardian);
    return guardian;
  }

  function addLink(
    childId: string,
    guardianId: string,
    input: { relationship: string; isPrimaryContact: boolean; canGiveConsent: boolean },
  ) {
    if (input.isPrimaryContact) for (const l of activeLinks(childId)) l.isPrimaryContact = false;
    const link: Link = { id: uuid(), childId, guardianId, ...input, linkedAt: tick(), endedAt: null };
    links.set(link.id, link);
    return link;
  }

  /** Same submission id: replay; different content: conflict (as the real API does). */
  function idempotent(opId: string, key: string, run: () => Result & { entityId?: string }): Result {
    const previous = operations.get(opId);
    if (previous) {
      if (previous.key !== key) return err(409, 'IDEMPOTENCY_KEY_REUSED');
      return { status: 201, body: replay.get(previous.entityId)!() };
    }
    const result = run();
    if (result.status === 201 && result.entityId) operations.set(opId, { key, entityId: result.entityId });
    return result;
  }
  const replay = new Map<string, () => unknown>();

  function guardianWarning(phone: string | undefined, confirm: boolean, index: number): Result | null {
    if (!phone || confirm) return null;
    const matches = [...guardians.values()].filter((g) => g.phone === phone);
    if (matches.length === 0) return null;
    return err(409, 'POSSIBLE_DUPLICATE_GUARDIAN', {
      guardianIndex: index,
      candidates: matches.map((g) => ({
        guardianId: g.id,
        fullName: g.fullName,
        phoneMasked: maskIndianMobile(g.phone!),
      })),
    });
  }

  function route(method: string, fullPath: string, rawBody: unknown, permissions: string[]): Result | null {
    const [path, queryString = ''] = fullPath.split('?');
    const query = new URLSearchParams(queryString);
    const parts = path!.split('/').filter(Boolean);
    const can = (p: string) => permissions.includes(p);

    if (parts[0] === 'guardians' && parts.length === 2) {
      const guardian = guardians.get(parts[1]!);
      const visible = guardian && [...links.values()].some((l) => l.guardianId === guardian.id && !l.endedAt);
      if (method === 'GET') {
        if (!can('child.read')) return err(403, 'FORBIDDEN');
        if (!guardian || !visible) return err(404, 'NOT_FOUND');
        return { status: 200, body: { guardian: guardianDto(guardian) } };
      }
      if (method === 'PATCH') {
        if (!can('child.update')) return err(403, 'FORBIDDEN');
        if (!guardian || !visible) return err(404, 'NOT_FOUND');
        const parsed = updateGuardianRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        if (parsed.data.expectedUpdatedAt !== guardian.updatedAt) return err(409, 'STALE_RECORD');
        if (parsed.data.fullName !== undefined) guardian.fullName = parsed.data.fullName;
        if (parsed.data.preferredLanguage !== undefined)
          guardian.preferredLanguage = parsed.data.preferredLanguage;
        if (parsed.data.phone !== undefined) guardian.phone = parsed.data.phone;
        guardian.updatedAt = tick();
        return { status: 200, body: { guardian: guardianDto(guardian) } };
      }
    }

    if (parts[0] !== 'children') return null;

    if (parts.length === 1 && method === 'GET') {
      if (!can('child.read')) return err(403, 'FORBIDDEN');
      const search = query.get('search')?.toLowerCase();
      const page = Number(query.get('page') ?? '1');
      const pageSize = Number(query.get('pageSize') ?? '20');
      const all = [...children.values()]
        .filter((c) => !search || c.fullName.toLowerCase().includes(search))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      return {
        status: 200,
        body: {
          items: all.slice((page - 1) * pageSize, page * pageSize).map(summary),
          page,
          pageSize,
          total: all.length,
        },
      };
    }

    if (parts.length === 1 && method === 'POST') {
      if (!can('child.create')) return err(403, 'FORBIDDEN');
      const parsed = registerChildRequestSchema.safeParse(rawBody);
      if (!parsed.success) return err(400, 'VALIDATION_ERROR');
      const body = parsed.data;
      const { clientOperationId, ...content } = body;
      return idempotent(clientOperationId, JSON.stringify(content), () => {
        if (!areas.some((a) => a.id === body.areaId)) return err(403, 'AREA_NOT_ALLOWED');
        const born = birth(body);
        if (!born.ok) return err(422, born.code);
        for (const [i, g] of body.guardians.entries()) {
          if (g.existingGuardianId && !guardians.has(g.existingGuardianId)) return err(404, 'NOT_FOUND');
          const warning = guardianWarning(g.newGuardian?.phone, g.confirmNewGuardian, i);
          if (warning) return warning;
        }
        const similar = [...children.values()].filter(
          (c) => c.fullName.toLowerCase() === body.fullName.toLowerCase(),
        );
        if (similar.length > 0 && !body.confirmNotDuplicate) {
          return err(409, 'POSSIBLE_DUPLICATE', {
            candidates: similar.map((c) => ({
              id: c.id,
              fullName: c.fullName,
              dateOfBirth: c.dateOfBirth,
              dobIsEstimated: c.dobIsEstimated,
              areaName: FAKE_AREA.nameEn,
              areaNameHi: FAKE_AREA.nameHi,
              reasons: ['SIMILAR_NAME_AND_BIRTH'],
            })),
          });
        }
        const now = tick();
        const child: Child = {
          id: uuid(),
          fullName: body.fullName,
          dateOfBirth: born.dateOfBirth,
          dobIsEstimated: born.dobIsEstimated,
          sexAtBirth: body.sexAtBirth ?? 'NOT_RECORDED',
          areaId: body.areaId,
          registeredAt: now,
          updatedAt: now,
        };
        children.set(child.id, child);
        for (const g of body.guardians) {
          const guardianId = g.existingGuardianId ?? createGuardian(g.newGuardian!).id;
          addLink(child.id, guardianId, g);
        }
        replay.set(child.id, () => ({ child: detail(children.get(child.id)!) }));
        return { status: 201, body: { child: detail(child) }, entityId: child.id };
      });
    }

    if (parts[1] === 'registration-areas' && method === 'GET') {
      if (!can('child.create')) return err(403, 'FORBIDDEN');
      return {
        status: 200,
        body: {
          items: areas.map((a) => ({
            id: a.id,
            nameEn: a.nameEn,
            nameHi: a.nameHi,
            levelNameEn: 'Village',
            levelNameHi: 'गाँव',
            parentNameEn: null,
            parentNameHi: null,
          })),
          truncated: false,
        },
      };
    }

    const child = children.get(parts[1] ?? '');
    if (parts.length === 2) {
      if (method === 'GET') {
        if (!can('child.read')) return err(403, 'FORBIDDEN');
        return child ? { status: 200, body: { child: detail(child) } } : err(404, 'NOT_FOUND');
      }
      if (method === 'PATCH') {
        if (!can('child.update')) return err(403, 'FORBIDDEN');
        if (!child) return err(404, 'NOT_FOUND');
        const parsed = updateChildRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        if (parsed.data.expectedUpdatedAt !== child.updatedAt) return err(409, 'STALE_RECORD');
        if (parsed.data.dateOfBirth || parsed.data.ageEstimate) {
          const born = birth(parsed.data);
          if (!born.ok) return err(422, born.code);
          child.dateOfBirth = born.dateOfBirth;
          child.dobIsEstimated = born.dobIsEstimated;
        }
        if (parsed.data.fullName) child.fullName = parsed.data.fullName;
        if (parsed.data.sexAtBirth) child.sexAtBirth = parsed.data.sexAtBirth;
        child.updatedAt = tick();
        return { status: 200, body: { child: detail(child) } };
      }
    }

    if (parts[2] === 'guardians') {
      if (!child) return err(404, 'NOT_FOUND');
      if (parts.length === 3 && method === 'GET') {
        return { status: 200, body: { items: activeLinks(child.id).map(linkDto) } };
      }
      if (parts.length === 3 && method === 'POST') {
        if (!can('child.update')) return err(403, 'FORBIDDEN');
        const parsed = addGuardianLinkRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        const { clientOperationId, ...content } = parsed.data;
        return idempotent(clientOperationId, JSON.stringify({ childId: child.id, ...content }), () => {
          const body = parsed.data;
          if (body.existingGuardianId) {
            if (!guardians.has(body.existingGuardianId)) return err(404, 'NOT_FOUND');
            if (activeLinks(child.id).some((l) => l.guardianId === body.existingGuardianId)) {
              return err(409, 'GUARDIAN_ALREADY_LINKED');
            }
          }
          const warning = guardianWarning(body.newGuardian?.phone, body.confirmNewGuardian, 0);
          if (warning) return warning;
          const guardianId = body.existingGuardianId ?? createGuardian(body.newGuardian!).id;
          const link = addLink(child.id, guardianId, body);
          child.updatedAt = tick();
          replay.set(link.id, () => ({ link: linkDto(links.get(link.id)!) }));
          return { status: 201, body: { link: linkDto(link) }, entityId: link.id };
        });
      }
      const link = links.get(parts[3] ?? '');
      if (!link || link.childId !== child.id || link.endedAt) return err(404, 'NOT_FOUND');
      if (method === 'PATCH') {
        const parsed = updateGuardianLinkRequestSchema.safeParse(rawBody);
        if (!parsed.success) return err(400, 'VALIDATION_ERROR');
        if (parsed.data.isPrimaryContact) for (const l of activeLinks(child.id)) l.isPrimaryContact = false;
        Object.assign(
          link,
          Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)),
        );
        return { status: 200, body: { link: linkDto(link) } };
      }
      if (method === 'DELETE') {
        const reason = (rawBody as { reason?: string } | undefined)?.reason;
        if (!reason || reason.trim().length < 3) return err(400, 'VALIDATION_ERROR');
        if (activeLinks(child.id).length <= 1) return err(409, 'LAST_GUARDIAN');
        link.endedAt = tick();
        return { status: 200, body: { link: linkDto(link) } };
      }
    }
    return null;
  }

  function guardianDto(guardian: Guardian) {
    return {
      id: guardian.id,
      fullName: guardian.fullName,
      phone: guardian.phone,
      preferredLanguage: guardian.preferredLanguage,
      updatedAt: guardian.updatedAt,
      children: [...links.values()]
        .filter((l) => l.guardianId === guardian.id && !l.endedAt)
        .map((l) => ({
          childId: l.childId,
          childName: children.get(l.childId)!.fullName,
          relationshipId: l.id,
          relationship: l.relationship,
          isPrimaryContact: l.isPrimaryContact,
          canGiveConsent: l.canGiveConsent,
        })),
    };
  }

  return {
    route,
    /** Seeds a registered child with one guardian (synthetic). */
    seedChild(
      input: Partial<Child> & { fullName: string },
      guardian: { fullName: string; phone?: string } = { fullName: 'Synthetic Mother' },
    ) {
      const now = tick();
      const child: Child = {
        id: uuid(),
        dateOfBirth: '2022-05-17',
        dobIsEstimated: false,
        sexAtBirth: 'FEMALE',
        areaId: FAKE_AREA.id,
        registeredAt: now,
        updatedAt: now,
        ...input,
      };
      children.set(child.id, child);
      const g = createGuardian({ ...guardian, preferredLanguage: 'hi' });
      const link = addLink(child.id, g.id, {
        relationship: 'MOTHER',
        isPrimaryContact: true,
        canGiveConsent: true,
      });
      return { child, guardian: g, link };
    },
    /** Simulates another worker saving the child (bumps the version). */
    touchChild(childId: string) {
      children.get(childId)!.updatedAt = tick();
    },
    setAreas(next: typeof areas) {
      areas = next;
    },
    children,
    guardians,
    links,
  };
}

export type FakeChildren = ReturnType<typeof createFakeChildren>;
