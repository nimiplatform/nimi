import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, FieldShell, InlineAlert, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  classifyAgentDetailFailure,
  classifyPortfolioFailure,
  type OwnerPortfolioAgent,
  type OwnerPortfolioAgentDetail,
  type SettingField,
} from './portfolio-data.js';
import { getOwnerPortfolioAgentDetail, listOwnerPortfolioAgents } from './portfolio-client.js';

function friendCountLabel(agent: OwnerPortfolioAgent) {
  if (agent.friendCount.status === 'available') {
    return `${agent.friendCount.value} friends`;
  }
  return agent.friendCount.label;
}

function detailFriendCountLabel(agent: OwnerPortfolioAgentDetail) {
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

function FieldStatus({ field }: { field: SettingField }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      <StatusBadge tone={field.status === 'available' ? 'success' : 'warning'} shape="dot">
        {field.status === 'available' ? field.source : field.unavailableLabel}
      </StatusBadge>
      <StatusBadge tone="neutral">read-only</StatusBadge>
    </div>
  );
}

function ReadOnlySettingField({ field, multiline = false }: { field: SettingField; multiline?: boolean }) {
  const message = field.status === 'available'
    ? 'Read from GET /api/me/agents/{agentId}; write ownership is not admitted in this slice.'
    : 'Source unavailable from GET /api/me/agents/{agentId}.';

  return (
    <FieldShell label={field.label} message={message} messageTone={field.status === 'available' ? 'neutral' : 'danger'}>
      {multiline ? (
        <TextareaField readOnly value={field.value} placeholder={field.unavailableLabel || 'setting read unavailable'} />
      ) : (
        <TextField readOnly value={field.value} placeholder={field.unavailableLabel || 'setting read unavailable'} />
      )}
    </FieldShell>
  );
}

function EvidenceCard({ field }: { field: SettingField }) {
  return (
    <Surface tone="card" padding="md">
      <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">{field.label}</div>
      <div className="ras-break-anywhere mt-1 font-medium">{field.value || field.unavailableLabel}</div>
      <FieldStatus field={field} />
    </Surface>
  );
}

function AgentDetail({ agentId }: { agentId: string }) {
  const detailQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-portfolio-agent-detail', agentId],
    queryFn: () => getOwnerPortfolioAgentDetail(agentId),
  });

  if (detailQuery.isLoading) {
    return (
      <section className="min-w-0 flex-1">
        <EmptyState title="Loading Realm Agent settings" description="Reading GET /api/me/agents/{agentId} through SDK MeService.getMyRealmAgent." />
      </section>
    );
  }

  if (detailQuery.isError) {
    const failure = classifyAgentDetailFailure(detailQuery.error);
    return (
      <section className="min-w-0 flex-1">
        <InlineAlert tone="danger">
          <strong>{failure.title}</strong>
          <div>{failure.detail}</div>
        </InlineAlert>
      </section>
    );
  }

  const agent = detailQuery.data;
  if (!agent) {
    return null;
  }

  return (
    <section className="min-w-0 flex-1">
      <Surface tone="panel" padding="lg" className="min-h-full">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0">
            <div className="h-44 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
              {agent.profileCoverUrl.status === 'available' ? <img src={agent.profileCoverUrl.value} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="mt-5 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="ras-break-anywhere m-0 text-2xl font-semibold">{agent.displayName.value || 'Display name unavailable'}</h2>
                <StatusBadge tone="info">MeService.getMyRealmAgent</StatusBadge>
                <StatusBadge tone="neutral">read-only settings</StatusBadge>
              </div>
              <p className="ras-break-anywhere m-0 mt-2 text-[var(--nimi-text-secondary)]">
                {agent.handle.value ? `@${agent.handle.value}` : 'handle setting read unavailable'}
              </p>
            </div>
            <div className="mt-5 grid gap-4">
              <ReadOnlySettingField field={agent.displayName} />
              <ReadOnlySettingField field={agent.handle} />
              <ReadOnlySettingField field={agent.bio} multiline />
              <ReadOnlySettingField field={agent.greeting} multiline />
              <ReadOnlySettingField field={agent.profileCoverUrl} />
            </div>
          </div>
          <div className="grid content-start gap-3">
            <Surface tone="card" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Canonical source</div>
              <div className="ras-break-anywhere mt-1 font-medium">{agent.source}</div>
            </Surface>
            {agent.friendCount.status === 'available' ? (
              <Surface tone="card" padding="md">
                <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">好友数 / friendCount</div>
                <div className="mt-1 font-medium">{detailFriendCountLabel(agent)}</div>
              </Surface>
            ) : (
              <InlineAlert tone="warning">{agent.friendCount.label}</InlineAlert>
            )}
            <EvidenceCard field={agent.ownership} />
            <EvidenceCard field={agent.world} />
            <EvidenceCard field={agent.state} />
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
      {selectedAgent ? <AgentDetail agentId={selectedAgent.id} /> : null}
    </div>
  );
}
