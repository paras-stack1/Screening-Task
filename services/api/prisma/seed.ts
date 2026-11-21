/**
 * Development seed - SYNTHETIC / ILLUSTRATIVE DATA ONLY.
 *
 * Run: npm run db:seed (repo root). Idempotent: reference data is upserted; the demo area tree
 * is created only when the Area table is empty.
 *
 * ASSUMPTION - to be confirmed with the RBSK programme team: the area levels and the role
 * definitions below are illustrative (docs/database-design.md sections 3.1 and 4.1).
 * No users are created here: accounts need password hashing (Phase 3, authentication).
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type PermissionCode } from '../src/modules/access-control/permissions';
import { createArea } from '../src/modules/areas/areaTree';

const prisma = new PrismaClient();

const LEVELS = [
  { code: 'STATE', nameEn: 'State', nameHi: 'राज्य', rank: 10, allowsChildRegistration: false },
  { code: 'DISTRICT', nameEn: 'District', nameHi: 'ज़िला', rank: 20, allowsChildRegistration: false },
  { code: 'BLOCK', nameEn: 'Block', nameHi: 'ब्लॉक', rank: 30, allowsChildRegistration: false },
  { code: 'SECTOR', nameEn: 'Sector', nameHi: 'सेक्टर', rank: 40, allowsChildRegistration: false },
  { code: 'VILLAGE', nameEn: 'Village', nameHi: 'गाँव', rank: 50, allowsChildRegistration: true },
  {
    code: 'ANGANWADI_CENTRE',
    nameEn: 'Anganwadi Centre',
    nameHi: 'आंगनवाड़ी केंद्र',
    rank: 60,
    allowsChildRegistration: true,
  },
] as const;

const WORKER: PermissionCode[] = [
  'child.read',
  'child.create',
  'child.update',
  'consent.record',
  'screening.conduct',
  'referral.create',
];

const ROLES: Array<{ code: string; nameEn: string; nameHi: string; permissions: PermissionCode[] }> = [
  { code: 'ASHA', nameEn: 'ASHA', nameHi: 'आशा', permissions: WORKER },
  {
    code: 'ANGANWADI_WORKER',
    nameEn: 'Anganwadi Worker',
    nameHi: 'आंगनवाड़ी कार्यकर्ता',
    permissions: WORKER,
  },
  {
    code: 'MHT_MEDICAL_OFFICER',
    nameEn: 'RBSK Mobile Health Team Medical Officer',
    nameHi: 'आरबीएसके मोबाइल हेल्थ टीम चिकित्सा अधिकारी',
    permissions: [...WORKER, 'screening.review', 'referral.update'],
  },
  {
    code: 'SUPERVISOR',
    nameEn: 'Supervisor',
    nameHi: 'पर्यवेक्षक',
    permissions: ['child.read', 'referral.update', 'report.aggregate', 'assignment.manage'],
  },
  {
    code: 'DISTRICT_ADMIN',
    nameEn: 'District Administrator',
    nameHi: 'ज़िला प्रशासक',
    permissions: ['report.aggregate', 'assignment.manage', 'facility.manage'],
  },
  {
    code: 'STATE_ADMIN',
    nameEn: 'State Administrator',
    nameHi: 'राज्य प्रशासक',
    permissions: ['report.aggregate', 'assignment.manage', 'area.manage', 'facility.manage', 'audit.read'],
  },
];

/** Synthetic demo tree: [code, levelCode, parentCode]. Names are placeholders, not real places. */
const DEMO_AREAS: Array<[string, string, string | null]> = [
  ['DEMO-STATE', 'STATE', null],
  ['DEMO-D1', 'DISTRICT', 'DEMO-STATE'],
  ['DEMO-D1-B1', 'BLOCK', 'DEMO-D1'],
  ['DEMO-D1-B1-S1', 'SECTOR', 'DEMO-D1-B1'],
  ['DEMO-D1-B1-S1-V1', 'VILLAGE', 'DEMO-D1-B1-S1'],
  ['DEMO-D1-B1-S1-V2', 'VILLAGE', 'DEMO-D1-B1-S1'],
  ['DEMO-D1-B1-S1-V1-AWC1', 'ANGANWADI_CENTRE', 'DEMO-D1-B1-S1-V1'],
  ['DEMO-D1-B2', 'BLOCK', 'DEMO-D1'],
  ['DEMO-D1-B2-S1', 'SECTOR', 'DEMO-D1-B2'],
  ['DEMO-D1-B2-S1-V1', 'VILLAGE', 'DEMO-D1-B2-S1'],
];

async function main() {
  for (const level of LEVELS) {
    await prisma.areaLevel.upsert({ where: { code: level.code }, update: {}, create: level });
  }

  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
  }

  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: {},
      create: { code: role.code, nameEn: role.nameEn, nameHi: role.nameHi },
    });
    const permissions = await prisma.permission.findMany({ where: { code: { in: role.permissions } } });
    await prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId: saved.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  if ((await prisma.area.count()) === 0) {
    const levels = new Map((await prisma.areaLevel.findMany()).map((l) => [l.code, l.id]));
    await prisma.$transaction(
      async (tx) => {
        const ids = new Map<string, string>();
        for (const [code, levelCode, parentCode] of DEMO_AREAS) {
          const area = await createArea(tx, {
            levelId: levels.get(levelCode)!,
            parentId: parentCode ? ids.get(parentCode)! : null,
            code,
            nameEn: `Demo ${code} (synthetic)`,
          });
          ids.set(code, area.id);
        }
      },
      { timeout: 30_000 },
    );
  }

  const counts = {
    levels: await prisma.areaLevel.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    areas: await prisma.area.count(),
    closureLinks: await prisma.areaClosure.count(),
  };
  // eslint-disable-next-line no-console
  console.log('Seed complete (synthetic data):', counts);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
