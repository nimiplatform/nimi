import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, InlineAlert, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { classifyPortfolioFailure, type OwnerPortfolioAgent } from './portfolio-data.js';
import { listOwnerPortfolioAgents } from './portfolio-client.js';

function formatUpdatedAt(value: string | null) {
  if (!value) return 'Realm updated source unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function friendCountLabel(agent: OwnerPortfolioAgent) {
  if (agent.friendCount.status === 'available') {
    return `${agent.friendCount.value} friends`;
  }
  return agent.friendCount.label;
}

function AgentCard({ agent, active, onSelect }: { agent: OwnerPortfolioAgent; active: boolean; onSelect: () => void }) {
  return (
    <Surface
      as="button"
      type="button"
      padding="md"
      tone="card"
      interactive
      active={active}
      className="grid w-full min-w-0 grid-cols-[56px_1fr] gap-3 text-left"
      onClick={onSelect}
    >
      <div className="h-14 w-14 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
        {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="ras-break-anywhere truncate text-[length:var(--nimi-type-label-size)] font-[var(--nimi-type-label-weight)]">
            {agent.displayName}
          </div>
          <StatusBadge tone={agent.friendCount.status === 'available' ? 'success' : 'warning'} shape="dot">
            {friendCountLabel(agent)}
          </StatusBadge>
        </div>
        <div className="ras-break-anywhere mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
          @{agent.handle}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge tone="info">owner-created</StatusBadge>
          <StatusBadge tone="neutral">{agent.worldName || 'world source unavailable'}</StatusBadge>
        </div>
      </div>
    </Surface>
  );
}

function AgentDetail({ agent }: { agent: OwnerPortfolioAgent }) {
  return (
    <section className="min-w-0 flex-1">
      <Surface tone="panel" padding="lg" className="min-h-full">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0">
            <div className="h-44 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
              {agent.coverUrl ? <img src={agent.coverUrl} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="mt-5 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="ras-break-anywhere m-0 text-2xl font-semibold">{agent.displayName}</h2>
                <StatusBadge tone="info">Realm source</StatusBadge>
              </div>
              <p className="ras-break-anywhere m-0 mt-2 text-[var(--nimi-text-secondary)]">@{agent.handle}</p>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <Surface tone="card" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Canonical source</div>
              <div className="ras-break-anywhere mt-1 font-medium">{agent.source}</div>
            </Surface>
            <Surface tone="card" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">好友数 / friendCount</div>
              <div className="mt-1 font-medium">{friendCountLabel(agent)}</div>
            </Surface>
            <Surface tone="card" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Realm evidence</div>
              <div className="mt-1 font-medium">{agent.realmState || 'state source unavailable'}</div>
              <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                {formatUpdatedAt(agent.updatedAt)}
              </div>
            </Surface>
          </div>
        </div>
      </Surface>
    </section>
  );
}

export function OwnerPortfolio() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const portfolioQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-portfolio'],
    queryFn: () => listOwnerPortfolioAgents(),
  });

  const selectedAgent = useMemo(() => {
    const agents = portfolioQuery.data || [];
    return agents.find((agent) => agent.id === selectedId) || agents[0] || null;
  }, [portfolioQuery.data, selectedId]);

  const sourceWarnings = (portfolioQuery.data || []).filter((agent) => agent.friendCount.status === 'source-unavailable');

  if (portfolioQuery.isLoading) {
    return <EmptyState title="Loading Realm owner portfolio" description="Reading GET /api/me/agents through SDK MeService.listMyRealmAgents." />;
  }

  if (portfolioQuery.isError) {
    const failure = classifyPortfolioFailure(portfolioQuery.error);
    return (
      <InlineAlert tone="danger">
        <strong>{failure.title}</strong>
        <div>{failure.detail}</div>
      </InlineAlert>
    );
  }

  const agents = portfolioQuery.data || [];
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No owner-created Realm Agents"
        description="Realm returned an empty current-user MASTER_OWNED portfolio from GET /api/me/agents."
        action={<Button onClick={() => void portfolioQuery.refetch()}>Refresh</Button>}
      />
    );
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[360px_1fr]">
      <aside className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold">Owner portfolio</h2>
            <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">GET /api/me/agents</p>
          </div>
          <Button loading={portfolioQuery.isFetching} onClick={() => void portfolioQuery.refetch()}>Refresh</Button>
        </div>
        {sourceWarnings.length > 0 ? (
          <InlineAlert tone="warning" className="mb-3">
            friendCount source unavailable for {sourceWarnings.length} Realm Agent{sourceWarnings.length === 1 ? '' : 's'}.
          </InlineAlert>
        ) : null}
        <div className="grid gap-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} active={agent.id === selectedAgent?.id} onSelect={() => setSelectedId(agent.id)} />
          ))}
        </div>
      </aside>
      {selectedAgent ? <AgentDetail agent={selectedAgent} /> : null}
    </div>
  );
}
