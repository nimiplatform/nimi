import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  fetchWorldListItems,
  worldListQueryKey,
} from '@renderer/features/world/world-detail-queries.js';
import { AgentsPanelView } from './agents-panel-view';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  type LocalAgentListItem,
} from './local-agent-list-model';

export function AgentsPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const navigateToSourceDetail = useAppStore((state) => state.navigateToSourceDetail);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => fetchWorldListItems(),
    staleTime: 30_000,
    enabled: authStatus === 'authenticated',
  });
  const worldNameById = useMemo(() => {
    const worlds = worldsQuery.data ?? [];
    return new Map(worlds.map((world) => [world.id, world.name]));
  }, [worldsQuery.data]);

  const agentsQuery = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: async () => fetchLocalAgentList(ownerUserId),
    enabled: authStatus === 'authenticated' && Boolean(ownerUserId),
    staleTime: 15_000,
  });

  const agentsErrorMessage = agentsQuery.isError
    ? (agentsQuery.error instanceof Error && agentsQuery.error.message.trim()
      ? agentsQuery.error.message.trim()
      : '')
    : null;

  return (
    <AgentsPanelView
      authStatus={authStatus}
      agents={agentsQuery.data ?? []}
      agentsPending={agentsQuery.isPending}
      agentsErrorMessage={agentsErrorMessage}
      worldNameById={worldNameById}
      onRetry={() => { void agentsQuery.refetch(); }}
      onOpenAgent={(item: LocalAgentListItem) => navigateToSourceDetail(item.sourceRef)}
      onBrowseExplore={() => setActiveTab('explore')}
    />
  );
}
