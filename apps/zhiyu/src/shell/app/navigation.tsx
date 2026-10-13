import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createNimiNavigation } from '@nimiplatform/kit/core/navigation';
import { NimiNavigationProvider } from '@nimiplatform/kit/ui/app-chrome';
import { AGENT_CENTER_SECTIONS, type AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
export type ZhiyuDestination = { id: 'partner'; agentHandle?: NimiLocalAppAgentHandle; conversationAnchorId?: string; panel?: AgentCenterSectionId };
// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r027
export function createZhiyuNavigation() {
  return createNimiNavigation<ZhiyuDestination>({ initial: { id: 'partner' }, validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Zhiyu position.');
    const input = value as Record<string, unknown>;
    if (input.id !== 'partner' || Object.keys(input).some(key => !['id', 'agentHandle', 'conversationAnchorId', 'panel'].includes(key))) throw new Error('Unknown Zhiyu destination.');
    for (const key of ['agentHandle', 'conversationAnchorId']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !(input[key] as string).trim() || (input[key] as string).length > 512)) throw new Error('Invalid partner reference.');
    if (input.conversationAnchorId && !input.agentHandle || input.panel !== undefined && !AGENT_CENTER_SECTIONS.includes(input.panel as AgentCenterSectionId)) throw new Error('Invalid partner panel position.');
    return { id: 'partner', ...(input.agentHandle === undefined ? {} : { agentHandle: input.agentHandle as NimiLocalAppAgentHandle }), ...(input.conversationAnchorId === undefined ? {} : { conversationAnchorId: input.conversationAnchorId as string }), ...(input.panel === undefined ? {} : { panel: input.panel as AgentCenterSectionId }) };
  } });
}
type Owner = { navigation: ReturnType<typeof createZhiyuNavigation>; ready: boolean; setReady(value: boolean): void; sidebarVisible: boolean; setSidebarVisible(value: boolean): void; hasSidebar: boolean; setHasSidebar(value: boolean): void };
const Context = createContext<Owner | null>(null);
export function useZhiyuNavigationOwner() { const value = useContext(Context); if (!value) throw new Error('Zhiyu navigation owner missing.'); return value; }
export function ZhiyuNavigationOwner({ children }: { children: ReactNode }) {
  const [navigation] = useState(createZhiyuNavigation);
  const [ready, updateReady] = useState(false), [sidebarVisible, setSidebarVisible] = useState(true), [hasSidebar, setHasSidebar] = useState(false);
  const lifetime = useRef(0);
  useEffect(() => { const generation = ++lifetime.current; return () => { navigation.reset({ id: 'partner' }); queueMicrotask(() => { if (lifetime.current === generation) navigation.dispose(); }); }; }, [navigation]);
  const setReady = useCallback((value: boolean) => { if (!value) { navigation.reset({ id: 'partner' }); setHasSidebar(false); } updateReady(value); }, [navigation]);
  return <Context.Provider value={{ navigation, ready, setReady, sidebarVisible, setSidebarVisible, hasSidebar, setHasSidebar }}><NimiNavigationProvider controller={navigation}>{children}</NimiNavigationProvider></Context.Provider>;
}
