import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@balswasthya/shared-contracts';
import { fetchApiHealth } from '../services/healthService';
import { toErrorMessage } from '../utils/errors';

export type ApiHealthState =
  { status: 'checking' } | { status: 'online'; data: HealthResponse } | { status: 'offline'; error: string };

export function useApiHealth() {
  const [state, setState] = useState<ApiHealthState>({ status: 'checking' });
  // Incrementing this re-runs the effect; the previous run's result is ignored.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchApiHealth().then(
      (data) => {
        if (active) setState({ status: 'online', data });
      },
      (error: unknown) => {
        if (active) setState({ status: 'offline', error: toErrorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, retry };
}
