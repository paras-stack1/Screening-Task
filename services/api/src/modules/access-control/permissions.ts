/**
 * Permission codes checked by the API. This list is the source of truth: it is seeded into the
 * Permission table, and roles are mapped to these codes as configuration (RolePermission).
 * See docs/database-design.md section 4.1.
 */
export const PERMISSIONS = {
  'child.read': 'Read individual child, guardian and screening records',
  'child.create': 'Register children and guardians',
  'child.update': 'Update child and guardian records',
  'consent.record': 'Record or withdraw guardian consent',
  'screening.conduct': 'Conduct screening sessions and record measurements',
  'screening.review': 'Clinically review screening results',
  'referral.create': 'Create referrals and follow-ups',
  'referral.update': 'Update referral and follow-up status',
  'report.aggregate': 'View aggregate counts and summaries (no individual records)',
  'assignment.manage': 'Create, end or suspend worker area assignments within own scope',
  'user.manage':
    'Create accounts, change account status, reset passwords and revoke sessions of users within own scope',
  'area.manage': 'Change the area hierarchy',
  'facility.manage': 'Manage the facility directory',
  'audit.read': 'Read audit records',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

/**
 * Delegation class of every permission (decision D11, 2026-11-21; docs/authorization.md).
 *
 * - `management`: administrative power. An administrator may grant a role containing it only if
 *   they hold it themselves over the same area (design 4.4 rule 2 - no privilege escalation).
 * - `fieldwork`: work on children's records. An administrator holding assignment.manage may grant
 *   it inside their area WITHOUT holding it, so district/state admins can provision field workers
 *   while still not reading child records themselves (decision D3).
 *
 * Typed as a complete record: adding a permission without classifying it fails to compile.
 */
export const PERMISSION_DELEGATION: Record<PermissionCode, 'management' | 'fieldwork'> = {
  'child.read': 'fieldwork',
  'child.create': 'fieldwork',
  'child.update': 'fieldwork',
  'consent.record': 'fieldwork',
  'screening.conduct': 'fieldwork',
  'screening.review': 'fieldwork',
  'referral.create': 'fieldwork',
  'referral.update': 'fieldwork',
  'report.aggregate': 'management',
  'assignment.manage': 'management',
  'user.manage': 'management',
  'area.manage': 'management',
  'facility.manage': 'management',
  'audit.read': 'management',
};
