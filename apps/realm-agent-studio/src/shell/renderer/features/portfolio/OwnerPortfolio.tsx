import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, EmptyState, FieldShell, InlineAlert, SearchField, SegmentedControl, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import { studioWorkspaceItems, type StudioWorkspace } from '../../app-shell/shell-layout.js';
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
import {
  getOwnerPortfolioAgentDetail,
  getAgentVisibilitySettings,
  getOwnerAgentSettings,
  listOwnerPortfolioAgents,
  createReviewedPostTextResource,
  listReadyPostAttachmentResources,
  projectAgentRuntimeContextSummary,
  publishReviewedPostDraft,
  selectReviewedAgentAvatarUrl,
  synthesizeReviewedVoiceDemo,
  updateReviewedOwnerAgentSettings,
  updateReviewedAgentVisibility,
  uploadReviewedPostMediaResource,
  AGENT_VISIBILITY_FIELDS,
  AGENT_VISIBILITY_VALUES,
  createAgentVisibilityDraft,
  type AgentVisibilityDraft,
  type AgentVisibilityField,
  type RealmAgentAvatarSelectResult,
  type RealmAgentVisibilityUpdateResult,
  type RealmOwnerAgentSettings,
  type RealmOwnerAgentSettingsUpdateResult,
  type RealmPostPublishResult,
  type RealmTextResourceCreateResult,
  type RuntimeVoiceDemoSynthesisResult,
  type RuntimeProjectionSummaryResult,
  type PostAttachmentResourceOption,
  type DirectMediaResourceType,
  type DirectMediaResourceUploadResult,
} from './portfolio-client.js';
import {
  ATTACHMENT_TARGET_TYPES,
  buildLocalPostScheduleCandidate,
  validateLocalPostDraft,
  type AttachmentTargetType,
  type CandidatePostPayload,
  type LocalPostScheduleCandidate,
  type LocalPostScheduleInput,
  type LocalPostDraftInput,
} from './post-draft.js';
import {
  RAW_RULE_REVIEW_DEFERRED_REASON,
  buildRealmOwnerAgentSettingsUpdateInput,
  createOwnerAgentSettingsDraft,
  type OwnerAgentSettingsDraft,
} from './setting-proposal.js';
import {
  MEDIA_CANDIDATE_BINDING_POINTS,
  MEDIA_CANDIDATE_RESOURCE_TYPES,
  VOICE_DEMO_CANDIDATE_NOTICE,
  VISUAL_MEDIA_BLOCKED_REASON,
  buildReviewedVoiceDemoCandidatePayload,
  buildBlockedVisualAssetCandidatePayload,
  type MediaCandidateBindingPoint,
  type VisualMediaCandidateInput,
  type VisualCandidateResourceType,
  type VoiceDemoCandidateInput,
} from './media-voice-candidate.js';
import { CreateRealmAgentWorkspace } from './CreateRealmAgentWorkspace.js';

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

function TechnicalReviewDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="ras-technical-details">
      <summary>{title}</summary>
      <div className="mt-3">
        {children}
      </div>
    </details>
  );
}

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
        {field.status === 'available' ? 'available' : field.unavailableLabel}
      </StatusBadge>
      <StatusBadge tone="neutral">read-only</StatusBadge>
    </div>
  );
}

