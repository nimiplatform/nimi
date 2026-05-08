import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { useAgentDetailQuery } from '@renderer/hooks/use-agent-queries.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import AgentDetailPage from '@renderer/pages/agents/agent-detail-page.js';
import { useForgeWorkspaceStore } from '@renderer/state/forge-workspace-store.js';

export default function AgentEditEntryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { agentId = '' } = useParams<{ agentId: string }>();
  const agentQuery = useAgentDetailQuery(agentId);
  const agent = agentQuery.data;
  const worldId = agent?.ownershipType === 'WORLD_OWNED' ? agent.worldId ?? '' : '';
  const worldQuery = useWorldDetailQuery(worldId);
  const ensureWorkspaceForWorld = useForgeWorkspaceStore((state) => state.ensureWorkspaceForWorld);
  const ensureWorldAgentDraft = useForgeWorkspaceStore((state) => state.ensureWorldAgentDraft);
  const redirectedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agent || agent.ownershipType !== 'WORLD_OWNED' || !worldId || !worldQuery.data) {
      return;
    }
    const workspaceId = ensureWorkspaceForWorld({
      worldId,
      title: worldQuery.data.name,
      description: worldQuery.data.description,
    });
    const draftAgentId = ensureWorldAgentDraft(workspaceId, {
      sourceAgentId: agent.id,
      displayName: agent.displayName || agent.handle,
      handle: agent.handle,
      concept: agent.concept,
      worldId,
      description: agent.description ?? undefined,
      scenario: agent.scenario ?? undefined,
      greeting: agent.greeting ?? undefined,
      avatarUrl: agent.avatarUrl,
    });
    const redirectKey = `${workspaceId}:${draftAgentId}`;
    if (redirectedRef.current === redirectKey) {
      return;
    }
    redirectedRef.current = redirectKey;
    const nextParams = new URLSearchParams(location.search);
    navigate(`/workbench/${workspaceId}/agents/${draftAgentId}${nextParams.toString() ? `?${nextParams.toString()}` : ''}`, {
      replace: true,
    });
  }, [
    agent,
    ensureWorkspaceForWorld,
    ensureWorldAgentDraft,
    location.search,
    navigate,
    worldId,
    worldQuery.data,
  ]);

  if (!agentId) {
    return <ForgeEmptyState message="No agent ID provided." />;
  }

  if (agentQuery.isLoading || agentQuery.isFetching || (worldId && (worldQuery.isLoading || worldQuery.isFetching))) {
    return <ForgeLoadingSpinner />;
  }

  if (!agent) {
    return <ForgeEmptyState message="Agent not found." />;
  }

  if (agent.ownershipType === 'WORLD_OWNED') {
    if (!worldId) {
      return <ForgeEmptyState message="World-owned agent is missing world context." />;
    }
    if (!worldQuery.data) {
      return <ForgeEmptyState message="Owning world not found." />;
    }
    return <ForgeLoadingSpinner />;
  }

  return <AgentDetailPage />;
}
