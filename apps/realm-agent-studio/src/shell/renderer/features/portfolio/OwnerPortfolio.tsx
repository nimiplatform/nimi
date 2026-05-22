import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, FieldShell, InlineAlert, SearchField, SegmentedControl, SelectField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { studioWorkspaceItems, type StudioWorkspace } from '../../app-shell/shell-layout.js';
import {
  applyOwnerPortfolioView,
  classifyAgentDetailFailure,
  classifyPortfolioFailure,
  type OwnerPortfolioFilter,
  type OwnerPortfolioAgentDetail,
  type OwnerPortfolioSort,
} from './portfolio-data.js';
import {
  getOwnerPortfolioAgentDetail,
  listOwnerPortfolioAgents,
} from './portfolio-client.js';
import { CreateRealmAgentWorkspace, type CreatedRealmAgentContext } from './CreateRealmAgentWorkspace.js';
import { MediaVoiceCandidateWorkspace } from './OwnerPortfolio.assets.js';
import { CreativePostWorkspace } from './OwnerPortfolio.posts.js';
import { AgentCard, EvidenceCard, ReadOnlySettingField, detailFriendCountLabel } from './OwnerPortfolio.shared.js';
import { RuntimeProjectionWorkspace, SettingProposalWorkspace, VisibilitySettingsWorkspace } from './OwnerPortfolio.settings.js';

const PORTFOLIO_FILTER_OPTIONS: { value: OwnerPortfolioFilter; label: string }[] = [
  { value: 'all', label: 'All agents' },
  { value: 'friend-count-available', label: 'friendCount available' },
  { value: 'friend-count-unavailable', label: 'friendCount unavailable' },
];

const PORTFOLIO_SORT_OPTIONS: { value: OwnerPortfolioSort; label: string }[] = [
  { value: 'realm-order', label: 'Realm order' },
  { value: 'display-name-asc', label: 'Name A-Z' },
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'friend-count-desc', label: 'friendCount high-low' },
  { value: 'friend-count-asc', label: 'friendCount low-high' },
];

const AGENT_WORKSPACES: StudioWorkspace[] = ['detail', 'settings', 'assets', 'posts', 'schedule'];


function PortfolioLoadingState() {
  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="ras-portfolio-state overflow-hidden">
      <div className="grid min-h-[520px] min-w-0 lg:grid-cols-[320px_1fr]">
        <div className="flex min-w-0 flex-col justify-between border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_80%,transparent)] p-6 lg:border-b-0 lg:border-r">
          <div>
            <StatusBadge tone="info">loading</StatusBadge>
            <h2 className="m-0 mt-4 text-2xl font-semibold">Opening owner portfolio</h2>
            <p className="m-0 mt-3 text-[var(--nimi-text-muted)]">
              Loading your Realm Agents, public profile settings, and creative workspace.
            </p>
          </div>
          <div className="mt-8 h-2 overflow-hidden rounded-full bg-[var(--nimi-surface-active)]">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
          </div>
        </div>
        <div className="grid min-w-0 content-start gap-4 p-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <Surface key={index} tone="panel" padding="md" className="grid min-w-0 grid-cols-[56px_1fr] gap-3">
              <div className="h-14 w-14 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]" />
              <div className="min-w-0 space-y-3">
                <div className="h-3 w-2/3 rounded-full bg-[var(--nimi-surface-active)]" />
                <div className="h-3 w-1/2 rounded-full bg-[var(--nimi-surface-active)]" />
                <div className="h-6 w-40 rounded-full bg-[var(--nimi-surface-active)]" />
              </div>
            </Surface>
          ))}
        </div>
      </div>
    </Surface>
  );
}

