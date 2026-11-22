/**
 * Development seed - SYNTHETIC / ILLUSTRATIVE DATA ONLY.
 *
 * Run: npm run db:seed (repo root). Idempotent: reference data is upserted; the demo area tree
 * is created only when the Area table is empty.
 *
 * ASSUMPTION - to be confirmed with the RBSK programme team: the area levels and the role
 * definitions below are illustrative (docs/database-design.md sections 3.1 and 4.1).
 * No users are created here. Create the first administrator with: npm run db:bootstrap-admin
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/modules/access-control/permissions';
import { ROLES } from '../src/modules/access-control/roles';
import { createArea } from '../src/modules/areas/areaTree';
import { ensureConsentTemplates } from '../src/modules/consent/consentNotices';
import { ensureDemoProtocols } from '../src/modules/screening/demoProtocols';

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
    // The code is the source of truth for seeded roles: add missing grants AND remove grants
    // that were taken out of the code (otherwise a removed permission would silently remain).
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: saved.id, permission: { code: { notIn: role.permissions } } },
      }),
      prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: saved.id, permissionId: p.id })),
        skipDuplicates: true,
      }),
    ]);
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

  // Consent notice versions as DRAFT rows (placeholder wording - never approved by the seed).
  const drift = await ensureConsentTemplates(prisma);
  if (drift.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('Consent notice wording differs from the stored hash (investigate):', drift);
  }

  // Screening DEMONSTRATION protocols as DRAFT (placeholder questions - never approvable).
  const protocolDrift = await ensureDemoProtocols(prisma);
  if (protocolDrift.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      'Demonstration protocol content differs from the stored content (investigate):',
      protocolDrift,
    );
  }

  const counts = {
    levels: await prisma.areaLevel.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    areas: await prisma.area.count(),
    closureLinks: await prisma.areaClosure.count(),
    consentTemplates: await prisma.consentTemplate.count(),
    screeningProtocols: await prisma.screeningProtocol.count(),
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