function ReadOnlySettingField({ field, multiline = false }: { field: SettingField; multiline?: boolean }) {
  const message = field.status === 'available'
    ? 'Current public profile value.'
    : 'This value is not available from Realm yet.';

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

function SettingProposalWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
  const settingsQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-agent-settings', agent.id],
    queryFn: () => getOwnerAgentSettings(agent.id),
  });
  const [draft, setDraft] = useState<OwnerAgentSettingsDraft | null>(null);
  const [ownerReviewed, setOwnerReviewed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<RealmOwnerAgentSettingsUpdateResult | null>(null);
  const proposal = useMemo(() => (
    draft && settingsQuery.data
      ? buildRealmOwnerAgentSettingsUpdateInput(draft, settingsQuery.data as RealmOwnerAgentSettings)
      : null
  ), [draft, settingsQuery.data]);

  useEffect(() => {
    if (settingsQuery.data) {
      setDraft(createOwnerAgentSettingsDraft(settingsQuery.data));
      setOwnerReviewed(false);
      setResult(null);
    }
  }, [agent.id, settingsQuery.data]);

  function updateDraft(patch: Partial<OwnerAgentSettingsDraft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setOwnerReviewed(false);
    setResult(null);
  }

  function useInstructionAsRuleCandidate() {
    const instruction = draft?.naturalLanguageIntent.trim() ?? '';
    if (!instruction) {
      return;
    }
    updateDraft({ rawRuleTextCandidate: instruction });
  }

  async function saveOwnerSettings() {
    if (!draft || !settingsQuery.data) {
      return;
    }
    setIsSaving(true);
    setResult(null);
    try {
      const updateResult = await updateReviewedOwnerAgentSettings(agent.id, draft, settingsQuery.data);
      setResult(updateResult);
      if (updateResult.ok) {
        await settingsQuery.refetch();
        await onAgentWrite();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Owner settings</h3>
            <StatusBadge tone="success">Realm save</StatusBadge>
            <StatusBadge tone="neutral">owner-reviewed</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Edit the agent's public identity, behavior notes, and communication style. Changes are reviewed before save.
          </p>

          {settingsQuery.isLoading ? (
            <EmptyState title="Loading owner settings" description="Loading editable settings for this Realm Agent." />
          ) : null}
          {settingsQuery.isError ? (
            <InlineAlert tone="danger">
              Owner settings unavailable: {settingsQuery.error instanceof Error ? settingsQuery.error.message : 'Realm owner settings read failed.'}
            </InlineAlert>
          ) : null}
          {draft && settingsQuery.data ? (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Display name" message="Shown on the agent profile.">
                  <TextField
                    value={draft.displayName}
                    placeholder="Public display name"
                    onChange={(event) => updateDraft({ displayName: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Greeting" message="The agent's opening line for public presentation.">
                  <TextField
                    value={draft.greeting}
                    placeholder="Opening greeting"
                    onChange={(event) => updateDraft({ greeting: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Description" message="Public description for the agent profile.">
                <TextareaField
                  value={draft.description}
                  placeholder="Public description"
                  onChange={(event) => updateDraft({ description: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Public role" message="How the agent should be understood by visitors.">
                  <TextField
                    value={draft.publicRole}
                    placeholder="Guide, mentor, companion..."
                    onChange={(event) => updateDraft({ publicRole: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Relationship mode" message="The agent's preferred interaction posture.">
                  <TextField
                    value={draft.relationshipMode}
                    placeholder="coach, friend, narrator..."
                    onChange={(event) => updateDraft({ relationshipMode: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Worldview" message="The background, beliefs, and setting assumptions the agent should preserve.">
                <TextareaField
                  value={draft.worldview}
                  placeholder="Public worldview and background"
                  onChange={(event) => updateDraft({ worldview: event.currentTarget.value })}
                />
              </FieldShell>
              <FieldShell label="Personality summary" message="Saved as personality.summary.">
                <TextareaField
                  value={draft.personalitySummary}
                  placeholder="Owner-reviewed personality summary"
                  onChange={(event) => updateDraft({ personalitySummary: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Interests" message="Comma or newline separated; saved as personality.interests.">
                  <TextareaField
                    value={draft.interestsText}
                    placeholder="strategy, tea, ruins"
                    onChange={(event) => updateDraft({ interestsText: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Goals" message="Comma or newline separated; saved as personality.goals.">
                  <TextareaField
                    value={draft.goalsText}
                    placeholder="help users plan, keep lore coherent"
                    onChange={(event) => updateDraft({ goalsText: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Content style" message="Saved as communication.contentStyle; no provider or model routing is included.">
                <TextareaField
                  value={draft.contentStyle}
                  placeholder="Concise, pragmatic, warm..."
                  onChange={(event) => updateDraft({ contentStyle: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="grid gap-4 md:grid-cols-3">
                <FieldShell label="Formality">
                  <SelectField
                    value={draft.formality}
                    options={[
                      { value: '', label: 'Unset' },
                      { value: 'casual', label: 'Casual' },
                      { value: 'formal', label: 'Formal' },
                      { value: 'slang', label: 'Slang' },
                    ]}
                    onValueChange={(value) => updateDraft({ formality: value })}
                  />
                </FieldShell>
                <FieldShell label="Response length">
                  <SelectField
                    value={draft.responseLength}
                    options={[
                      { value: '', label: 'Unset' },
                      { value: 'short', label: 'Short' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'long', label: 'Long' },
                    ]}
                    onValueChange={(value) => updateDraft({ responseLength: value })}
                  />
                </FieldShell>
                <FieldShell label="Sentiment">
                  <SelectField
                    value={draft.sentiment}
                    options={[
                      { value: '', label: 'Unset' },
                      { value: 'positive', label: 'Positive' },
                      { value: 'neutral', label: 'Neutral' },
                      { value: 'cynical', label: 'Cynical' },
                    ]}
                    onValueChange={(value) => updateDraft({ sentiment: value })}
                  />
                </FieldShell>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Allowed themes" message="Comma or newline separated; saved as boundaries.allowedThemes.">
                  <TextareaField
                    value={draft.allowedThemesText}
                    placeholder="adventure, friendship"
                    onChange={(event) => updateDraft({ allowedThemesText: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Disallowed themes" message="Comma or newline separated; saved as boundaries.disallowedThemes.">
                  <TextareaField
                    value={draft.disallowedThemesText}
                    placeholder="gore, harassment"
                    onChange={(event) => updateDraft({ disallowedThemesText: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Target audience" message="Saved as positioning.targetAudience.">
                  <TextareaField
                    value={draft.targetAudience}
                    placeholder="Who this agent is for"
                    onChange={(event) => updateDraft({ targetAudience: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Positioning" message="How this agent should be presented and differentiated.">
                  <TextareaField
                    value={draft.positioning}
                    placeholder="How this agent should be positioned"
                    onChange={(event) => updateDraft({ positioning: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Natural-language intent" message="Describe the update in your own words before review.">
                <TextareaField
                  value={draft.naturalLanguageIntent}
                  placeholder="Describe the owner-reviewed setting intent"
                  onChange={(event) => updateDraft({ naturalLanguageIntent: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="flex flex-wrap gap-3">
                <Button disabled={!draft.naturalLanguageIntent.trim()} onClick={useInstructionAsRuleCandidate}>
                  Use as rule review note
                </Button>
              </div>
              <FieldShell label="Rule review note" message="Visible note for future advanced review. It is not saved with this settings update.">
                <TextareaField
                  value={draft.rawRuleTextCandidate}
                  placeholder="Advanced note for future rule-content review"
                  onChange={(event) => updateDraft({ rawRuleTextCandidate: event.currentTarget.value })}
                />
              </FieldShell>
              <FieldShell label="Profile cover URL" message="Current cover projection. Editing will be enabled once this profile asset path is admitted.">
                <TextField readOnly value={agent.profileCoverUrl.value} placeholder="profileCoverUrl read unavailable" />
              </FieldShell>
              {proposal?.ok ? (
                <InlineAlert tone="info">
                  {proposal.changedSettingKeys.join(', ')} ready for owner-reviewed settings save.
                </InlineAlert>
              ) : (
                <InlineAlert tone="warning">
                  {proposal?.errors.join('; ') || 'Owner settings payload unavailable.'}
                </InlineAlert>
              )}
              {draft.rawRuleTextCandidate.trim() ? (
                <InlineAlert tone="warning">
                  {RAW_RULE_REVIEW_DEFERRED_REASON}
                </InlineAlert>
              ) : null}
              {result ? (
                <InlineAlert tone={result.ok ? 'success' : 'danger'}>
                  {result.ok
                    ? 'Settings saved. The agent profile has been refreshed.'
                    : result.message}
                </InlineAlert>
              ) : null}
              <Checkbox
                checked={ownerReviewed}
                onChange={(event) => setOwnerReviewed(event.currentTarget.checked)}
                label="Human review complete"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={!proposal?.ok || !ownerReviewed || isSaving}
                  loading={isSaving}
                  onClick={() => void saveOwnerSettings()}
                >
                  Save owner settings
                </Button>
                <Button
                  tone="secondary"
                  disabled={isSaving}
                  onClick={() => {
                    setDraft(createOwnerAgentSettingsDraft(settingsQuery.data as RealmOwnerAgentSettings));
                    setOwnerReviewed(false);
                    setResult(null);
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="m-0 text-base font-semibold">Review summary</h4>
            <StatusBadge tone={proposal?.ok ? 'success' : 'warning'}>{proposal?.ok ? 'ready' : 'not ready'}</StatusBadge>
          </div>
          <TechnicalReviewDetails title="Settings technical review">
            <pre className="ras-json-preview m-0 min-h-80 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
              {proposal?.ok ? JSON.stringify(proposal.preview, null, 2) : proposal?.errors.join('; ') || 'No owner settings loaded.'}
            </pre>
          </TechnicalReviewDetails>
          {result ? (
            <TechnicalReviewDetails title="Settings save response">
              <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </TechnicalReviewDetails>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}

const VISIBILITY_FIELD_LABELS: Record<AgentVisibilityField, string> = {
  accountVisibility: 'Account discoverability',
  defaultPostVisibility: 'Default post visibility',
  dmVisibility: 'Direct message visibility',
  profileVisibility: 'Profile visibility',
};

function VisibilitySettingsWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
  const visibilityQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-agent-visibility', agent.id],
    queryFn: () => getAgentVisibilitySettings(agent.id),
  });
  const [draft, setDraft] = useState<AgentVisibilityDraft | null>(null);
  const [humanReviewed, setHumanReviewed] = useState(false);
  const [result, setResult] = useState<RealmAgentVisibilityUpdateResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visibilityQuery.data) {
      setDraft(createAgentVisibilityDraft(visibilityQuery.data));
      setHumanReviewed(false);
      setResult(null);
      setIsSaving(false);
    }
  }, [agent.id, visibilityQuery.data]);

  const hasChanges = useMemo(() => {
    if (!draft || !visibilityQuery.data) {
      return false;
    }
    return AGENT_VISIBILITY_FIELDS.some((field) => draft[field] !== visibilityQuery.data?.[field]);
  }, [draft, visibilityQuery.data]);

  function updateDraft(field: AgentVisibilityField, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
    setHumanReviewed(false);
    setResult(null);
  }

  async function saveVisibility() {
    if (!draft || !visibilityQuery.data) {
      return;
    }

    setIsSaving(true);
    setResult(null);
    try {
      const updateResult = await updateReviewedAgentVisibility(agent.id, draft, visibilityQuery.data);
      setResult(updateResult);
      if (updateResult.ok) {
        await visibilityQuery.refetch();
        await onAgentWrite();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h3 className="m-0 text-xl font-semibold">Visibility settings</h3>
        <StatusBadge tone="info">Realm save</StatusBadge>
        <StatusBadge tone="neutral">not lifecycle</StatusBadge>
      </div>
      <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
        Control how this agent appears socially. Visibility changes do not create lifecycle, moderation, or scheduling state.
      </p>

      {visibilityQuery.isLoading ? (
        <EmptyState title="Loading visibility settings" description="Loading current profile and interaction visibility." />
      ) : null}
      {visibilityQuery.isError ? (
        <InlineAlert tone="danger">
          Visibility settings unavailable: {visibilityQuery.error instanceof Error ? visibilityQuery.error.message : 'Realm visibility read failed.'}
        </InlineAlert>
      ) : null}
      {draft && visibilityQuery.data ? (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            {AGENT_VISIBILITY_FIELDS.map((field) => (
              <FieldShell key={field} label={VISIBILITY_FIELD_LABELS[field]} message="Allowed values: PUBLIC, FRIENDS, PRIVATE.">
                <SelectField
                  value={draft[field]}
                  options={AGENT_VISIBILITY_VALUES.map((value) => ({ value, label: value }))}
                  onValueChange={(value) => updateDraft(field, value)}
                />
              </FieldShell>
            ))}
          </div>
          <Checkbox
            checked={humanReviewed}
            onChange={(event) => setHumanReviewed(event.currentTarget.checked)}
            label="Human review complete"
          />
          {!hasChanges ? (
            <InlineAlert tone="warning">
              Visibility settings have no reviewed changes.
            </InlineAlert>
          ) : null}
          {result ? (
            <InlineAlert tone={result.ok ? 'success' : 'danger'}>
              {result.ok
                ? 'Visibility settings saved.'
                : result.message}
            </InlineAlert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={!hasChanges || !humanReviewed || isSaving}
              loading={isSaving}
              onClick={() => void saveVisibility()}
            >
              Save visibility
            </Button>
            <Button
              disabled={!visibilityQuery.data || isSaving}
              onClick={() => {
                if (visibilityQuery.data) {
                  setDraft(createAgentVisibilityDraft(visibilityQuery.data));
                  setHumanReviewed(false);
                  setResult(null);
                }
              }}
            >
              Reset draft
            </Button>
          </div>
          <TechnicalReviewDetails title="Visibility technical review">
            <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
              {result ? JSON.stringify(result, null, 2) : JSON.stringify({ current: visibilityQuery.data, draft }, null, 2)}
            </pre>
          </TechnicalReviewDetails>
        </div>
      ) : null}
    </Surface>
  );
}

function createVisualMediaCandidateInput(): VisualMediaCandidateInput {
  return {
    resourceType: 'IMAGE',
    bindingPoint: 'AGENT_CANDIDATE',
    prompt: '',
    notes: '',
  };
}

function createVoiceDemoCandidateInput(agent: OwnerPortfolioAgentDetail): VoiceDemoCandidateInput {
  return {
    scriptText: agent.greeting.value || '',
    model: import.meta.env.VITE_RUNTIME_TTS_MODEL || '',
  };
}

function MediaVoiceCandidateWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
  const [visualDraft, setVisualDraft] = useState<VisualMediaCandidateInput>(() => createVisualMediaCandidateInput());
  const [avatarUrlDraft, setAvatarUrlDraft] = useState(() => agent.avatarUrl || '');
  const [avatarReviewed, setAvatarReviewed] = useState(false);
  const [avatarResult, setAvatarResult] = useState<RealmAgentAvatarSelectResult | null>(null);
  const [isSelectingAvatar, setIsSelectingAvatar] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDemoCandidateInput>(() => createVoiceDemoCandidateInput(agent));
  const [voiceResult, setVoiceResult] = useState<RuntimeVoiceDemoSynthesisResult | null>(null);
  const [isSynthesizingVoice, setIsSynthesizingVoice] = useState(false);
  const visualPayload = useMemo(() => buildBlockedVisualAssetCandidatePayload(visualDraft, agent), [agent, visualDraft]);
  const voicePayload = useMemo(() => buildReviewedVoiceDemoCandidatePayload(voiceDraft, agent), [agent, voiceDraft]);
  const avatarUrlChanged = avatarUrlDraft.trim() !== (agent.avatarUrl || '');
  const visualResourceTypes = MEDIA_CANDIDATE_RESOURCE_TYPES.filter((resourceType): resourceType is VisualCandidateResourceType => resourceType === 'IMAGE');
  const visualBindingPoints = MEDIA_CANDIDATE_BINDING_POINTS.filter((bindingPoint) => bindingPoint !== 'AGENT_VOICE_SAMPLE');

  useEffect(() => {
    setVisualDraft(createVisualMediaCandidateInput());
    setAvatarUrlDraft(agent.avatarUrl || '');
    setAvatarReviewed(false);
    setAvatarResult(null);
    setIsSelectingAvatar(false);
    setVoiceDraft(createVoiceDemoCandidateInput(agent));
    setVoiceResult(null);
    setIsSynthesizingVoice(false);
  }, [agent.id]);

  function updateVisualDraft(patch: Partial<VisualMediaCandidateInput>) {
    setVisualDraft((current) => ({ ...current, ...patch }));
  }

  function updateAvatarUrlDraft(value: string) {
    setAvatarUrlDraft(value);
    setAvatarReviewed(false);
    setAvatarResult(null);
  }

  function updateVoiceDraft(patch: Partial<VoiceDemoCandidateInput>) {
    setVoiceDraft((current) => ({ ...current, ...patch }));
    setVoiceResult(null);
  }

  async function selectAvatarUrl() {
    setIsSelectingAvatar(true);
    setAvatarResult(null);
    try {
      const result = await selectReviewedAgentAvatarUrl(agent.id, avatarUrlDraft);
      setAvatarResult(result);
      if (result.ok) {
        await onAgentWrite();
      }
    } finally {
      setIsSelectingAvatar(false);
    }
  }

  async function synthesizeVoiceDemo() {
    setIsSynthesizingVoice(true);
    setVoiceResult(null);
    try {
      const result = await synthesizeReviewedVoiceDemo(voiceDraft, agent);
      setVoiceResult(result);
    } finally {
      setIsSynthesizingVoice(false);
    }
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Visual identity candidate</h3>
            <StatusBadge tone="warning">local preview</StatusBadge>
            <StatusBadge tone="neutral">not published</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Update the public avatar URL now. Generated and uploaded identity assets remain local previews until the owner asset publishing path is admitted.
          </p>
          <div className="mt-4 grid gap-4">
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Avatar URL selection</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Saves the reviewed avatar URL on the public profile. It does not publish generated asset candidates.
                  </div>
                </div>
                <StatusBadge tone="info">Realm save</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[80px_1fr]">
                <div className="h-20 w-20 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
                  {avatarUrlDraft.trim() ? <img src={avatarUrlDraft.trim()} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="grid gap-3">
                  <FieldShell label="Avatar URL" message="Owner-reviewed http(s) URL only.">
                    <TextField
                      value={avatarUrlDraft}
                      placeholder="https://..."
                      onChange={(event) => updateAvatarUrlDraft(event.currentTarget.value)}
                    />
                  </FieldShell>
                  <Checkbox
                    checked={avatarReviewed}
                    onChange={(event) => setAvatarReviewed(event.currentTarget.checked)}
                    label="Human review complete"
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      disabled={!avatarUrlChanged || !avatarReviewed || isSelectingAvatar}
                      loading={isSelectingAvatar}
                      onClick={() => void selectAvatarUrl()}
                    >
                      Select avatar URL
                    </Button>
                  </div>
                </div>
              </div>
              {avatarResult ? (
                <InlineAlert tone={avatarResult.ok ? 'success' : 'danger'} className="mt-3">
                  {avatarResult.ok
                    ? 'Avatar URL saved. The profile has been refreshed.'
                    : avatarResult.message}
                </InlineAlert>
              ) : null}
              {avatarResult ? (
                <TechnicalReviewDetails title="Avatar save response">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(avatarResult, null, 2)}
                  </pre>
                </TechnicalReviewDetails>
              ) : null}
            </Surface>
            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
              <FieldShell label="Asset type" message="Local preview category.">
                <SelectField
                  value={visualDraft.resourceType}
                  options={visualResourceTypes.map((resourceType) => ({ value: resourceType, label: resourceType }))}
                  onValueChange={(value) => updateVisualDraft({ resourceType: value as VisualCandidateResourceType })}
                />
              </FieldShell>
              <FieldShell label="Profile slot" message="Where this candidate would be used after review.">
                <SelectField
                  value={visualDraft.bindingPoint}
                  options={visualBindingPoints.map((bindingPoint) => ({ value: bindingPoint, label: bindingPoint }))}
                  onValueChange={(value) => updateVisualDraft({ bindingPoint: value as MediaCandidateBindingPoint })}
                />
              </FieldShell>
            </div>
            <FieldShell label="Visual prompt" message="Describe the avatar, portrait, or visual direction.">
              <TextareaField
                value={visualDraft.prompt}
                placeholder="Describe the avatar, portrait, or candidate visual"
                onChange={(event) => updateVisualDraft({ prompt: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Notes" message="Composition, references, and review notes.">
              <TextareaField
                value={visualDraft.notes}
                placeholder="Composition, reference, or review notes"
                onChange={(event) => updateVisualDraft({ notes: event.currentTarget.value })}
              />
            </FieldShell>
            <InlineAlert tone="warning">
              {visualPayload.changed ? VISUAL_MEDIA_BLOCKED_REASON : visualPayload.errors.join('; ')}
            </InlineAlert>
            <TechnicalReviewDetails title="Visual candidate technical details">
              <pre className="ras-json-preview m-0 min-h-72 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {visualPayload.payload ? JSON.stringify(visualPayload.payload, null, 2) : visualPayload.errors.join('; ')}
              </pre>
            </TechnicalReviewDetails>
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Public asset publishing is not enabled yet</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Generated portraits and voice samples stay in local preview until Realm exposes a reviewed owner publishing path.
                  </div>
                </div>
                <StatusBadge tone="warning">local only</StatusBadge>
              </div>
              <InlineAlert tone="warning" className="mt-3">
                You can review candidates here, but this workflow will not publish them as profile assets yet.
              </InlineAlert>
            </Surface>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Voice demo candidate</h3>
            <StatusBadge tone="info">AI assisted</StatusBadge>
            <StatusBadge tone="neutral">sample only</StatusBadge>
            <StatusBadge tone="warning">not published</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Generate a voice sample for review. Publishing the sample as a public profile asset is deferred until the owner asset path is available.
          </p>
          <div className="mt-4 grid gap-4">
            <Surface tone="card" padding="md">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Sample type</div>
                  <div className="mt-1 font-medium">Audio</div>
                </div>
                <div>
                  <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Review state</div>
                  <div className="mt-1 font-medium">Local sample</div>
                </div>
              </div>
            </Surface>
            <FieldShell label="Demo script" message="Short text the agent will speak for the sample.">
              <TextareaField
                value={voiceDraft.scriptText}
                placeholder="Short public voice demo script"
                onChange={(event) => updateVoiceDraft({ scriptText: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Voice model" message="Use the Runtime voice model configured for this environment.">
              <TextField
                value={voiceDraft.model}
                placeholder="Configured Runtime TTS model"
                onChange={(event) => updateVoiceDraft({ model: event.currentTarget.value })}
              />
            </FieldShell>
            <InlineAlert tone={voicePayload.changed ? 'info' : 'warning'}>
              {voicePayload.changed ? VOICE_DEMO_CANDIDATE_NOTICE : voicePayload.errors.join('; ')}
            </InlineAlert>
            <div className="flex flex-wrap gap-3">
              <Button disabled={!voicePayload.changed || isSynthesizingVoice} loading={isSynthesizingVoice} onClick={() => void synthesizeVoiceDemo()}>
                Synthesize voice demo
              </Button>
            </div>
            {voiceResult ? (
              <InlineAlert tone={voiceResult.ok ? 'info' : 'danger'}>
                  {voiceResult.ok
                  ? 'Voice sample generated for local review. It has not been published to the profile.'
                  : voiceResult.message}
              </InlineAlert>
            ) : null}
            {voiceResult?.ok ? (
              <Surface tone="card" padding="md">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Generation job</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.jobId || 'job id unavailable'}</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Generated files</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.artifactIds.join(', ') || 'artifact id unavailable'}</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Status</div>
                    <div className="mt-1 font-medium">Generated locally</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Trace</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.traceId || 'trace unavailable'}</div>
                  </div>
                </div>
              </Surface>
            ) : null}
            <TechnicalReviewDetails title="Voice request technical details">
              <pre className="ras-json-preview m-0 min-h-72 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {voicePayload.payload ? JSON.stringify(voicePayload.payload, null, 2) : voicePayload.errors.join('; ')}
              </pre>
            </TechnicalReviewDetails>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function RuntimeProjectionWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
  const [projectionResult, setProjectionResult] = useState<RuntimeProjectionSummaryResult | null>(null);
  const [isProjecting, setIsProjecting] = useState(false);

  useEffect(() => {
    setProjectionResult(null);
    setIsProjecting(false);
  }, [agent.id]);

  async function projectRuntimeContext() {
    setIsProjecting(true);
    setProjectionResult(null);
    try {
      const result = await projectAgentRuntimeContextSummary(agent);
      setProjectionResult(result);
    } finally {
      setIsProjecting(false);
    }
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h3 className="m-0 text-xl font-semibold">World context summary</h3>
        <StatusBadge tone="info">AI context</StatusBadge>
        <StatusBadge tone="neutral">summary only</StatusBadge>
        <StatusBadge tone="warning">read only</StatusBadge>
      </div>
      <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
        Preview the world context available to AI-assisted workflows without exposing or editing raw rules.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button disabled={isProjecting || agent.world.status !== 'available'} loading={isProjecting} onClick={() => void projectRuntimeContext()}>
          Generate world context summary
        </Button>
      </div>
      {agent.world.status !== 'available' ? (
        <InlineAlert tone="warning">
          World context is unavailable because this agent does not have a resolved world.
        </InlineAlert>
      ) : null}
      {projectionResult ? (
        <InlineAlert tone={projectionResult.ok ? 'success' : 'danger'} className="mt-3">
          {projectionResult.ok
            ? 'World context summary generated. No agent settings were changed.'
            : projectionResult.message}
        </InlineAlert>
      ) : null}
      {projectionResult?.ok ? (
        <dl className="mt-4 grid gap-3 text-[length:var(--nimi-type-body-sm-size)] md:grid-cols-2">
          {Object.entries(projectionResult.summary).map(([key, value]) => (
            <div key={key} className="min-w-0 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
              <dt className="font-medium text-[var(--nimi-text-muted)]">{key}</dt>
              <dd className="ras-break-anywhere m-0 mt-1 text-[var(--nimi-text-primary)]">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {projectionResult ? (
        <TechnicalReviewDetails title="World context request details">
          <pre className="ras-json-preview m-0 mt-3 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
            {JSON.stringify(projectionResult.submitted, null, 2)}
          </pre>
        </TechnicalReviewDetails>
      ) : null}
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

function createEmptyLocalPostScheduleInput(): LocalPostScheduleInput {
  return {
    localDate: '',
    localTime: '',
  };
}

function CreativePostWorkspace({ agent, mode }: { agent: OwnerPortfolioAgentDetail; mode: 'posts' | 'schedule' }) {
  const [draft, setDraft] = useState<LocalPostDraftInput>(() => createEmptyPostDraft());
  const [payloadPreview, setPayloadPreview] = useState<CandidatePostPayload | null>(null);
  const [publishResult, setPublishResult] = useState<RealmPostPublishResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [textResourceResult, setTextResourceResult] = useState<RealmTextResourceCreateResult | null>(null);
  const [isCreatingTextResource, setIsCreatingTextResource] = useState(false);
  const [resourceOptions, setResourceOptions] = useState<PostAttachmentResourceOption[]>([]);
  const [resourceListStatus, setResourceListStatus] = useState<{ tone: 'info' | 'success' | 'warning' | 'danger'; message: string } | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [mediaResourceType, setMediaResourceType] = useState<DirectMediaResourceType>('IMAGE');
  const [mediaUploadFile, setMediaUploadFile] = useState<File | null>(null);
  const [mediaUploadResult, setMediaUploadResult] = useState<DirectMediaResourceUploadResult | null>(null);
  const [isUploadingMediaResource, setIsUploadingMediaResource] = useState(false);
  const [scheduleInput, setScheduleInput] = useState<LocalPostScheduleInput>(() => createEmptyLocalPostScheduleInput());
  const [schedulePreview, setSchedulePreview] = useState<LocalPostScheduleCandidate | null>(null);
  const [scheduleErrors, setScheduleErrors] = useState<string[]>([]);
  const [assetCandidates, setAssetCandidates] = useState<LocalCreativeAssetCandidate[]>([]);
  const validation = validateLocalPostDraft(draft, agent);
  const postTextResourceDraft = validateLocalPostDraft({ ...draft, attachmentEnabled: false, attachmentTargetId: '' }, agent);
  const isScheduleWorkspace = mode === 'schedule';

  useEffect(() => {
    setDraft(createEmptyPostDraft());
    setPayloadPreview(null);
    setPublishResult(null);
    setIsPublishing(false);
    setTextResourceResult(null);
    setIsCreatingTextResource(false);
    setResourceOptions([]);
    setResourceListStatus(null);
    setIsLoadingResources(false);
    setMediaResourceType('IMAGE');
    setMediaUploadFile(null);
    setMediaUploadResult(null);
    setIsUploadingMediaResource(false);
    setScheduleInput(createEmptyLocalPostScheduleInput());
    setSchedulePreview(null);
    setScheduleErrors([]);
    setAssetCandidates([]);
  }, [agent.id]);

  function updateDraft(patch: Partial<LocalPostDraftInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPayloadPreview(null);
    setPublishResult(null);
    setTextResourceResult(null);
    setResourceListStatus(null);
    setMediaUploadResult(null);
    setSchedulePreview(null);
    setScheduleErrors([]);
  }

  function updateScheduleInput(patch: Partial<LocalPostScheduleInput>) {
    setScheduleInput((current) => ({ ...current, ...patch }));
    setSchedulePreview(null);
    setScheduleErrors([]);
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

  async function createTextResourceAttachment() {
    if (!postTextResourceDraft.publishable) {
      setTextResourceResult({
        ok: false,
        source: 'Realm ResourcesService.createTextResource',
        attachmentTruth: false,
        failure: 'post-text-resource-payload-invalid',
        message: postTextResourceDraft.errors.join('; ') || 'Reviewed post text resource requires caption content.',
        submitted: null,
      });
      return;
    }

    setPayloadPreview(postTextResourceDraft.payload);
    setTextResourceResult(null);
    setIsCreatingTextResource(true);
    try {
      const result = await createReviewedPostTextResource(postTextResourceDraft.payload);
      setTextResourceResult(result);
      if (result.ok) {
        setDraft((current) => ({
          ...current,
          attachmentEnabled: true,
          attachmentTargetType: 'RESOURCE',
          attachmentTargetId: result.canonical.id,
        }));
        setPayloadPreview(null);
        setPublishResult(null);
        setSchedulePreview(null);
        setScheduleErrors([]);
      }
    } finally {
      setIsCreatingTextResource(false);
    }
  }

  async function loadReadyResources() {
    setIsLoadingResources(true);
    setResourceListStatus(null);
    try {
      const resources = await listReadyPostAttachmentResources();
      setResourceOptions(resources);
      setResourceListStatus(resources.length > 0
        ? { tone: 'success', message: `Loaded ${resources.length} ready media attachment option${resources.length === 1 ? '' : 's'}.` }
        : { tone: 'warning', message: 'No ready media attachment options were returned.' });
    } catch (error) {
      setResourceOptions([]);
      setResourceListStatus({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Ready media list failed.',
      });
    } finally {
      setIsLoadingResources(false);
    }
  }

  function selectReadyResource(resourceId: string) {
    const resource = resourceOptions.find((option) => option.id === resourceId);
    if (!resource) {
      return;
    }
    updateDraft({
      attachmentEnabled: true,
      attachmentTargetType: 'RESOURCE',
      attachmentTargetId: resource.id,
    });
    setResourceListStatus({
      tone: 'info',
      message: `Selected ${resource.resourceType.toLowerCase()} media ${resource.id}.`,
    });
  }

  async function uploadMediaResourceAttachment() {
    if (!mediaUploadFile) {
      setMediaUploadResult({
        ok: false,
        source: 'Realm ResourcesService direct upload + finalizeResource',
        attachmentTruth: false,
        publicTruth: false,
        failure: 'media-upload-file-invalid',
        message: 'Reviewed media upload requires a selected file.',
        submitted: null,
      });
      return;
    }
    setMediaUploadResult(null);
    setIsUploadingMediaResource(true);
    try {
      const result = await uploadReviewedPostMediaResource({
        resourceType: mediaResourceType,
        file: mediaUploadFile,
        agent,
      });
      setMediaUploadResult(result);
      if (result.ok) {
        setDraft((current) => ({
          ...current,
          attachmentEnabled: true,
          attachmentTargetType: 'RESOURCE',
          attachmentTargetId: result.canonical.id,
        }));
        setPayloadPreview(null);
        setPublishResult(null);
        setSchedulePreview(null);
        setScheduleErrors([]);
      }
    } finally {
      setIsUploadingMediaResource(false);
    }
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">{isScheduleWorkspace ? 'Local schedule candidate' : 'Creative post candidate'}</h3>
            <StatusBadge tone={isScheduleWorkspace ? 'warning' : 'info'}>{isScheduleWorkspace ? 'local schedule' : 'local draft'}</StatusBadge>
            <StatusBadge tone={validation.publishable ? 'success' : 'neutral'}>
              {validation.publishable ? 'ready to publish' : 'not ready'}
            </StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            {isScheduleWorkspace
              ? 'Prepare one reviewed local scheduled publish candidate. This workspace does not create recurring queue state.'
              : `Integrated with selected canonical detail agent: ${agent.handle.value ? `@${agent.handle.value}` : agent.displayName.value || agent.id}.`}
          </p>

          <div className="mt-4 grid gap-4">
            <FieldShell label="Caption" message="Post text written from the agent's voice.">
              <TextareaField
                value={draft.caption}
                placeholder="Draft caption for human review"
                onChange={(event) => updateDraft({ caption: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Tags" message="Comma-separated tags for the post.">
              <TextField
                value={draft.tagsText}
                placeholder="artifact, studio, release-note"
                onChange={(event) => updateDraft({ tagsText: event.currentTarget.value })}
              />
            </FieldShell>
            {!isScheduleWorkspace ? <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Optional media attachment</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Attach an existing ready resource or upload reviewed media for this post.
                  </div>
                </div>
                <Checkbox
                  checked={draft.attachmentEnabled}
                  onChange={(event) => updateDraft({ attachmentEnabled: event.currentTarget.checked })}
                  label="Attach target"
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                <FieldShell label="Attachment type">
                  <SelectField
                    disabled={!draft.attachmentEnabled}
                    value={draft.attachmentTargetType}
                    options={ATTACHMENT_TARGET_TYPES.map((targetType) => ({ value: targetType, label: targetType }))}
                    onValueChange={(value) => updateDraft({ attachmentTargetType: value as AttachmentTargetType })}
                  />
                </FieldShell>
                <FieldShell label="Attachment id" message={draft.attachmentEnabled && !draft.attachmentTargetId.trim() ? 'Select or enter an attachment id.' : undefined} messageTone="danger">
                  <TextField
                    disabled={!draft.attachmentEnabled}
                    value={draft.attachmentTargetId}
                    placeholder="Attachment id"
                    tone={draft.attachmentEnabled && !draft.attachmentTargetId.trim() ? 'danger' : 'default'}
                    onChange={(event) => updateDraft({ attachmentTargetId: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
                <div className="flex items-end">
                  <Button disabled={isLoadingResources} loading={isLoadingResources} onClick={() => void loadReadyResources()}>
                    Load ready media
                  </Button>
                </div>
                <FieldShell label="Ready media picker" message="Choose an existing ready media item for this post.">
                  <SelectField
                    disabled={resourceOptions.length === 0}
                    value={draft.attachmentTargetType === 'RESOURCE' ? draft.attachmentTargetId : ''}
                    options={[
                      { value: '', label: resourceOptions.length === 0 ? 'No ready media loaded' : 'Select ready media' },
                      ...resourceOptions.map((resource) => ({
                        value: resource.id,
                        label: `${resource.resourceType} · ${resource.label}`,
                      })),
                    ]}
                    onValueChange={selectReadyResource}
                  />
                </FieldShell>
              </div>
              {resourceListStatus ? (
                <InlineAlert tone={resourceListStatus.tone}>
                  {resourceListStatus.message}
                </InlineAlert>
              ) : null}
            </Surface> : null}
            {!isScheduleWorkspace ? <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Upload media</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Upload reviewed image, video, or audio and attach it to this post.
                  </div>
                </div>
                <StatusBadge tone="info">upload</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                <FieldShell label="Media type">
                  <SelectField
                    value={mediaResourceType}
                    options={[
                      { value: 'IMAGE', label: 'Image' },
                      { value: 'VIDEO', label: 'Video' },
                      { value: 'AUDIO', label: 'Audio' },
                    ]}
                    onValueChange={(value) => {
                      setMediaResourceType(value as DirectMediaResourceType);
                      setMediaUploadFile(null);
                      setMediaUploadResult(null);
                    }}
                  />
                </FieldShell>
                <FieldShell label="File" message={draft.humanReviewed ? 'Owner-reviewed media only.' : 'Human review complete is required before upload.'} messageTone={draft.humanReviewed ? 'neutral' : 'danger'}>
                  <TextField
                    type="file"
                    accept={mediaResourceType === 'IMAGE' ? 'image/*' : mediaResourceType === 'VIDEO' ? 'video/*' : 'audio/*'}
                    onChange={(event) => {
                      setMediaUploadFile(event.currentTarget.files?.[0] ?? null);
                      setMediaUploadResult(null);
                    }}
                  />
                </FieldShell>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={!draft.humanReviewed || !mediaUploadFile || isUploadingMediaResource}
                  loading={isUploadingMediaResource}
                  onClick={() => void uploadMediaResourceAttachment()}
                >
                  Upload media attachment
                </Button>
              </div>
              {mediaUploadResult ? (
                <InlineAlert tone={mediaUploadResult.ok ? 'success' : 'danger'} className="mt-3">
                  {mediaUploadResult.ok
                    ? `Media uploaded and attached as ${mediaUploadResult.canonical.id}. Publishing still requires review.`
                    : mediaUploadResult.message}
                </InlineAlert>
              ) : null}
              {mediaUploadResult ? (
                <TechnicalReviewDetails title="Media upload response">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(mediaUploadResult, null, 2)}
                  </pre>
                </TechnicalReviewDetails>
              ) : null}
            </Surface> : null}
            {!isScheduleWorkspace ? <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Create text attachment</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Turn the reviewed caption into a reusable text attachment for this post.
                  </div>
                </div>
                <StatusBadge tone="info">text</StatusBadge>
              </div>
              {postTextResourceDraft.publishable ? null : (
                <InlineAlert tone="warning">
                  {postTextResourceDraft.errors.join('; ')}
                </InlineAlert>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={!postTextResourceDraft.publishable || isCreatingTextResource}
                  loading={isCreatingTextResource}
                  onClick={() => void createTextResourceAttachment()}
                >
                  Create text attachment
                </Button>
              </div>
              {textResourceResult ? (
                <InlineAlert tone={textResourceResult.ok ? 'success' : 'danger'} className="mt-3">
                  {textResourceResult.ok
                    ? `Text attachment created and selected: ${textResourceResult.canonical.id}.`
                    : textResourceResult.message}
                </InlineAlert>
              ) : null}
              {textResourceResult ? (
                <TechnicalReviewDetails title="Text attachment response">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(textResourceResult, null, 2)}
                  </pre>
                </TechnicalReviewDetails>
              ) : null}
            </Surface> : null}
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
            {!isScheduleWorkspace ? <div className="flex flex-wrap gap-3">
              <Button onClick={addLocalAssetCandidate}>Add local asset candidate</Button>
              <Button
                disabled={!validation.publishable}
                onClick={() => {
                  if (validation.publishable) {
                    setPayloadPreview(validation.payload);
                  }
                }}
              >
                Preview reviewed post
              </Button>
              <Button
                disabled={!validation.publishable || isPublishing}
                onClick={async () => {
                  if (!validation.publishable) {
                    return;
                  }
                  setPayloadPreview(validation.payload);
                  setPublishResult(null);
                  setIsPublishing(true);
                  try {
                    const result = await publishReviewedPostDraft(validation.payload);
                    setPublishResult(result);
                  } finally {
                    setIsPublishing(false);
                  }
                }}
              >
                {isPublishing ? 'Publishing...' : 'Publish to Realm'}
              </Button>
            </div> : null}
            {!isScheduleWorkspace ? (
              <TechnicalReviewDetails title="Reviewed post payload">
                <pre className="ras-json-preview m-0 min-h-32 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                  {payloadPreview ? JSON.stringify(payloadPreview, null, 2) : 'No reviewed post preview yet.'}
                </pre>
              </TechnicalReviewDetails>
            ) : null}
            {!isScheduleWorkspace && publishResult ? (
              <Surface tone="card" padding="md">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Publish result</div>
                    <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                      {publishResult.ok ? 'Post returned from Realm.' : 'Publish failed.'}
                    </div>
                  </div>
                  <StatusBadge tone={publishResult.ok ? 'success' : 'danger'}>
                    {publishResult.ok ? 'published' : 'failed'}
                  </StatusBadge>
                </div>
                {publishResult.ok ? (
                  <dl className="mt-3 grid gap-2 text-[length:var(--nimi-type-body-sm-size)]">
                    {Object.entries(publishResult.canonical).map(([key, value]) => (
                      <div key={key} className="grid gap-1 sm:grid-cols-[150px_1fr]">
                        <dt className="font-medium text-[var(--nimi-text-muted)]">{key}</dt>
                        <dd className="ras-break-anywhere m-0 text-[var(--nimi-text-primary)]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <InlineAlert tone="danger">
                    {publishResult.message}
                  </InlineAlert>
                )}
              </Surface>
            ) : null}
            {isScheduleWorkspace ? <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Single local schedule</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Hold a reviewed draft for one local scheduled publish action.
                  </div>
                </div>
                <StatusBadge tone="warning">local only</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <FieldShell label="Local date">
                  <TextField
                    type="date"
                    value={scheduleInput.localDate}
                    disabled={!validation.publishable}
                    onChange={(event) => updateScheduleInput({ localDate: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Local time">
                  <TextField
                    type="time"
                    value={scheduleInput.localTime}
                    disabled={!validation.publishable}
                    onChange={(event) => updateScheduleInput({ localTime: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              {!validation.publishable ? (
                <InlineAlert tone="warning">
                  Local schedule unavailable: reviewed publishable post draft required.
                </InlineAlert>
              ) : null}
              {scheduleErrors.length > 0 ? (
                <InlineAlert tone="warning">
                  {scheduleErrors.join('; ')}
                </InlineAlert>
              ) : null}
              <div className="mt-3">
                <Button
                  disabled={!validation.publishable}
                  onClick={() => {
                    const result = buildLocalPostScheduleCandidate(validation, scheduleInput);
                    if (result.scheduleable) {
                      setSchedulePreview(result.candidate);
                      setScheduleErrors([]);
                    } else {
                      setSchedulePreview(null);
                      setScheduleErrors(result.errors);
                    }
                  }}
                >
                  Preview local schedule
                </Button>
              </div>
              <TechnicalReviewDetails title="Local schedule payload">
                <pre className="ras-json-preview m-0 min-h-28 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                  {schedulePreview ? JSON.stringify(schedulePreview, null, 2) : 'No local schedule preview yet.'}
                </pre>
              </TechnicalReviewDetails>
            </Surface> : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="m-0 text-base font-semibold">{isScheduleWorkspace ? 'Schedule status' : 'Local preview history'}</h4>
            <StatusBadge tone="neutral">{isScheduleWorkspace ? 'single candidate' : 'candidate only'}</StatusBadge>
          </div>
          {isScheduleWorkspace ? (
            <Surface tone="card" padding="md">
              <div className="font-medium">No automated queue is created</div>
              <p className="m-0 mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                This workspace preserves a reviewed local scheduled candidate and keeps Realm publish as the only public success state.
              </p>
            </Surface>
          ) : assetCandidates.length === 0 ? (
            <EmptyState title="No local candidates" description="Creative asset candidates created here are local preview/history only." />
          ) : (
            <div className="grid gap-3">
              {assetCandidates.map((candidate) => (
                <Surface key={candidate.sequence} tone="card" padding="md">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{candidate.label}</div>
                    <StatusBadge tone="warning">local only</StatusBadge>
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

function AgentDetail({ agentId, workspace }: { agentId: string; workspace: StudioWorkspace }) {
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
  const activeWorkspaceItem = studioWorkspaceItems.find((item) => item.id === activeWorkspace) || studioWorkspaceItems[0]!;
  const agentWorkspace = AGENT_WORKSPACES.includes(activeWorkspace) ? activeWorkspace : 'detail';

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
        {activeWorkspace === 'create' ? <CreateRealmAgentWorkspace /> : null}
        <EmptyState
          title="No owner-created Realm Agents"
          description="You have not created any user-owned Realm Agents yet."
          action={activeWorkspace === 'create'
            ? <Button onClick={() => void portfolioQuery.refetch()}>Refresh portfolio</Button>
            : <Button onClick={() => onWorkspaceChange('create')}>Create Realm Agent</Button>}
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 flex-1 gap-4">
      <WorkspaceHeader activeWorkspace={activeWorkspace} onWorkspaceChange={onWorkspaceChange} />
      {activeWorkspace === 'create' ? <CreateRealmAgentWorkspace /> : null}
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
        ) : selectedAgent && activeWorkspace !== 'create' ? (
          <AgentDetail agentId={selectedAgent.id} workspace={agentWorkspace} />
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
