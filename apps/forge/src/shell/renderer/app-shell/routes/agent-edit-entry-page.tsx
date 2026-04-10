import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { useAgentDetailQuery } from '@renderer/hooks/use-agent-queries.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';
import AgentDetailPage from '@renderer/pages/agents/agent-detail-page.js';

export default function AgentEditEntryPage() {
  const navigate = useNavigate();
  const { agentId = '' } = useParams<{ agentId: string }>();
  const ensureWorkspaceForWorld = useForgeWorkspaceStore((state) => state.ensureWorkspaceForWorld);
  const ensureWorldAgentDraft = useForgeWorkspaceStore((state) => state.ensureWorldAgentDraft);
  const agentQuery = useAgentDetailQuery(agentId);
  const worldQuery = useWorldDetailQuery(agentQuery.data?.worldId ?? '');
  const redirectedRef = useRef<string | null>(null);

  useEffect(() => {
    const agent = agentQuery.data;
    const world = worldQuery.data;
    if (!agent || agent.ownershipType !== 'WORLD_OWNED' || !agent.worldId || !world) {
      return;
    }
    const workspaceId = ensureWorkspaceForWorld({
      worldId: agent.worldId,
      title: world.name,
      description: world.description,
    });
    const draftAgentId = ensureWorldAgentDraft(workspaceId, {
      sourceAgentId: agent.id,
      displayName: agent.displayName || agent.handle,
      handle: agent.handle,
      concept: agent.concept,
      worldId: agent.worldId,
      description: agent.description ?? '',
      scenario: agent.scenario ?? '',
      greeting: agent.greeting ?? '',
      avatarUrl: agent.avatarUrl,
    });
    const redirectKey = `${workspaceId}:${draftAgentId}`;
    if (redirectedRef.current === redirectKey) {
      return;
    }
    redirectedRef.current = redirectKey;
    navigate(`/workbench/${workspaceId}/agents/${draftAgentId}`, { replace: true });
  }, [
    agentQuery.data,
    ensureWorkspaceForWorld,
    ensureWorldAgentDraft,
    navigate,
    worldQuery.data,
  ]);

  if (!agentId) {
    return <ForgeEmptyState message="No agent ID provided." />;
  }

  if (agentQuery.isLoading || agentQuery.isFetching) {
    return <ForgeLoadingSpinner />;
  }

  if (!agentQuery.data) {
    return <ForgeEmptyState message="Agent not found." />;
  }

  if (agentQuery.data.ownershipType === 'WORLD_OWNED') {
    if (worldQuery.isLoading || worldQuery.isFetching) {
      return <ForgeLoadingSpinner />;
    }
    if (!worldQuery.data) {
      return <ForgeEmptyState message="World not found for this agent." />;
    }
    return <ForgeLoadingSpinner />;
  }

  return <AgentDetailPage />;
}
