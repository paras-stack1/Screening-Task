import type { AssignmentScope, AssignmentStatus, PrismaClient, UserStatus } from '@prisma/client';
import { createArea } from '../../src/modules/areas/areaTree';

/**
 * The synthetic scenario world of docs/database-design.md section 6:
 *
 * UP > D1 > B1 > S1 > V1 > AWC1        Children: C1 in V1, C2 in V2, C3 in V3,
 *               S1 > V2                          C4 in AWC1, C5 in V4, C6 in V5
 *          B1 > S2 > V3
 *       D1 > B2 > S3 > V4
 *    UP > D2 > B3 > S4 > V5
 */
const DAY = 24 * 60 * 60 * 1000;

export type Fixture = Awaited<ReturnType<typeof buildScenarioFixture>>;

export async function buildScenarioFixture(prisma: PrismaClient) {
  const now = Date.now();

  const levelRows: Array<[string, number, boolean]> = [
    ['STATE', 10, false],
    ['DISTRICT', 20, false],
    ['BLOCK', 30, false],
    ['SECTOR', 40, false],
    ['VILLAGE', 50, true],
    ['ANGANWADI_CENTRE', 60, true],
  ];
  const level: Record<string, string> = {};
  for (const [code, rank, allowsChildRegistration] of levelRows) {
    const row = await prisma.areaLevel.create({
      data: { code, nameEn: code, nameHi: code, rank, allowsChildRegistration },
    });
    level[code] = row.id;
  }

  const tree: Array<[string, string, string | null]> = [
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
  const area: Record<string, string> = {};
  await prisma.$transaction(
    async (tx) => {
      for (const [code, levelCode, parent] of tree) {
        const row = await createArea(tx, {
          levelId: level[levelCode]!,
          parentId: parent ? area[parent]! : null,
          code,
          nameEn: code,
        });
        area[code] = row.id;
      }
    },
    { timeout: 30_000 },
  ); // default 5 s can be exceeded on a busy machine

  const permission: Record<string, string> = {};
  for (const code of ['child.read', 'report.aggregate']) {
    permission[code] = (await prisma.permission.create({ data: { code, description: code } })).id;
  }

  const roleDefs: Record<string, string[]> = {
    ASHA: ['child.read'],
    ANGANWADI_WORKER: ['child.read'],
    SUPERVISOR: ['child.read', 'report.aggregate'],
    DISTRICT_ADMIN: ['report.aggregate'],
  };
  const role: Record<string, string> = {};
  for (const [code, perms] of Object.entries(roleDefs)) {
    role[code] = (
      await prisma.role.create({
        data: {
          code,
          nameEn: code,
          nameHi: code,
          permissions: { create: perms.map((p) => ({ permissionId: permission[p]! })) },
        },
      })
    ).id;
  }

  const userDefs: Array<[string, UserStatus]> = [
    ['admin', 'ACTIVE'],
    ['asha1', 'ACTIVE'],
    ['aww1', 'ACTIVE'],
    ['sup1', 'ACTIVE'],
    ['sup2', 'ACTIVE'],
    ['dadmin', 'ACTIVE'],
    ['asha_ended', 'ACTIVE'],
    ['asha_future', 'ACTIVE'],
    ['asha_susp', 'ACTIVE'],
    ['asha_deact', 'DEACTIVATED'],
  ];
  const user: Record<string, string> = {};
  for (const [loginId, status] of userDefs) {
    user[loginId] = (
      await prisma.user.create({
        data: { loginId, passwordHash: 'not-a-real-hash', displayName: loginId, status },
      })
    ).id;
  }

  const childDefs: Array<[string, string]> = [
    ['C1', 'V1'],
    ['C2', 'V2'],
    ['C3', 'V3'],
    ['C4', 'AWC1'],
    ['C5', 'V4'],
    ['C6', 'V5'],
  ];
  const child: Record<string, string> = {};
  for (const [name, areaCode] of childDefs) {
    child[name] = (
      await prisma.child.create({
        data: {
          areaId: area[areaCode]!,
          fullName: name,
          dateOfBirth: new Date('2022-01-01'),
          sexAtBirth: 'FEMALE',
          createdById: user.admin!,
        },
      })
    ).id;
  }

  const assign = (
    login: string,
    roleCode: string,
    areaCode: string,
    scope: AssignmentScope,
    options: { status?: AssignmentStatus; from?: number; to?: number | null } = {},
  ) =>
    prisma.workerAreaAssignment.create({
      data: {
        userId: user[login]!,
        roleId: role[roleCode]!,
        areaId: area[areaCode]!,
        scope,
        status: options.status ?? 'ACTIVE',
        effectiveFrom: new Date(options.from ?? now - 30 * DAY),
        effectiveTo: options.to ? new Date(options.to) : null,
        createdById: user.admin!,
      },
    });

  await assign('asha1', 'ASHA', 'V1', 'AREA_ONLY');
  await assign('asha1', 'ASHA', 'V2', 'AREA_ONLY');
  await assign('aww1', 'ANGANWADI_WORKER', 'AWC1', 'AREA_ONLY');
  await assign('sup1', 'SUPERVISOR', 'B1', 'AREA_AND_DESCENDANTS');
  await assign('sup2', 'SUPERVISOR', 'B1', 'AREA_ONLY');
  await assign('dadmin', 'DISTRICT_ADMIN', 'D1', 'AREA_AND_DESCENDANTS');
  await assign('asha_ended', 'ASHA', 'V5', 'AREA_ONLY', { to: now - DAY });
  await assign('asha_future', 'ASHA', 'V4', 'AREA_ONLY', { from: now + DAY });
  await assign('asha_susp', 'ASHA', 'V1', 'AREA_ONLY', { status: 'SUSPENDED' });
  await assign('asha_deact', 'ASHA', 'V1', 'AREA_ONLY');

  return { level, area, role, user, child, assign };
}

/** Thrown to abort the transaction on purpose. */
class RollbackSignal extends Error {}

/** Runs `fn` in a transaction that is always rolled back, so scenarios do not affect each other. */
export async function inRollback(
  prisma: PrismaClient,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw new RollbackSignal();
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
}
