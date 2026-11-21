import type { AssignmentScope, AssignmentStatus, PrismaClient, UserStatus } from '@prisma/client';
import request from 'supertest';
import { PERMISSIONS } from '../../src/modules/access-control/permissions';
import { ROLES } from '../../src/modules/access-control/roles';
import { createArea } from '../../src/modules/areas/areaTree';
import { hashPassword } from '../../src/utils/password';
import { createTestApp, DAY, TestClock, type TestApp } from './authFixture';

/**
 * Synthetic world for authorization tests (docs/database-design.md section 6 tree, the real
 * role matrix from src/modules/access-control/roles.ts):
 *
 * UP > D1 > B1 > S1 > V1 > AWC1        Children: C1 in V1, C2 in V2, C3 in V3,
 *               S1 > V2                          C4 in AWC1, C5 in V4, C6 in V5
 *          B1 > S2 > V3
 *       D1 > B2 > S3 > V4
 *    UP > D2 > B3 > S4 > V5
 *
 * C1 (in scope for asha1) and C6 (out of scope for everyone in D1) each get one record of every
 * child-linked type, so IDOR checks can be run per entity.
 */
export const PASSWORD = 'Synthetic-pass-2026';

const TREE: Array<[string, string, string | null]> = [
  ['UP', 'STATE', null],
  ['D1', 'DISTRICT', 'UP'],
  ['D2', 'DISTRICT', 'UP'],
  ['B1', 'BLOCK', 'D1'],
  ['B2', 'BLOCK', 'D1'],
  ['B3', 'BLOCK', 'D2'],
  ['S1', 'SECTOR', 'B1'],
  ['S2', 'SECTOR', 'B1'],
  ['S3', 'SECTOR', 'B2'],
  ['S4', 'SECTOR', 'B3'],
  ['V1', 'VILLAGE', 'S1'],
  ['V2', 'VILLAGE', 'S1'],
  ['V3', 'VILLAGE', 'S2'],
  ['V4', 'VILLAGE', 'S3'],
  ['V5', 'VILLAGE', 'S4'],
  ['AWC1', 'ANGANWADI_CENTRE', 'V1'],
];

type AssignmentSpec = [role: string, area: string, scope: AssignmentScope, options?: AssignmentOptions];
interface AssignmentOptions {
  status?: AssignmentStatus;
  fromOffsetMs?: number;
  toOffsetMs?: number;
}

/** login -> [user status, assignments]. */
const USERS: Record<string, [UserStatus, AssignmentSpec[]]> = {
  stateadmin: ['ACTIVE', [['STATE_ADMIN', 'UP', 'AREA_AND_DESCENDANTS']]],
  asha1: [
    'ACTIVE',
    [
      ['ASHA', 'V1', 'AREA_ONLY'],
      ['ASHA', 'V2', 'AREA_ONLY'],
    ],
  ],
  asha2: ['ACTIVE', [['ASHA', 'V2', 'AREA_ONLY']]],
  asha5: ['ACTIVE', [['ASHA', 'V5', 'AREA_ONLY']]],
  aww1: ['ACTIVE', [['ANGANWADI_WORKER', 'AWC1', 'AREA_ONLY']]],
  sup1: ['ACTIVE', [['SUPERVISOR', 'B1', 'AREA_AND_DESCENDANTS']]],
  sup2: ['ACTIVE', [['SUPERVISOR', 'B1', 'AREA_ONLY']]],
  dadmin1: ['ACTIVE', [['DISTRICT_ADMIN', 'D1', 'AREA_AND_DESCENDANTS']]],
  dadmin2: ['ACTIVE', [['DISTRICT_ADMIN', 'D2', 'AREA_AND_DESCENDANTS']]],
  /** Works in both districts: neither district admin alone may manage the account. */
  ashaboth: [
    'ACTIVE',
    [
      ['ASHA', 'V1', 'AREA_ONLY'],
      ['ASHA', 'V5', 'AREA_ONLY'],
    ],
  ],
  ashaended: ['ACTIVE', [['ASHA', 'V1', 'AREA_ONLY', { fromOffsetMs: -30 * DAY, toOffsetMs: -DAY }]]],
  ashafuture: ['ACTIVE', [['ASHA', 'V1', 'AREA_ONLY', { fromOffsetMs: DAY }]]],
  ashasusp: ['ACTIVE', [['ASHA', 'V1', 'AREA_ONLY', { status: 'SUSPENDED' }]]],
  ashareve: ['ACTIVE', [['ASHA', 'V1', 'AREA_ONLY', { status: 'REVOKED' }]]],
  /** Ended district-admin assignment + current supervisor one (expired grants must not count). */
  formeradmin: [
    'ACTIVE',
    [
      ['DISTRICT_ADMIN', 'D1', 'AREA_AND_DESCENDANTS', { fromOffsetMs: -30 * DAY, toOffsetMs: -DAY }],
      ['SUPERVISOR', 'B1', 'AREA_AND_DESCENDANTS'],
    ],
  ],
  noassign: ['ACTIVE', []],
};