function PortfolioUnavailableState({
  title,
  detail,
  loading,
  onRetry,
}: {
  title: string;
  detail: string;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="ras-portfolio-state overflow-hidden">
      <div className="grid min-h-[520px] min-w-0 lg:grid-cols-[360px_1fr]">
        <div className="flex min-w-0 flex-col justify-between border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-6 lg:border-b-0 lg:border-r">
          <div>
            <StatusBadge tone="danger">Realm unavailable</StatusBadge>
            <h2 className="m-0 mt-4 text-2xl font-semibold">Portfolio cannot open</h2>
            <p className="m-0 mt-3 text-[var(--nimi-text-muted)]">
              Studio waits for your Runtime account session before it opens owner-only data.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button loading={loading} onClick={onRetry}>Retry</Button>
          </div>
        </div>
        <div className="grid min-w-0 content-start gap-4 p-6">
          <InlineAlert tone="danger">
            <strong>{title}</strong>
            <div>{detail}</div>
          </InlineAlert>
          <div className="grid gap-4 xl:grid-cols-3">
            <Surface tone="panel" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Account</div>
              <div className="mt-1 font-medium">Current owner only</div>
            </Surface>
            <Surface tone="panel" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Data source</div>
              <div className="mt-1 font-medium">Realm</div>
            </Surface>
            <Surface tone="panel" padding="md">
              <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Fallback</div>
              <div className="mt-1 font-medium">None</div>
            </Surface>
          </div>
        </div>
      </div>
    </Surface>
  );
}





