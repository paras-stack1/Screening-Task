import type { ParentChild } from '@balswasthya/shared-contracts';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useServices } from './services';
import { useSession } from './session/SessionProvider';

/** Children shared with this parent (memory only) and which one is selected. */
export function useChildren() {
  const { api } = useServices();
  const { withToken, state } = useSession();
  const accountId = state.status === 'signedIn' ? state.account.id : 'none';
  return useQuery({
    queryKey: [accountId, 'children'],
    queryFn: () => withToken((token) => api.children(token)).then((r) => r.children),
    enabled: accountId !== 'none',
  });
}

export function useChildDetail(childId: string | null) {
  const { api } = useServices();
  const { withToken, state } = useSession();
  const accountId = state.status === 'signedIn' ? state.account.id : 'none';
  return useQuery({
    queryKey: [accountId, 'child', childId],
    queryFn: () => withToken((token) => api.child(token, childId!)).then((r) => r.child),
    enabled: accountId !== 'none' && Boolean(childId),
  });
}

interface Selection {
  selectedId: string | null;
  select(childId: string): void;
}
const SelectionContext = createContext<Selection | null>(null);

export function SelectedChildProvider({ children }: { children: ReactNode }) {
  const [selectedId, select] = useState<string | null>(null);
  const value = useMemo(() => ({ selectedId, select }), [selectedId]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The selected child, or the first one when nothing (or a no-longer-shared child) is selected. */
export function useSelectedChild(list: ParentChild[] | undefined) {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error('useSelectedChild outside SelectedChildProvider');
  const child = list?.find((c) => c.childId === selection.selectedId) ?? list?.[0] ?? null;
  return { child, select: selection.select };
}
