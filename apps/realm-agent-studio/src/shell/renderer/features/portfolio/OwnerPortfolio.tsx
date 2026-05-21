import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
            Reads and saves structured settings through MeService owner settings surfaces. Raw AgentRule review stays deferred.
          </p>

          {settingsQuery.isLoading ? (
            <EmptyState title="Loading owner settings" description="Reading GET /api/me/agents/{agentId}/settings through SDK MeService." />
          ) : null}
          {settingsQuery.isError ? (
            <InlineAlert tone="danger">
              Owner settings unavailable: {settingsQuery.error instanceof Error ? settingsQuery.error.message : 'Realm owner settings read failed.'}
            </InlineAlert>
          ) : null}
          {draft && settingsQuery.data ? (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Display name" message="Saved through UpdateOwnerAgentSettingsDto.displayName.">
                  <TextField
                    value={draft.displayName}
                    placeholder="Public display name"
                    onChange={(event) => updateDraft({ displayName: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Greeting" message="Saved through UpdateOwnerAgentSettingsDto.greeting.">
                  <TextField
                    value={draft.greeting}
                    placeholder="Opening greeting"
                    onChange={(event) => updateDraft({ greeting: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Description" message="Owner-facing description setting, not CreatorService bio.">
                <TextareaField
                  value={draft.description}
                  placeholder="Public description"
                  onChange={(event) => updateDraft({ description: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="grid gap-4 md:grid-cols-2">
                <FieldShell label="Public role" message="Saved as identity.publicRole.">
                  <TextField
                    value={draft.publicRole}
                    placeholder="Guide, mentor, companion..."
                    onChange={(event) => updateDraft({ publicRole: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Relationship mode" message="Saved as personality.relationshipMode.">
                  <TextField
                    value={draft.relationshipMode}
                    placeholder="coach, friend, narrator..."
                    onChange={(event) => updateDraft({ relationshipMode: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Worldview" message="Saved as identity.worldview; server compiles accepted settings into canonical truth.">
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
                <FieldShell label="Positioning" message="Saved as positioning.positioning.">
                  <TextareaField
                    value={draft.positioning}
                    placeholder="How this agent should be positioned"
                    onChange={(event) => updateDraft({ positioning: event.currentTarget.value })}
                  />
                </FieldShell>
              </div>
              <FieldShell label="Natural-language intent" message="Saved as naturalLanguageIntent for server-side settings compilation; it is not raw rule CRUD.">
                <TextareaField
                  value={draft.naturalLanguageIntent}
                  placeholder="Describe the owner-reviewed setting intent"
                  onChange={(event) => updateDraft({ naturalLanguageIntent: event.currentTarget.value })}
                />
              </FieldShell>
              <div className="flex flex-wrap gap-3">
                <Button disabled={!draft.naturalLanguageIntent.trim()} onClick={useInstructionAsRuleCandidate}>
                  Copy to raw rule candidate
                </Button>
              </div>
              <FieldShell label="Raw rule text candidate" message="Deferred review only. It is never sent to AgentRulesService or the owner settings PATCH payload.">
                <TextareaField
                  value={draft.rawRuleTextCandidate}
                  placeholder="Visible AgentRule-shaped text for future owner rule-content review"
                  onChange={(event) => updateDraft({ rawRuleTextCandidate: event.currentTarget.value })}
                />
              </FieldShell>
              <FieldShell label="Profile cover URL" message="Read projection only in this workflow. Owner write needs a dedicated non-creator profile cover surface.">
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
                    ? 'Realm confirmed owner settings update through MeService. Detail reads were refreshed from owner surfaces.'
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
            <h4 className="m-0 text-base font-semibold">Reviewed settings payload</h4>
            <StatusBadge tone={proposal?.ok ? 'success' : 'warning'}>{proposal?.ok ? 'ready' : 'not ready'}</StatusBadge>
          </div>
          <FieldShell label="PATCH payload preview" message="Submitted payload is only UpdateOwnerAgentSettingsDto. Raw rule text remains outside the payload.">
            <pre className="ras-json-preview m-0 min-h-80 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
              {proposal?.ok ? JSON.stringify(proposal.preview, null, 2) : proposal?.errors.join('; ') || 'No owner settings loaded.'}
            </pre>
          </FieldShell>
          {result ? (
            <FieldShell label="Save result" message="Truth write success is based on Realm MeService.updateMyRealmAgentSettings response.">
              <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {JSON.stringify(result, null, 2)}
              </pre>
            </FieldShell>
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
        Reads and saves owner-reviewed social visibility through AgentsService visibility endpoints only. This does not create publish, schedule, moderation, or lifecycle state.
      </p>

      {visibilityQuery.isLoading ? (
        <EmptyState title="Loading visibility settings" description="Reading GET /api/agent/accounts/{id}/visibility through SDK AgentsService." />
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
                ? 'Realm confirmed visibility settings. No lifecycle or publish state was created.'
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
          <FieldShell label="Visibility result" message="PATCH sends only changed UpdateAgentVisibilityDto fields.">
            <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
              {result ? JSON.stringify(result, null, 2) : JSON.stringify({ current: visibilityQuery.data, draft }, null, 2)}
            </pre>
          </FieldShell>
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
            <StatusBadge tone="warning">blocked preview</StatusBadge>
            <StatusBadge tone="neutral">not public truth</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Owner-reviewed avatar URL saves through AgentsService.agentControllerSelectAvatar. Generated/uploaded visual candidates still remain local until a Resource/Binding write succeeds.
          </p>
          <div className="mt-4 grid gap-4">
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Avatar URL selection</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Saves to POST /api/agent/accounts/{agent.id}/avatar. This does not create Resource or Binding truth.
                  </div>
                </div>
                <StatusBadge tone="info">Realm save</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[80px_1fr]">
                <div className="h-20 w-20 overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-active)]">
                  {avatarUrlDraft.trim() ? <img src={avatarUrlDraft.trim()} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="grid gap-3">
                  <FieldShell label="Avatar URL" message="Owner-reviewed http(s) URL only. Studio submits only SelectAvatarDto.avatarUrl.">
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
                    ? 'Realm confirmed avatar URL selection. Detail and portfolio reads were refreshed from owner surfaces.'
                    : avatarResult.message}
                </InlineAlert>
              ) : null}
              {avatarResult ? (
                <FieldShell label="Avatar selection result" message="Public avatar success is based on Realm operation success, then refreshed owner reads.">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(avatarResult, null, 2)}
                  </pre>
                </FieldShell>
              ) : null}
            </Surface>
            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
              <FieldShell label="Resource type" message="Future Resource carrier only.">
                <SelectField
                  value={visualDraft.resourceType}
                  options={visualResourceTypes.map((resourceType) => ({ value: resourceType, label: `Resource(${resourceType})` }))}
                  onValueChange={(value) => updateVisualDraft({ resourceType: value as VisualCandidateResourceType })}
                />
              </FieldShell>
              <FieldShell label="Binding point" message="Future AGENT binding point only.">
                <SelectField
                  value={visualDraft.bindingPoint}
                  options={visualBindingPoints.map((bindingPoint) => ({ value: bindingPoint, label: bindingPoint }))}
                  onValueChange={(value) => updateVisualDraft({ bindingPoint: value as MediaCandidateBindingPoint })}
                />
              </FieldShell>
            </div>
            <FieldShell label="Visual prompt" message="Owner-approved public/context fields plus this local draft only.">
              <TextareaField
                value={visualDraft.prompt}
                placeholder="Describe the avatar, portrait, or candidate visual"
                onChange={(event) => updateVisualDraft({ prompt: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Notes" message="Local preview notes; omitted from future Runtime input unless owner-reviewed.">
              <TextareaField
                value={visualDraft.notes}
                placeholder="Composition, reference, or review notes"
                onChange={(event) => updateVisualDraft({ notes: event.currentTarget.value })}
              />
            </FieldShell>
            <InlineAlert tone="warning">
              {visualPayload.changed ? VISUAL_MEDIA_BLOCKED_REASON : visualPayload.errors.join('; ')}
            </InlineAlert>
            <FieldShell label="Blocked visual payload" message="Preview only. Visual generation remains local; Resource-backed Agent Binding is deferred until Realm exposes an owner-scoped ingress.">
              <pre className="ras-json-preview m-0 min-h-72 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {visualPayload.payload ? JSON.stringify(visualPayload.payload, null, 2) : visualPayload.errors.join('; ')}
              </pre>
            </FieldShell>
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Owner Resource Binding admission gap</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Resource-backed avatar, portrait, and voice sample publication requires a dedicated owner-scoped Realm ingress. Studio does not call WorldControlService, CreatorService, or AgentRulesService for this owner save path.
                  </div>
                </div>
                <StatusBadge tone="danger">blocked</StatusBadge>
              </div>
              <InlineAlert tone="danger" className="mt-3">
                Backend admission required: owner-scoped Resource-to-Agent binding ingress for MASTER_OWNED agents, with owner review and canonical Binding confirmation.
              </InlineAlert>
            </Surface>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Voice demo candidate</h3>
            <StatusBadge tone="info">Runtime candidate</StatusBadge>
            <StatusBadge tone="neutral">sample only</StatusBadge>
            <StatusBadge tone="warning">not public truth</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Runtime candidate generation for capability audio.synthesize and SDK path media.tts.synthesize. Runtime artifacts are not Resource or Binding truth until a separate reviewed Realm write succeeds.
          </p>
          <div className="mt-4 grid gap-4">
            <Surface tone="card" padding="md">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Future Resource</div>
                  <div className="mt-1 font-medium">Resource(AUDIO)</div>
                </div>
                <div>
                  <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Future Binding</div>
                  <div className="mt-1 font-medium">AGENT_VOICE_SAMPLE</div>
                </div>
              </div>
            </Surface>
            <FieldShell label="Demo script" message="Local draft text only. No chat transcript, LocalAgent memory, emotion, cognition, provider, or hardcoded model.">
              <TextareaField
                value={voiceDraft.scriptText}
                placeholder="Short public voice demo script"
                onChange={(event) => updateVoiceDraft({ scriptText: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Runtime TTS model" message="Required user/env model config for Runtime media.tts.synthesize. No provider or hardcoded model is supplied by Studio.">
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
                  ? 'Runtime media.tts.synthesize returned candidate output. Public voice truth still requires a reviewed Resource(AUDIO) and Binding write.'
                  : voiceResult.message}
              </InlineAlert>
            ) : null}
            {voiceResult?.ok ? (
              <Surface tone="card" padding="md">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Runtime job</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.jobId || 'job id unavailable'}</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Artifact ids</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.artifactIds.join(', ') || 'artifact id unavailable'}</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Source</div>
                    <div className="mt-1 font-medium">{voiceResult.source}</div>
                  </div>
                  <div>
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Trace</div>
                    <div className="ras-break-anywhere mt-1 font-medium">{voiceResult.runtime.traceId || 'trace unavailable'}</div>
                  </div>
                </div>
              </Surface>
            ) : null}
            <FieldShell label="Runtime voice payload" message="Candidate-only. Runtime may generate audio artifacts; Resource/Binding/Profile writes require separate Realm operations.">
              <pre className="ras-json-preview m-0 min-h-72 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {voicePayload.payload ? JSON.stringify(voicePayload.payload, null, 2) : voicePayload.errors.join('; ')}
              </pre>
            </FieldShell>
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
        <h3 className="m-0 text-xl font-semibold">Runtime world context projection</h3>
        <StatusBadge tone="info">Realm projection</StatusBadge>
        <StatusBadge tone="neutral">summary only</StatusBadge>
        <StatusBadge tone="warning">not rule review</StatusBadge>
      </div>
      <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
        Calls RuntimeProjectionsService.projectRuntimePayload for world AI consumption readiness, then displays only checksum and counts. Raw rule statements are not exposed or accepted as owner edits.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button disabled={isProjecting || agent.world.status !== 'available'} loading={isProjecting} onClick={() => void projectRuntimeContext()}>
          Project Runtime context
        </Button>
      </div>
      {agent.world.status !== 'available' ? (
        <InlineAlert tone="warning">
          Runtime world projection unavailable: worldId evidence is missing from Realm MeService.getMyRealmAgent.
        </InlineAlert>
      ) : null}
      {projectionResult ? (
        <InlineAlert tone={projectionResult.ok ? 'success' : 'danger'} className="mt-3">
          {projectionResult.ok
            ? 'Runtime projection returned a source-backed RUNTIME_PAYLOAD summary. No truth write, agent-specific rule review, or raw rule content was created.'
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
        <FieldShell label="Submitted projection request" message="Request contains only world evidence and allowed scope filters; no LocalAgent memory, private transcript, owner setting writes, or agent-specific raw rule review.">
          <pre className="ras-json-preview m-0 mt-3 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
            {JSON.stringify(projectionResult.submitted, null, 2)}
          </pre>
        </FieldShell>
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

function CreativePostWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
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
        ? { tone: 'success', message: `Loaded ${resources.length} READY Resource attachment option${resources.length === 1 ? '' : 's'}.` }
        : { tone: 'warning', message: 'No READY Resource attachment options were returned by Realm ResourcesService.listResources.' });
    } catch (error) {
      setResourceOptions([]);
      setResourceListStatus({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Realm ResourcesService.listResources failed.',
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
      message: `Selected READY Resource(${resource.resourceType}) ${resource.id} for the canonical attachment envelope.`,
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
        message: 'Reviewed media Resource upload requires a selected file.',
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
            <h3 className="m-0 text-xl font-semibold">Creative post candidate</h3>
            <StatusBadge tone="info">app-local draft</StatusBadge>
            <StatusBadge tone={validation.publishable ? 'success' : 'neutral'}>
              {validation.publishable ? 'Realm publish ready' : 'not Realm publish'}
            </StatusBadge>
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
              <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
                <div className="flex items-end">
                  <Button disabled={isLoadingResources} loading={isLoadingResources} onClick={() => void loadReadyResources()}>
                    Load ready Resources
                  </Button>
                </div>
                <FieldShell label="READY Resource picker" message="Uses ResourcesService.listResources, then locally filters READY Resource targets. It does not create Binding or profile asset truth.">
                  <SelectField
                    disabled={resourceOptions.length === 0}
                    value={draft.attachmentTargetType === 'RESOURCE' ? draft.attachmentTargetId : ''}
                    options={[
                      { value: '', label: resourceOptions.length === 0 ? 'No READY Resources loaded' : 'Select READY Resource' },
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
            </Surface>
            <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Upload media Resource</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Creates a PENDING media Resource, uploads to the signed storage URL, finalizes to READY, then fills RESOURCE + resourceId.
                  </div>
                </div>
                <StatusBadge tone="info">direct upload</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                <FieldShell label="Resource type">
                  <SelectField
                    value={mediaResourceType}
                    options={[
                      { value: 'IMAGE', label: 'Resource(IMAGE)' },
                      { value: 'VIDEO', label: 'Resource(VIDEO)' },
                      { value: 'AUDIO', label: 'Resource(AUDIO)' },
                    ]}
                    onValueChange={(value) => {
                      setMediaResourceType(value as DirectMediaResourceType);
                      setMediaUploadFile(null);
                      setMediaUploadResult(null);
                    }}
                  />
                </FieldShell>
                <FieldShell label="File" message={draft.humanReviewed ? 'Owner-reviewed media only. This does not create Binding/Profile or publish success.' : 'Human review complete is required before upload.'} messageTone={draft.humanReviewed ? 'neutral' : 'danger'}>
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
                  Upload media Resource attachment
                </Button>
              </div>
              {mediaUploadResult ? (
                <InlineAlert tone={mediaUploadResult.ok ? 'success' : 'danger'} className="mt-3">
                  {mediaUploadResult.ok
                    ? `Realm finalized READY ${mediaUploadResult.canonical.resourceType} resource ${mediaUploadResult.canonical.id}; publishing still requires PostsService.createPost.`
                    : mediaUploadResult.message}
                </InlineAlert>
              ) : null}
              {mediaUploadResult ? (
                <FieldShell label="Media Resource result" message="Resource attachment truth only. No Binding, profile asset, schedule, moderation, or post success is claimed here.">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(mediaUploadResult, null, 2)}
                  </pre>
                </FieldShell>
              ) : null}
            </Surface>
            <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Reviewed text Resource</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Creates a READY Resource(TEXT) from the reviewed caption, then fills the post attachment envelope as RESOURCE + resourceId.
                  </div>
                </div>
                <StatusBadge tone="info">Realm Resource</StatusBadge>
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
                  Create text Resource attachment
                </Button>
              </div>
              {textResourceResult ? (
                <InlineAlert tone={textResourceResult.ok ? 'success' : 'danger'} className="mt-3">
                  {textResourceResult.ok
                    ? `Realm confirmed READY TEXT resource ${textResourceResult.canonical.id}; the attachment envelope now targets that Resource.`
                    : textResourceResult.message}
                </InlineAlert>
              ) : null}
              {textResourceResult ? (
                <FieldShell label="Text Resource result" message="Attachment truth is based on Realm Resource success. Publishing still requires PostsService.createPost.">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(textResourceResult, null, 2)}
                  </pre>
                </FieldShell>
              ) : null}
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
            </div>
            <FieldShell label="Reviewed candidate payload" message="Payload preview is preserved for review and failure diagnosis. Publish sends only realmCreatePost to Realm.">
              <pre className="ras-json-preview m-0 min-h-32 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {payloadPreview ? JSON.stringify(payloadPreview, null, 2) : 'No reviewed payload preview yet.'}
              </pre>
            </FieldShell>
            {publishResult ? (
              <Surface tone="card" padding="md">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Realm publish result</div>
                    <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                      Source: {publishResult.source}
                    </div>
                  </div>
                  <StatusBadge tone={publishResult.ok ? 'success' : 'danger'}>
                    {publishResult.ok ? 'canonical post returned' : publishResult.failure}
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
            <Surface tone="card" padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">App-local single schedule</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Creates one local preview candidate only after human review. It is not Realm scheduling, moderation, or publish success.
                  </div>
                </div>
                <StatusBadge tone="warning">not Realm schedule</StatusBadge>
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
                  App-local schedule unavailable: reviewed publishable local post draft required.
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
              <FieldShell label="Local schedule candidate" message="Preview only. No Realm, timers, persistence, queue, campaign, or recurring automation is created.">
                <pre className="ras-json-preview m-0 min-h-28 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                  {schedulePreview ? JSON.stringify(schedulePreview, null, 2) : 'No app-local schedule preview yet.'}
                </pre>
              </FieldShell>
            </Surface>
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
  const queryClient = useQueryClient();
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

  async function refreshOwnerAgentReads() {
    await Promise.all([
      detailQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['realm-agent-studio', 'owner-portfolio'] }),
    ]);
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
      <VisibilitySettingsWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} />
      <SettingProposalWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} />
      <RuntimeProjectionWorkspace agent={agent} />
      <MediaVoiceCandidateWorkspace agent={agent} onAgentWrite={refreshOwnerAgentReads} />
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
      <div className="grid min-w-0 flex-1 gap-4">
        <CreateRealmAgentWorkspace />
        <EmptyState
          title="No owner-created Realm Agents"
          description="Realm returned an empty current-user MASTER_OWNED portfolio from GET /api/me/agents."
          action={<Button onClick={() => void portfolioQuery.refetch()}>Refresh</Button>}
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 flex-1 gap-4">
      <CreateRealmAgentWorkspace />
      <div className="grid min-h-0 min-w-0 gap-4 lg:grid-cols-[360px_1fr]">
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
    </div>
  );
}
