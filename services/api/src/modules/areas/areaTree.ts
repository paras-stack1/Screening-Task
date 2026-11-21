import type { Area, Prisma } from '@prisma/client';
import { AppError } from '../../utils/AppError';

/**
 * Area hierarchy maintenance (docs/database-design.md sections 3 and 9.5).
 *
 * Area rows and AreaClosure rows must always change together, so every function here takes a
 * TRANSACTION client. The database trigger `area_check_hierarchy` additionally enforces level
 * order and the single root.
 */
type Tx = Prisma.TransactionClient;

export interface NewArea {
  levelId: string;
  parentId: string | null;
  code: string;
  nameEn: string;
  nameHi?: string;
  externalCode?: string;
}

/** Creates an area and its closure links (self link + one link per ancestor). */
export async function createArea(tx: Tx, input: NewArea): Promise<Area> {
  const parent = input.parentId
    ? await tx.area.findUnique({ where: { id: input.parentId }, select: { depth: true, isActive: true } })
    : null;
  if (input.parentId && !parent) throw AppError.badRequest('Parent area not found');
  if (parent && !parent.isActive) throw AppError.badRequest('Parent area is deactivated');

  const area = await tx.area.create({
    data: { ...input, depth: parent ? parent.depth + 1 : 0 },
  });

  if (input.parentId) {
    await tx.$executeRaw`
      INSERT INTO "AreaClosure" ("ancestorId", "descendantId", depth)
      SELECT "ancestorId", ${area.id}::uuid, depth + 1 FROM "AreaClosure" WHERE "descendantId" = ${input.parentId}::uuid
      UNION ALL SELECT ${area.id}::uuid, ${area.id}::uuid, 0`;
  } else {
    await tx.areaClosure.create({ data: { ancestorId: area.id, descendantId: area.id, depth: 0 } });
  }
  return area;
}

/**
 * Moves the subtree rooted at `areaId` under `newParentId`. Access changes automatically,
 * because coverage is computed from the closure table.
 */
export async function moveArea(tx: Tx, areaId: string, newParentId: string): Promise<void> {
  if (areaId === newParentId) throw AppError.badRequest('An area cannot be its own parent');

  // Cycle prevention: the new parent must not be inside the subtree being moved.
  const wouldCycle = await tx.areaClosure.findUnique({
    where: { ancestorId_descendantId: { ancestorId: areaId, descendantId: newParentId } },
  });
  if (wouldCycle) throw AppError.badRequest('Cannot move an area under one of its own descendants');

  // 1. Re-parent first: the hierarchy trigger validates level order before closure work.
  await tx.area.update({ where: { id: areaId }, data: { parentId: newParentId } });

  // 2. Detach the subtree from its old ancestors.
  await tx.$executeRaw`
    DELETE FROM "AreaClosure"
     WHERE "descendantId" IN (SELECT "descendantId" FROM "AreaClosure" WHERE "ancestorId" = ${areaId}::uuid)
       AND "ancestorId" NOT IN (SELECT "descendantId" FROM "AreaClosure" WHERE "ancestorId" = ${areaId}::uuid)`;

  // 3. Attach it under every ancestor of the new parent (including the new parent itself).
  await tx.$executeRaw`
    INSERT INTO "AreaClosure" ("ancestorId", "descendantId", depth)
    SELECT p."ancestorId", s."descendantId", p.depth + s.depth + 1
      FROM "AreaClosure" p CROSS JOIN "AreaClosure" s
     WHERE p."descendantId" = ${newParentId}::uuid AND s."ancestorId" = ${areaId}::uuid`;

  // 4. Recompute depth for the subtree (depth = number of strict ancestors).
  await tx.$executeRaw`
    UPDATE "Area" a
       SET depth = (SELECT count(*) - 1 FROM "AreaClosure" c WHERE c."descendantId" = a.id)
     WHERE a.id IN (SELECT "descendantId" FROM "AreaClosure" WHERE "ancestorId" = ${areaId}::uuid)`;
}

/**
 * Returns the number of inconsistent closure/depth rows (0 = healthy). Used by tests and
 * suitable for a scheduled health check.
 */
export async function countClosureInconsistencies(tx: Tx): Promise<number> {
  const [row] = await tx.$queryRaw<[{ problems: bigint }]>`
    SELECT
      (SELECT count(*) FROM "Area" a
        WHERE NOT EXISTS (SELECT 1 FROM "AreaClosure" c WHERE c."ancestorId" = a.id AND c."descendantId" = a.id AND c.depth = 0))
    + (SELECT count(*) FROM "AreaClosure" c
         JOIN "Area" anc ON anc.id = c."ancestorId"
         JOIN "Area" des ON des.id = c."descendantId"
        WHERE c.depth <> des.depth - anc.depth)
    + (SELECT count(*) FROM "Area" a
        WHERE a."parentId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "AreaClosure" c WHERE c."ancestorId" = a."parentId" AND c."descendantId" = a.id AND c.depth = 1))
    AS problems`;
  return Number(row.problems);
}
