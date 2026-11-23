import { MANAGEMENT_PERMISSIONS } from '@balswasthya/shared-contracts';
import { describe, expect, it } from 'vitest';
import { PERMISSION_DELEGATION } from '../src/modules/access-control/permissions';

describe('shared contracts stay in step with the API', () => {
  it('MANAGEMENT_PERMISSIONS (used by the portal) equals the API delegation table', () => {
    const fromApi = Object.entries(PERMISSION_DELEGATION)
      .filter(([, kind]) => kind === 'management')
      .map(([code]) => code)
      .sort();
    expect([...MANAGEMENT_PERMISSIONS].sort()).toEqual(fromApi);
  });
});
