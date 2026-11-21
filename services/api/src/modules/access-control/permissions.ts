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
  'area.manage': 'Change the area hierarchy',
  'facility.manage': 'Manage the facility directory',
  'audit.read': 'Read audit records',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];
