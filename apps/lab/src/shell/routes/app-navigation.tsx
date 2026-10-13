import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createNimiNavigation } from '@nimiplatform/kit/core/navigation';
import { NimiNavigationProvider } from '@nimiplatform/kit/ui/app-chrome';
import { labCapabilities, type LabCapabilityId } from '../../lab/lab-capabilities.js';

const workspaceIds = ['agent-center', 'agent-conversation', 'agent-realtime', 'app-access', 'activity', 'integrations', 'ui-recipes', 'settings'] as const;
export type LabDestination = { id: LabCapabilityId | typeof workspaceIds[number]; runId?: string };
// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-navigation
export function createLabNavigation() {
  return createNimiNavigation<LabDestination>({ initial: { id: 'text.generate' }, validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Lab destination.');
    const input = value as Record<string, unknown>;
    const capability = labCapabilities.some(item => item.id === input.id);
    if (typeof input.id !== 'string' || !(capability || workspaceIds.includes(input.id as typeof workspaceIds[number]))
      || Object.keys(input).some(key => key !== 'id' && key !== 'runId')
      || input.runId !== undefined && (!capability || typeof input.runId !== 'string' || !input.runId.trim() || input.runId.length > 512)) throw new Error('Unknown Lab destination.');
    return { id: input.id as LabDestination['id'], ...(input.runId === undefined ? {} : { runId: input.runId as string }) };
  } });
}
type LabNavigationOwner = { navigation: ReturnType<typeof createLabNavigation>; ready: boolean; setReady(value: boolean): void; sidebarVisible: boolean; setSidebarVisible(value: boolean): void };
const Context = createContext<LabNavigationOwner | null>(null);
export function useLabNavigationOwner() { const owner = useContext(Context); if (!owner) throw new Error('Lab navigation owner missing.'); return owner; }
export function LabNavigationOwner({ children }: { children: ReactNode }) {
  const [navigation] = useState(createLabNavigation);
  const [ready, updateReady] = useState(false), [sidebarVisible, setSidebarVisible] = useState(true);
  const lifetime = useRef(0);
  useEffect(() => { const generation = ++lifetime.current; return () => { navigation.reset({ id: 'text.generate' }); queueMicrotask(() => { if (lifetime.current === generation) navigation.dispose(); }); }; }, [navigation]);
  const setReady = useCallback((value: boolean) => { if (!value) navigation.reset({ id: 'text.generate' }); updateReady(value); }, [navigation]);
  return <Context.Provider value={{ navigation, ready, setReady, sidebarVisible, setSidebarVisible }}>{children}</Context.Provider>;
}
export function LabNavigationScope({ children }: { children: ReactNode }) {
  return <NimiNavigationProvider controller={useLabNavigationOwner().navigation}>{children}</NimiNavigationProvider>;
}
