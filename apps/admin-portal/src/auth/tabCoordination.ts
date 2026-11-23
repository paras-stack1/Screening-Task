/**
 * Coordination between browser tabs of the portal (docs/admin-portal/README.md section 3).
 *
 * All tabs share ONE refresh cookie, and every refresh rotates it. Two tabs refreshing at the
 * same moment could present the same cookie twice, which the API treats as token theft and
 * answers by ending the session. So refreshes run one at a time across tabs (Web Locks API).
 * A tab that waited simply refreshes with the newer cookie afterwards.
 *
 * Sign-out in one tab is announced to the others (BroadcastChannel), so no tab keeps working
 * with an access token after the person signed out elsewhere. Messages carry no data.
 */
export type TabMessage = 'signedOut' | 'signedIn';

export interface TabCoordination {
  /** Runs `task` while no other tab of the portal is refreshing. */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  announce(message: TabMessage): void;
  listen(listener: (message: TabMessage) => void): () => void;
}

const LOCK_NAME = 'balswasthya-admin-session-refresh';
const CHANNEL_NAME = 'balswasthya-admin-session';

export function createBrowserTabCoordination(): TabCoordination {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  return {
    // Without Web Locks (very old browsers), the in-tab single-flight still applies.
    exclusive: (task) => (locks ? locks.request(LOCK_NAME, task) : task()),
    announce: (message) => channel?.postMessage(message),
    listen: (listener) => {
      if (!channel) return () => undefined;
      const handler = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (data === 'signedOut' || data === 'signedIn') listener(data);
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}

/** For tests and single-tab use: no locking, no messages. */
export const noTabCoordination: TabCoordination = {
  exclusive: (task) => task(),
  announce: () => undefined,
  listen: () => () => undefined,
};
