import type { PermissionCode } from './permissions';

/**
 * ROLE -> PERMISSION MATRIX. ASSUMPTION - illustrative, to be confirmed by the RBSK programme
 * (decision D2; docs/authorization.md). Approved changes for Step 3: user.manage added to
 * DISTRICT_ADMIN and STATE_ADMIN (decision G). District and state administrators do not read
 * individual child records (decision D3). Step 7 (decisions K, Q): referral.approve for medical
 * officers only; follow_up.update for field workers, medical officers and supervisors.
 *
 * Used by the seed (which makes the database match this list exactly) and by the RBAC tests.
 */
const WORKER: PermissionCode[] = [
  'child.read',
  'child.create',
  'child.update',
  'consent.record',
  'screening.conduct',
  'referral.create',
  'follow_up.update',
];

export const ROLES: Array<{ code: string; nameEn: string; nameHi: string; permissions: PermissionCode[] }> = [
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
    permissions: [...WORKER, 'screening.review', 'referral.update', 'referral.approve'],
  },
  {
    code: 'SUPERVISOR',
    nameEn: 'Supervisor',
    nameHi: 'पर्यवेक्षक',
    permissions: [
      'child.read',
      'referral.update',
      'follow_up.update',
      'report.aggregate',
      'assignment.manage',
    ],
  },
  {
    code: 'DISTRICT_ADMIN',
    nameEn: 'District Administrator',
    nameHi: 'ज़िला प्रशासक',
    permissions: ['report.aggregate', 'assignment.manage', 'user.manage', 'facility.manage'],
  },
  {
    code: 'STATE_ADMIN',
    nameEn: 'State Administrator',
    nameHi: 'राज्य प्रशासक',
    permissions: [
      'report.aggregate',
      'assignment.manage',
      'user.manage',
      'area.manage',
      'facility.manage',
      'audit.read',
    ],
  },
];
