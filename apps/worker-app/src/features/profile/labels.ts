import { isTranslationKey, type TranslateFn } from '../../localization';

/**
 * Display names for codes returned by GET /auth/me. The names mirror the backend role and area
 * level tables (services/api/src/modules/access-control/roles.ts, prisma/seed.ts). An unknown
 * code (e.g. a role added later on the server) is shown as the raw code rather than hidden.
 */
export function roleName(t: TranslateFn, code: string): string {
  const key = `role.${code}`;
  return isTranslationKey(key) ? t(key) : code;
}

export function areaLevelName(t: TranslateFn, code: string): string {
  const key = `areaLevel.${code}`;
  return isTranslationKey(key) ? t(key) : code;
}
