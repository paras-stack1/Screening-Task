import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@balswasthya/shared-contracts';
import { fetchApiHealth } from '../services/healthService';
import { toErrorMessage } from '../utils/errors';

export type ApiHealthState =
  | { status: 'checking' }
  | { status: 'online'; data: HealthResponse }
  | { status: 'offline'; error: string };

export function useApiHealth() {
  const [state, setState] = useState<ApiHealthState>({ status: 'checking' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    try {
      const data = await fetchApiHealth();
      setState({ status: 'online', data });
    } catch (error) {
      setState({ status: 'offline', error: toErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return { state, retry: check };
}
