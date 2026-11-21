import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countClosureInconsistencies, createArea, moveArea } from '../../src/modules/areas/areaTree';
import { buildScenarioFixture, inRollback } from './scenarioFixture';
import { createTestPrisma, resetData } from './testDatabase';

/** Database-level rules from docs/database-design.md section 9, on the section 6 scenario tree. */
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  await buildScenarioFixture(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function areaId(code: string) {
  return (await prisma.area.findFirstOrThrow({ where: { code } })).id;
}

async function levelId(code: string) {
  return (await prisma.areaLevel.findUniqueOrThrow({ where: { code } })).id;
}

describe('area hierarchy rules', () => {
  it('the closure table is consistent after building the tree', async () => {
    expect(await countClosureInconsistencies(prisma)).toBe(0);
  });

  it('refuses to move an area under its own descendant (cycle)', async () => {
    const [s1, v1] = [await areaId('S1'), await areaId('V1')];
    await expect(prisma.$transaction((tx) => moveArea(tx, s1, v1))).rejects.toThrow(/own descendants/);
  });

  it('refuses a parent at a lower level (trigger)', async () => {
    const [v1, district] = [await areaId('V1'), await levelId('DISTRICT')];
    await expect(
      prisma.$transaction((tx) =>
        createArea(tx, { levelId: district, parentId: v1, code: 'BAD', nameEn: 'BAD' }),
      ),
    ).rejects.toThrow(/must be above child level/);
  });

  it('refuses a second root (trigger)', async () => {
    const state = await levelId('STATE');
    await expect(
      prisma.$transaction((tx) =>
        createArea(tx, { levelId: state, parentId: null, code: 'ROOT2', nameEn: 'ROOT2' }),
      ),
    ).rejects.toThrow(/Only one root/);
  });

  it('allows skipping a level (village directly under a block)', async () => {
    const [b3, village] = [await areaId('B3'), await levelId('VILLAGE')];
    await inRollback(prisma, async (tx) => {
      const vx = await createArea(tx, { levelId: village, parentId: b3, code: 'VX', nameEn: 'VX' });
      expect(vx.depth).toBe(3);
      expect(await countClosureInconsistencies(tx)).toBe(0);
    });
  });

  it('refuses to delete an area that still has sub-areas', async () => {
    const v1 = await areaId('V1');
    await expect(prisma.area.delete({ where: { id: v1 } })).rejects.toThrow();
  });
});

describe('assignment and audit rules', () => {
  it('rejects an assignment that ends before it starts', async () => {
    const [user, role, area] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { loginId: 'asha1' } }),
      prisma.role.findUniqueOrThrow({ where: { code: 'ASHA' } }),
      areaId('V3'),
    ]);
    await expect(
      prisma.workerAreaAssignment.create({
        data: {
          userId: user.id,
          roleId: role.id,
          areaId: area,
          scope: 'AREA_ONLY',
          effectiveFrom: new Date(),
          effectiveTo: new Date(Date.now() - 1000),
          createdById: user.id,
        },
      }),
    ).rejects.toThrow(/assignment_valid_period/);
  });

  it('AuditLog is append-only', async () => {
    const row = await prisma.auditLog.create({
      data: { action: 'test.event', entityType: 'Test', outcome: 'SUCCESS' },
    });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/);
  });
});
