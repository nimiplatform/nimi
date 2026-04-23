import { useParams } from 'react-router-dom';
import { ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { useAgentDetailQuery } from '@renderer/hooks/use-agent-queries.js';
import AgentDetailPage from '@renderer/pages/agents/agent-detail-page.js';

export default function AgentEditEntryPage() {
  const { agentId = '' } = useParams<{ agentId: string }>();
  const agentQuery = useAgentDetailQuery(agentId);

  if (!agentId) {
    return <ForgeEmptyState message="No agent ID provided." />;
  }

  if (agentQuery.isLoading || agentQuery.isFetching) {
    return <ForgeLoadingSpinner />;
  }

  if (!agentQuery.data) {
    return <ForgeEmptyState message="Agent not found." />;
  }

  return <AgentDetailPage />;
}
