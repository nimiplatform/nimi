import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, EmptyState, FieldShell, InlineAlert, SearchField, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  applyOwnerPortfolioView,
  classifyAgentDetailFailure,
  classifyPortfolioFailure,
  type OwnerPortfolioFilter,
  type OwnerPortfolioAgent,
  type OwnerPortfolioAgentDetail,
  type OwnerPortfolioSort,
  type SettingField,
} from './portfolio-data.js';
import { getOwnerPortfolioAgentDetail, listOwnerPortfolioAgents } from './portfolio-client.js';
import {
  ATTACHMENT_TARGET_TYPES,
  validateLocalPostDraft,
  type AttachmentTargetType,
  type CandidatePostPayload,
  type LocalPostDraftInput,
} from './post-draft.js';

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

type LocalCreativeAssetCandidate = {
  sequence: number;
  label: string;
  captionSnapshot: string;
  tagsSnapshot: string;
};

function createEmptyPostDraft(): LocalPostDraftInput {
  return {
    caption: '',
    tagsText: '',
    humanReviewed: false,
    attachmentEnabled: false,
    attachmentTargetType: 'RESOURCE',
    attachmentTargetId: '',
  };
}

function CreativePostWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
  const [draft, setDraft] = useState<LocalPostDraftInput>(() => createEmptyPostDraft());
  const [payloadPreview, setPayloadPreview] = useState<CandidatePostPayload | null>(null);
  const [assetCandidates, setAssetCandidates] = useState<LocalCreativeAssetCandidate[]>([]);
  const validation = validateLocalPostDraft(draft, agent);

  useEffect(() => {
    setDraft(createEmptyPostDraft());
    setPayloadPreview(null);
    setAssetCandidates([]);
  }, [agent.id]);

  function updateDraft(patch: Partial<LocalPostDraftInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPayloadPreview(null);
  }

  function addLocalAssetCandidate() {
    setAssetCandidates((current) => [
      {
        sequence: current.length + 1,
        label: `Local creative candidate ${current.length + 1}`,
        captionSnapshot: draft.caption.trim() || 'caption not drafted',
        tagsSnapshot: draft.tagsText.trim() || 'tags not drafted',
      },
      ...current,
    ]);
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Creative post candidate</h3>
            <StatusBadge tone="info">app-local draft</StatusBadge>
            <StatusBadge tone="neutral">not Realm publish</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Integrated with selected canonical detail agent: {agent.handle.value ? `@${agent.handle.value}` : agent.displayName.value || agent.id}.
          </p>

          <div className="mt-4 grid gap-4">
            <FieldShell label="Caption" message="Stored only as local candidate state in this slice.">
              <TextareaField
                value={draft.caption}
                placeholder="Draft caption for human review"
                onChange={(event) => updateDraft({ caption: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Tags" message="Comma-separated local tags; normalized in the reviewed payload preview.">
              <TextField
                value={draft.tagsText}
                placeholder="artifact, studio, release-note"
                onChange={(event) => updateDraft({ tagsText: event.currentTarget.value })}
              />
            </FieldShell>
            <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Optional attachment envelope</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Allowed target semantics: RESOURCE, ASSET, or BUNDLE.
                  </div>
                </div>
                <Checkbox
                  checked={draft.attachmentEnabled}
                  onChange={(event) => updateDraft({ attachmentEnabled: event.currentTarget.checked })}
                  label="Attach target"
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                <FieldShell label="targetType">
                  <SelectField
                    disabled={!draft.attachmentEnabled}
                    value={draft.attachmentTargetType}
                    options={ATTACHMENT_TARGET_TYPES.map((targetType) => ({ value: targetType, label: targetType }))}
                    onValueChange={(value) => updateDraft({ attachmentTargetType: value as AttachmentTargetType })}
                  />
                </FieldShell>
                <FieldShell label="targetId" message={draft.attachmentEnabled && !draft.attachmentTargetId.trim() ? 'attachment validation failed: attachment target missing' : undefined} messageTone="danger">
                  <TextField
                    disabled={!draft.attachmentEnabled}
                    value={draft.attachmentTargetId}
                    placeholder="resource, asset, or bundle target"
                    tone={draft.attachmentEnabled && !draft.attachmentTargetId.trim() ? 'danger' : 'default'}
                    onChange={(event) => updateDraft({ attachmentTargetId: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
            </Surface>
            <Checkbox
              checked={draft.humanReviewed}
              onChange={(event) => updateDraft({ humanReviewed: event.currentTarget.checked })}
              label="Human review complete"
            />
            {!validation.publishable ? (
              <InlineAlert tone="warning">
                {validation.errors.join('; ')}
              </InlineAlert>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button onClick={addLocalAssetCandidate}>Add local asset candidate</Button>
              <Button
                disabled={!validation.publishable}
                onClick={() => {
                  if (validation.publishable) {
                    setPayloadPreview(validation.payload);
                  }
                }}
              >
                Preview reviewed payload
              </Button>
            </div>
            <FieldShell label="Reviewed candidate payload" message="Preview only. This does not call Realm and does not claim publish success.">
              <pre className="ras-json-preview m-0 min-h-32 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {payloadPreview ? JSON.stringify(payloadPreview, null, 2) : 'No reviewed payload preview yet.'}
              </pre>
            </FieldShell>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="m-0 text-base font-semibold">Local preview history</h4>
            <StatusBadge tone="neutral">candidate only</StatusBadge>
          </div>
          {assetCandidates.length === 0 ? (
            <EmptyState title="No local candidates" description="Creative asset candidates created here are local preview/history only." />
          ) : (
            <div className="grid gap-3">
              {assetCandidates.map((candidate) => (
                <Surface key={candidate.sequence} tone="card" padding="md">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{candidate.label}</div>
                    <StatusBadge tone="warning">not public truth</StatusBadge>
                  </div>
                  <div className="ras-break-anywhere mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                    {candidate.captionSnapshot}
                  </div>
                  <div className="ras-break-anywhere mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    {candidate.tagsSnapshot}
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </div>
      </div>
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
      <CreativePostWorkspace agent={agent} />
    </section>
  );
}

export function OwnerPortfolio() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selectedAgent = useMemo(() => {
    return visibleAgents.find((agent) => agent.id === selectedId) || visibleAgents[0] || null;
  }, [selectedId, visibleAgents]);

  const sourceWarnings = agents.filter((agent) => agent.friendCount.status === 'source-unavailable');

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
        <Surface tone="panel" padding="md" className="mb-3">
          <div className="grid gap-3">
            <FieldShell label="Search portfolio" message="Local view control only. Realm reads remain GET /api/me/agents.">
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
              <AgentCard key={agent.id} agent={agent} active={agent.id === selectedAgent?.id} onSelect={() => setSelectedId(agent.id)} />
            ))}
          </div>
        )}
      </aside>
      {selectedAgent ? <AgentDetail agentId={selectedAgent.id} /> : null}
    </div>
  );
}