function AgentProfileOverview({ agent, compact = false }: { agent: OwnerPortfolioAgentDetail; compact?: boolean }) {
  return (
    <Surface tone="panel" padding={compact ? 'md' : 'lg'} className="min-h-full">
      <div className={compact ? 'grid min-w-0 gap-4 md:grid-cols-[96px_1fr_auto]' : 'grid min-w-0 gap-5 lg:grid-cols-[1.1fr_0.9fr]'}>
        <div className={compact ? 'h-24 w-24 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]' : 'min-w-0'}>
          {compact ? (
            agent.avatarUrl ? <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" /> : null
          ) : (
            <>
              <div className="h-44 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
                {agent.profileCoverUrl.status === 'available' ? <img src={agent.profileCoverUrl.value} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="mt-5 min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <h2 className="ras-break-anywhere m-0 text-2xl font-semibold">{agent.displayName.value || 'Display name unavailable'}</h2>
                  <StatusBadge tone="info">Realm Agent</StatusBadge>
                  <StatusBadge tone="neutral">current profile</StatusBadge>
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
            </>
          )}
        </div>
        <div className={compact ? 'min-w-0 self-center' : 'grid content-start gap-3'}>
          {compact ? (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="ras-break-anywhere m-0 text-xl font-semibold">{agent.displayName.value || 'Display name unavailable'}</h2>
                <StatusBadge tone="info">Realm Agent</StatusBadge>
              </div>
              <p className="ras-break-anywhere m-0 mt-1 text-[var(--nimi-text-secondary)]">
                {agent.handle.value ? `@${agent.handle.value}` : 'handle setting read unavailable'}
              </p>
              <p className="ras-break-anywhere m-0 mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                {agent.bio.value || agent.bio.unavailableLabel || 'Public bio unavailable'}
              </p>
            </>
          ) : (
            <>
              <Surface tone="card" padding="md">
                <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Ownership</div>
                <div className="ras-break-anywhere mt-1 font-medium">User-owned Realm Agent</div>
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
            </>
          )}
        </div>
        {compact ? (
          <div className="grid content-center gap-2">
            <StatusBadge tone={agent.friendCount.status === 'available' ? 'success' : 'warning'}>
              {detailFriendCountLabel(agent)}
            </StatusBadge>
            <StatusBadge tone="neutral">{agent.world.value || 'world unavailable'}</StatusBadge>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function PostCreateDraftNotice({
  context,
  onOpenSettings,
}: {
  context: CreatedRealmAgentContext;
  onOpenSettings: () => void;
}) {
  return (
    <Surface tone="card" padding="md" className="mt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">Post-create draft preserved</div>
          <div className="ras-break-anywhere mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            @{context.handle} was created in {context.selectedWorldId}. Public bio continues through owner settings.
          </div>
        </div>
        <StatusBadge tone={context.needsPostCreateSettings ? 'warning' : 'success'}>
          {context.needsPostCreateSettings ? 'settings needed' : 'create complete'}
        </StatusBadge>
      </div>
      {context.needsPostCreateSettings ? (
        <>
          <InlineAlert tone="warning" className="mt-3">
            Public bio was intentionally not included in the Realm create request and is still available for the reviewed settings step.
          </InlineAlert>
          <div className="ras-break-anywhere mt-3 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-[length:var(--nimi-type-body-sm-size)]">
            {context.publicBio}
          </div>
          <div className="mt-3">
            <Button onClick={onOpenSettings}>Continue to settings</Button>
          </div>
        </>
      ) : null}
    </Surface>
  );
}

function AgentDetail({
  agentId,
  workspace,
  postCreateDraft,
  onOpenSettings,
}: {
  agentId: string;
  workspace: StudioWorkspace;
  postCreateDraft: CreatedRealmAgentContext | null;
  onOpenSettings: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-portfolio-agent-detail', agentId],
    queryFn: () => getOwnerPortfolioAgentDetail(agentId),
  });

  if (detailQuery.isLoading) {
    return (
      <section className="min-w-0 flex-1">
        <EmptyState title="Loading Realm Agent settings" description="Loading current agent profile and settings." />
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

  async function refreshOwnerAgentReads() {
    await Promise.all([
      detailQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['realm-agent-studio', 'owner-portfolio'] }),
    ]);
  }

  return (
    <section className="min-w-0 flex-1">
      {workspace === 'detail' ? <AgentProfileOverview agent={agent} /> : <AgentProfileOverview agent={agent} compact />}
      {postCreateDraft && postCreateDraft.agentId === agent.id ? (
        <PostCreateDraftNotice context={postCreateDraft} onOpenSettings={onOpenSettings} />
      ) : null}
      {workspace === 'settings' ? (
        <>
          <VisibilitySettingsWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} />
          <SettingProposalWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} />
          <RuntimeProjectionWorkspace agent={agent} />
        </>
      ) : null}
      {workspace === 'assets' ? <MediaVoiceCandidateWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} /> : null}
      {workspace === 'posts' ? <CreativePostWorkspace agent={agent} mode="posts" /> : null}
      {workspace === 'schedule' ? <CreativePostWorkspace agent={agent} mode="schedule" /> : null}
    </section>
  );
}

function WorkspaceHeader({
  activeWorkspace,
  onWorkspaceChange,
}: {
  activeWorkspace: StudioWorkspace;
  onWorkspaceChange: (workspace: StudioWorkspace) => void;
}) {
  const activeItem = studioWorkspaceItems.find((item) => item.id === activeWorkspace) || studioWorkspaceItems[0]!;

  return (
    <Surface tone="panel" padding="md" className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="m-0 text-xl font-semibold">{activeItem.label}</h2>
            <StatusBadge tone="info">workspace</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            {activeItem.description}
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Realm Agent Studio workspace"
          size="sm"
          value={activeWorkspace}
          onValueChange={(value) => onWorkspaceChange(value as StudioWorkspace)}
          items={studioWorkspaceItems.map((item) => ({
            value: item.id,
            label: item.label,
          }))}
          className="max-w-full overflow-x-auto"
        />
      </div>
    </Surface>
  );
}

export function OwnerPortfolio({
  activeWorkspace,
  onWorkspaceChange,
}: {
  activeWorkspace: StudioWorkspace;
  onWorkspaceChange: (workspace: StudioWorkspace) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [postCreateDraft, setPostCreateDraft] = useState<CreatedRealmAgentContext | null>(null);
  const [portfolioQueryText, setPortfolioQueryText] = useState('');
  const [portfolioFilter, setPortfolioFilter] = useState<OwnerPortfolioFilter>('all');
  const [portfolioSort, setPortfolioSort] = useState<OwnerPortfolioSort>('realm-order');
  const portfolioQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-portfolio'],
    queryFn: () => listOwnerPortfolioAgents(),
  });

  const agents = portfolioQuery.data || [];
  const visibleAgents = useMemo(() => applyOwnerPortfolioView(agents, {
    query: portfolioQueryText,
    filter: portfolioFilter,
    sort: portfolioSort,
  }), [agents, portfolioFilter, portfolioQueryText, portfolioSort]);

  const selectedAgentId = selectedId || visibleAgents[0]?.id || null;
  const selectedAgent = useMemo(() => {
    return selectedAgentId ? visibleAgents.find((agent) => agent.id === selectedAgentId) || null : null;
  }, [selectedAgentId, visibleAgents]);

  const sourceWarnings = agents.filter((agent) => agent.friendCount.status === 'source-unavailable');
  const activeWorkspaceItem = studioWorkspaceItems.find((item) => item.id === activeWorkspace) || studioWorkspaceItems[0]!;
  const agentWorkspace = AGENT_WORKSPACES.includes(activeWorkspace) ? activeWorkspace : 'detail';

  function openAgentWorkspace(agentId: string, workspace: Extract<StudioWorkspace, 'detail' | 'settings'>) {
    setSelectedId(agentId);
    onWorkspaceChange(workspace);
  }

  function handleCreatedAgent(context: CreatedRealmAgentContext) {
    setPostCreateDraft(context);
    openAgentWorkspace(context.agentId, 'detail');
  }

  if (portfolioQuery.isLoading) {
    return <PortfolioLoadingState />;
  }

  if (portfolioQuery.isError) {
    const failure = classifyPortfolioFailure(portfolioQuery.error);
    return (
      <PortfolioUnavailableState
        title={failure.title}
        detail={failure.detail}
        loading={portfolioQuery.isFetching}
        onRetry={() => void portfolioQuery.refetch()}
      />
    );
  }

  if (agents.length === 0) {
    return (
      <div className="grid min-w-0 flex-1 gap-4">
        <WorkspaceHeader activeWorkspace={activeWorkspace} onWorkspaceChange={onWorkspaceChange} />
        {activeWorkspace === 'create' ? (
          <CreateRealmAgentWorkspace
            onCreated={handleCreatedAgent}
            onOpenCreatedAgent={openAgentWorkspace}
          />
        ) : null}
        {selectedId && activeWorkspace !== 'portfolio' && activeWorkspace !== 'create' ? (
          <AgentDetail
            agentId={selectedId}
            workspace={agentWorkspace}
            postCreateDraft={postCreateDraft}
            onOpenSettings={() => openAgentWorkspace(selectedId, 'settings')}
          />
        ) : null}
        {selectedId && activeWorkspace !== 'portfolio' && activeWorkspace !== 'create' ? null : (
          <EmptyState
            title="No owner-created Realm Agents"
            description="You have not created any user-owned Realm Agents yet."
            action={activeWorkspace === 'create'
              ? <Button onClick={() => void portfolioQuery.refetch()}>Refresh portfolio</Button>
              : <Button onClick={() => onWorkspaceChange('create')}>Create Realm Agent</Button>}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 flex-1 gap-4">
      <WorkspaceHeader activeWorkspace={activeWorkspace} onWorkspaceChange={onWorkspaceChange} />
      {activeWorkspace === 'create' ? (
        <CreateRealmAgentWorkspace
          onCreated={handleCreatedAgent}
          onOpenCreatedAgent={openAgentWorkspace}
        />
      ) : null}
      <div className="grid min-h-0 min-w-0 gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold">Owner portfolio</h2>
              <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Your user-owned Realm Agents</p>
            </div>
            <Button loading={portfolioQuery.isFetching} onClick={() => void portfolioQuery.refetch()}>Refresh</Button>
          </div>
          <Surface tone="panel" padding="md" className="mb-3">
            <div className="grid gap-3">
              <FieldShell label="Search portfolio" message="Search, filter, and sort the current portfolio view.">
                <SearchField
                  value={portfolioQueryText}
                  placeholder="Search name, handle, world, or state"
                  onChange={(event) => setPortfolioQueryText(event.currentTarget.value)}
                />
              </FieldShell>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldShell label="Filter">
                  <SelectField
                    value={portfolioFilter}
                    options={PORTFOLIO_FILTER_OPTIONS}
                    onValueChange={(value) => setPortfolioFilter(value as OwnerPortfolioFilter)}
                  />
                </FieldShell>
                <FieldShell label="Sort">
                  <SelectField
                    value={portfolioSort}
                    options={PORTFOLIO_SORT_OPTIONS}
                    onValueChange={(value) => setPortfolioSort(value as OwnerPortfolioSort)}
                  />
                </FieldShell>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">{visibleAgents.length} of {agents.length} shown</StatusBadge>
                <StatusBadge tone="info">app-local view</StatusBadge>
              </div>
            </div>
          </Surface>
          {sourceWarnings.length > 0 ? (
            <InlineAlert tone="warning" className="mb-3">
              friendCount source unavailable for {sourceWarnings.length} Realm Agent{sourceWarnings.length === 1 ? '' : 's'}.
            </InlineAlert>
          ) : null}
          {visibleAgents.length === 0 ? (
            <EmptyState title="No agents match this local view" description="Adjust search, filter, or sort controls. No Realm write or queue state is created." />
          ) : (
            <div className="grid gap-3">
              {visibleAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgent?.id}
                  onSelect={() => {
                    setSelectedId(agent.id);
                    if (activeWorkspace === 'portfolio' || activeWorkspace === 'create') {
                      onWorkspaceChange('detail');
                    }
                  }}
                />
              ))}
            </div>
          )}
        </aside>
        {activeWorkspace === 'portfolio' ? (
          <Surface tone="panel" padding="lg" className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="m-0 text-xl font-semibold">Portfolio workspace</h2>
              <StatusBadge tone="info">{visibleAgents.length} visible</StatusBadge>
              <StatusBadge tone="neutral">{agents.length} total</StatusBadge>
            </div>
            <p className="m-0 mt-2 text-[var(--nimi-text-muted)]">
              Select an agent to open the detail workspace, or use the shell navigation to move to create, settings, assets, posts, or local schedule.
            </p>
            {selectedAgent ? (
              <Surface tone="card" padding="md" className="mt-4">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="ras-break-anywhere font-medium">{selectedAgent.displayName}</div>
                    <div className="ras-break-anywhere mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">@{selectedAgent.handle}</div>
                  </div>
                  <Button onClick={() => onWorkspaceChange('detail')}>Open detail</Button>
                </div>
              </Surface>
            ) : null}
          </Surface>
        ) : selectedAgentId && activeWorkspace !== 'create' ? (
          <AgentDetail
            agentId={selectedAgentId}
            workspace={agentWorkspace}
            postCreateDraft={postCreateDraft}
            onOpenSettings={() => openAgentWorkspace(selectedAgentId, 'settings')}
          />
        ) : activeWorkspace === 'create' ? (
          <Surface tone="panel" padding="lg">
            <h2 className="m-0 text-xl font-semibold">{activeWorkspaceItem.label}</h2>
            <p className="m-0 mt-2 text-[var(--nimi-text-muted)]">
              Create uses the full-width workspace above. The portfolio remains available for context and post-create refresh.
            </p>
          </Surface>
        ) : null}
      </div>
    </div>
  );
}
