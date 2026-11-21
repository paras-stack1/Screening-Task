import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  childScopeWhere,
  countChildrenInScope,
  findChildOrDeny,
  type Db,
} from '../../src/modules/access-control/accessScope';
import type { PermissionCode } from '../../src/modules/access-control/permissions';
import { countClosureInconsistencies, moveArea } from '../../src/modules/areas/areaTree';
import { AppError } from '../../src/utils/AppError';
import { buildScenarioFixture, inRollback, type Fixture } from './scenarioFixture';
import { createTestPrisma, resetData } from './testDatabase';

/** docs/database-design.md section 6, executed against the real migrated schema. */
let prisma: PrismaClient;
let fx: Fixture;

beforeAll(async () => {
  prisma = createTestPrisma();
  await resetData(prisma);
  fx = await buildScenarioFixture(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function readable(login: string, permission: PermissionCode = 'child.read', db: Db = prisma) {
  const rows = await db.child.findMany({
    where: childScopeWhere(fx.user[login]!, permission),
    select: { fullName: true },
    orderBy: { fullName: 'asc' },
  });
  return rows.map((row) => row.fullName);
}

describe('section 6 scenarios: who can read which children', () => {
  it.each([
    ['1: ASHA on V1 + V2 (AREA_ONLY) - not AWC1 below V1', 'asha1', ['C1', 'C2']],
    ['2: Anganwadi worker on AWC1', 'aww1', ['C4']],
    ['3: supervisor on B1 with descendants', 'sup1', ['C1', 'C2', 'C3', 'C4']],
    ['4: supervisor on B1, AREA_ONLY', 'sup2', []],
    ['5: district admin has no child.read', 'dadmin', []],
    ['6: assignment already ended', 'asha_ended', []],
    ['7: assignment starts tomorrow', 'asha_future', []],
    ['8: assignment suspended', 'asha_susp', []],
    ['9: user account deactivated', 'asha_deact', []],
  ])('scenario %s', async (_name, login, expected) => {
    expect(await readable(login)).toEqual(expected);
  });

  it('scenario 5: district admin gets an aggregate count only', async () => {
    expect(await countChildrenInScope(prisma, { userId: fx.user.dadmin! })).toBe(5);
    expect(await readable('dadmin', 'report.aggregate')).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
  });

  it('scenario 10: access follows the child when transferred V2 -> V3', async () => {
    await inRollback(prisma, async (tx) => {
      await tx.child.update({ where: { id: fx.child.C2 }, data: { areaId: fx.area.V3 } });
      expect(await readable('asha1', 'child.read', tx)).toEqual(['C1']);
      expect(await readable('sup1', 'child.read', tx)).toEqual(['C1', 'C2', 'C3', 'C4']);
    });
  });

  it('scenario 11: moving sector S2 to block B2 changes access with no assignment edits', async () => {
    await inRollback(prisma, async (tx) => {
      await moveArea(tx, fx.area.S2!, fx.area.B2!);
      expect(await readable('sup1', 'child.read', tx)).toEqual(['C1', 'C2', 'C4']);
      expect(await countClosureInconsistencies(tx)).toBe(0);
      const v3 = await tx.area.findUniqueOrThrow({ where: { id: fx.area.V3 } });
      expect(v3.depth).toBe(4);
    });
  });

  it('scenario 12: out-of-scope access returns 404 and is audited as DENIED', async () => {
    const ctx = { userId: fx.user.aww1!, requestId: `test-req-12-${randomUUID()}` };

    await expect(findChildOrDeny(prisma, ctx, fx.child.C6!, 'child.read')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    // AuditLog is append-only and survives between runs, so look up this run's unique request id.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { requestId: ctx.requestId } });
    expect(audit).toMatchObject({
      action: 'child.access_denied',
      outcome: 'DENIED',
      entityId: fx.child.C6,
      details: { permission: 'child.read', recordExists: true },
    });
    expect(JSON.stringify(audit)).not.toContain('C6'); // no child name in the audit record
  });

  it('scenario 12b: a non-existent id gives the same 404 (no existence leak)', async () => {
    const ctx = { userId: fx.user.aww1!, requestId: `test-req-12b-${randomUUID()}` };
    const error: unknown = await findChildOrDeny(
      prisma,
      ctx,
      '00000000-0000-4000-8000-000000000000',
      'child.read',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 404, message: 'Child not found' });
  });

  it('allowed access returns the record', async () => {
    const child = await findChildOrDeny(prisma, { userId: fx.user.aww1! }, fx.child.C4!, 'child.read');
    expect(child.id).toBe(fx.child.C4);
  });

  it('scenario 13: an overlapping duplicate assignment is rejected by the database', async () => {
    await expect(fx.assign('asha1', 'ASHA', 'V1', 'AREA_ONLY')).rejects.toThrow(/assignment_no_overlap/);
  });

  it('a REVOKED or non-overlapping assignment does not conflict', async () => {
    await inRollback(prisma, async (tx) => {
      await tx.workerAreaAssignment.create({
        data: {
          userId: fx.user.asha1!,
          roleId: fx.role.ASHA!,
          areaId: fx.area.V1!,
          scope: 'AREA_ONLY',
          status: 'REVOKED',
          effectiveFrom: new Date(),
          createdById: fx.user.admin!,
        },
      });
    });
  });
});

describe('additional deny-by-default rules', () => {
  it('a deactivated role grants nothing', async () => {
    await inRollback(prisma, async (tx) => {
      await tx.role.update({ where: { id: fx.role.SUPERVISOR }, data: { isActive: false } });
      expect(await readable('sup1', 'child.read', tx)).toEqual([]);
    });
  });

  it('soft-deleted children are excluded', async () => {
    await inRollback(prisma, async (tx) => {
      await tx.child.update({ where: { id: fx.child.C1 }, data: { deletedAt: new Date() } });
      expect(await readable('asha1', 'child.read', tx)).toEqual(['C2']);
    });
  });

  it("one assignment does not lend its permission to another assignment's area (R4)", async () => {
    // sup2 holds SUPERVISOR on B1 AREA_ONLY; give it ASHA (child.read) on V3 only.
    await inRollback(prisma, async (tx) => {
      await tx.workerAreaAssignment.create({
        data: {
          userId: fx.user.sup2!,
          roleId: fx.role.ASHA!,
          areaId: fx.area.V3!,
          scope: 'AREA_ONLY',
          effectiveFrom: new Date(Date.now() - 1000),
          createdById: fx.user.admin!,
        },
      });
      expect(await readable('sup2', 'child.read', tx)).toEqual(['C3']);
      expect(await readable('sup2', 'report.aggregate', tx)).toEqual([]);
    });
  });
});