export type AuthzFixture = Awaited<ReturnType<typeof buildAuthzFixture>>;

export async function buildAuthzFixture(prisma: PrismaClient, clock: TestClock) {
  const now = clock.now().getTime();

  const levels: Array<[string, number, boolean]> = [
    ['STATE', 10, false],
    ['DISTRICT', 20, false],
    ['BLOCK', 30, false],
    ['SECTOR', 40, false],
    ['VILLAGE', 50, true],
    ['ANGANWADI_CENTRE', 60, true],
  ];
  const level: Record<string, string> = {};
  for (const [code, rank, allowsChildRegistration] of levels) {
    level[code] = (
      await prisma.areaLevel.create({
        data: { code, nameEn: code, nameHi: code, rank, allowsChildRegistration },
      })
    ).id;
  }
  const area: Record<string, string> = {};
  await prisma.$transaction(
    async (tx) => {
      for (const [code, levelCode, parent] of TREE) {
        const row = await createArea(tx, {
          levelId: level[levelCode]!,
          parentId: parent ? area[parent]! : null,
          code,
          nameEn: `Area ${code}`,
        });
        area[code] = row.id;
      }
    },
    { timeout: 30_000 },
  );

  const permission: Record<string, string> = {};
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    permission[code] = (await prisma.permission.create({ data: { code, description } })).id;
  }
  const role: Record<string, string> = {};
  for (const r of ROLES) {
    role[r.code] = (
      await prisma.role.create({
        data: {
          code: r.code,
          nameEn: r.nameEn,
          nameHi: r.nameHi,
          permissions: { create: r.permissions.map((p) => ({ permissionId: permission[p]! })) },
        },
      })
    ).id;
  }

  const passwordHash = await hashPassword(PASSWORD);
  const user: Record<string, string> = {};
  for (const [login, [status]] of Object.entries(USERS)) {
    user[login] = (
      await prisma.user.create({
        data: {
          loginId: login.toUpperCase(),
          displayName: `Synthetic ${login}`,
          passwordHash,
          status,
          mustChangePassword: false,
        },
      })
    ).id;
  }
  const assignment: Record<string, string> = {};
  for (const [login, [, specs]] of Object.entries(USERS)) {
    for (const [roleCode, areaCode, scope, options = {}] of specs) {
      const row = await prisma.workerAreaAssignment.create({
        data: {
          userId: user[login]!,
          roleId: role[roleCode]!,
          areaId: area[areaCode]!,
          scope,
          status: options.status ?? 'ACTIVE',
          effectiveFrom: new Date(now + (options.fromOffsetMs ?? -30 * DAY)),
          effectiveTo: options.toOffsetMs === undefined ? null : new Date(now + options.toOffsetMs),
          createdById: user.stateadmin!,
        },
      });
      assignment[`${login}:${areaCode}`] = row.id;
    }
  }

  const child: Record<string, string> = {};
  for (const [name, areaCode] of [
    ['C1', 'V1'],
    ['C2', 'V2'],
    ['C3', 'V3'],
    ['C4', 'AWC1'],
    ['C5', 'V4'],
    ['C6', 'V5'],
  ] as const) {
    child[name] = (
      await prisma.child.create({
        data: {
          areaId: area[areaCode]!,
          fullName: `Synthetic Child ${name}`,
          dateOfBirth: new Date('2022-01-01'),
          sexAtBirth: 'FEMALE',
          createdById: user.stateadmin!,
        },
      })
    ).id;
  }

  // ------------------------------------------------ one record of every child-linked type
  const template = await prisma.consentTemplate.create({
    data: {
      purpose: 'PHOTO_CAPTURE',
      // Version 0: never collides with the real notice registry (versions start at 1).
      version: 0,
      languageCode: 'hi',
      textSha256: 'a'.repeat(64),
      status: 'APPROVED',
    },
  });
  const protocol = await prisma.screeningProtocol.create({
    data: {
      code: 'SYN',
      version: 1,
      nameEn: 'Synthetic',
      nameHi: 'Synthetic',
      ageMinDays: 0,
      ageMaxDays: 3000,
      sourceReference: 'synthetic',
    },
  });
  const question = await prisma.screeningQuestion.create({
    data: {
      protocolId: protocol.id,
      code: 'Q1',
      category: 'DEFICIENCIES',
      sortOrder: 1,
      promptKey: 'q1',
      answerType: 'YES_NO',
    },
  });
  const facility = await prisma.facility.create({
    data: { name: 'Synthetic PHC', type: 'PHC', areaId: area.D1! },
  });

  type Linked = Record<
    | 'guardian'
    | 'consent'
    | 'screeningSession'
    | 'screeningObservation'
    | 'measurement'
    | 'screeningResult'
    | 'aiAnalysis'
    | 'referral'
    | 'followUp'
    | 'media'
    | 'childTransfer',
    string
  >;
  const linked: Record<'C1' | 'C6', Linked> = {} as Record<'C1' | 'C6', Linked>;
  for (const name of ['C1', 'C6'] as const) {
    const childId = child[name]!;
    const childArea = name === 'C1' ? area.V1! : area.V5!;
    const by = user.stateadmin!;
    const guardian = await prisma.guardian.create({ data: { fullName: `Synthetic Guardian ${name}` } });
    await prisma.childGuardian.create({
      data: { childId, guardianId: guardian.id, relationship: 'MOTHER', canGiveConsent: true },
    });
    const consent = await prisma.consent.create({
      data: {
        childId,
        guardianId: guardian.id,
        purpose: 'PHOTO_CAPTURE',
        decision: 'GRANTED',
        method: 'SIGNATURE',
        templateId: template.id,
        recordedById: by,
        recordedAt: new Date(now),
      },
    });
    const session = await prisma.screeningSession.create({
      data: {
        childId,
        protocolId: protocol.id,
        conductedById: by,
        areaId: childArea,
        ageInDaysAtStart: 900,
        startedAt: new Date(now),
      },
    });
    const observation = await prisma.screeningObservation.create({
      data: {
        sessionId: session.id,
        questionId: question.id,
        status: 'ANSWERED',
        valueBoolean: false,
        recordedAt: new Date(now),
      },
    });
    const measurement = await prisma.measurement.create({
      data: {
        childId,
        sessionId: session.id,
        type: 'WEIGHT',
        value: 11.5,
        unit: 'kg',
        quality: 'RELIABLE',
        measuredAt: new Date(now),
        recordedById: by,
      },
    });
    const ai = await prisma.aiAnalysis.create({
      data: {
        sessionId: session.id,
        consentId: consent.id,
        analysisType: 'IMAGE_QUALITY',
        requestId: `req-${name}-${now}`,
        contractVersion: '0',
        isMock: true,
        status: 'COMPLETED',
        requestedAt: new Date(now),
      },
    });
    const result = await prisma.screeningResult.create({
      data: {
        sessionId: session.id,
        category: 'DEFICIENCIES',
        outcome: 'INSUFFICIENT_DATA',
        source: 'RULE_ENGINE',
        reasons: [],
      },
    });
    const referral = await prisma.referral.create({
      data: { childId, facilityId: facility.id, areaId: childArea, urgency: 'ROUTINE', createdById: by },
    });
    const followUp = await prisma.followUp.create({
      data: { childId, referralId: referral.id, dueDate: new Date('2027-01-01') },
    });
    const media = await prisma.mediaMetadata.create({
      data: {
        childId,
        sessionId: session.id,
        consentId: consent.id,
        type: 'PHOTO',
        purpose: 'PHOTO_CAPTURE',
        storageKey: `key-${name}-${now}`,
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
        sha256: 'b'.repeat(64),
        capturedById: by,
        capturedAt: new Date(now),
      },
    });
    const transfer = await prisma.childAreaTransfer.create({
      data: { childId, fromAreaId: childArea, toAreaId: childArea, transferredById: by, reason: 'synthetic' },
    });
    linked[name] = {
      guardian: guardian.id,
      consent: consent.id,
      screeningSession: session.id,
      screeningObservation: observation.id,
      measurement: measurement.id,
      screeningResult: result.id,
      aiAnalysis: ai.id,
      referral: referral.id,
      followUp: followUp.id,
      media: media.id,
      childTransfer: transfer.id,
    };
  }

  return { area, role, user, assignment, child, linked };
}

/** Signs in through the real API and returns an access token. */
export async function tokenFor(app: TestApp, login: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ loginId: login, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login ${login} failed: ${res.status}`);
  return res.body.accessToken as string;
}

export function api(app: TestApp, token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(app).get(`/api/v1${path}`)),
    post: (path: string, body?: object) => auth(request(app).post(`/api/v1${path}`)).send(body ?? {}),
    patch: (path: string, body?: object) => auth(request(app).patch(`/api/v1${path}`)).send(body ?? {}),
    delete: (path: string, body?: object) => {
      const req = auth(request(app).delete(`/api/v1${path}`));
      return body ? req.send(body) : req;
    },
  };
}

export { createTestApp, TestClock };
