import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, EmptyState, FieldShell, InlineAlert, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/kit/ui';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  AGENT_VISIBILITY_FIELDS,
  AGENT_VISIBILITY_VALUES,
  createAgentVisibilityDraft,
  getAgentVisibilitySettings,
  getOwnerAgentSettings,
  projectAgentRuntimeContextSummary,
  proposeReviewedOwnerAgentSettings,
  updateReviewedAgentVisibility,
  updateReviewedOwnerAgentSettings,
  type AgentVisibilityDraft,
  type AgentVisibilityField,
  type RealmAgentVisibilityUpdateResult,
  type RealmOwnerAgentSettings,
  type RealmOwnerAgentSettingsUpdateResult,
  type RuntimeOwnerSettingsProposalResult,
  type RuntimeProjectionSummaryResult,
} from './portfolio-client.js';
import {
  RAW_RULE_REVIEW_DEFERRED_REASON,
  applyRuntimeOwnerSettingsProposal,
  buildRealmOwnerAgentSettingsUpdateInput,
  createOwnerAgentSettingsDraft,
  type OwnerAgentSettingsDraft,
} from './setting-proposal.js';
import { TechnicalReviewDetails } from './OwnerPortfolio.shared.js';

export function SettingProposalWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
  const settingsQuery = useQuery({
    queryKey: ['realm-agent-studio', 'owner-agent-settings', agent.id],
    queryFn: () => getOwnerAgentSettings(agent.id),
  });
  const [draft, setDraft] = useState<OwnerAgentSettingsDraft | null>(null);
  const [ownerReviewed, setOwnerReviewed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<RealmOwnerAgentSettingsUpdateResult | null>(null);
  const [runtimeProposal, setRuntimeProposal] = useState<RuntimeOwnerSettingsProposalResult | null>(null);
  const [isProposing, setIsProposing] = useState(false);
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
      setRuntimeProposal(null);
      setIsProposing(false);
    }
  }, [agent.id, settingsQuery.data]);

  function updateDraft(patch: Partial<OwnerAgentSettingsDraft>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setOwnerReviewed(false);
    setResult(null);
    setRuntimeProposal(null);
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

  async function requestRuntimeProposal() {
    if (!draft || !settingsQuery.data) {
      return;
    }
    setIsProposing(true);
    setRuntimeProposal(null);
    try {
      const proposalResult = await proposeReviewedOwnerAgentSettings(agent.id, draft, settingsQuery.data);
      setRuntimeProposal(proposalResult);
    } finally {
      setIsProposing(false);
    }
  }

  function applyRuntimeProposal() {
    if (!draft || !runtimeProposal?.ok) {
      return;
    }
    setDraft(applyRuntimeOwnerSettingsProposal(draft, runtimeProposal.proposal));
    setOwnerReviewed(false);
    setResult(null);
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
                <Button
                  tone="secondary"
                  disabled={!draft.naturalLanguageIntent.trim() || isProposing}
                  loading={isProposing}
                  onClick={() => void requestRuntimeProposal()}
                >
                  Ask Runtime for proposal
                </Button>
              </div>
              {runtimeProposal ? (
                <Surface tone="card" padding="md">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">Runtime settings proposal</div>
                      <div className="ras-break-anywhere mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                        {runtimeProposal.ok
                          ? runtimeProposal.proposal.rationale
                          : runtimeProposal.message}
                      </div>
                    </div>
                    <StatusBadge tone={runtimeProposal.ok ? 'info' : 'danger'}>
                      {runtimeProposal.ok ? 'candidate' : 'unavailable'}
                    </StatusBadge>
                  </div>
                  {runtimeProposal.ok ? (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {runtimeProposal.proposal.changedSettingKeys.map((key) => (
                          <StatusBadge key={key} tone="neutral">{key}</StatusBadge>
                        ))}
                      </div>
                      <InlineAlert tone="info" className="mt-3">
                        Runtime output is candidate material only. Apply it to the form, review the fields, then save through Realm.
                      </InlineAlert>
                      <div className="mt-3">
                        <Button onClick={applyRuntimeProposal}>Apply proposal to fields</Button>
                      </div>
                    </>
                  ) : (
                    <InlineAlert tone="danger" className="mt-3">
                      Draft fields were preserved. Edit manually or retry after Runtime text generation is available.
                    </InlineAlert>
                  )}
                </Surface>
              ) : null}
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

export const VISIBILITY_FIELD_LABELS: Record<AgentVisibilityField, string> = {
  accountVisibility: 'Account discoverability',
  defaultPostVisibility: 'Default post visibility',
  dmVisibility: 'Direct message visibility',
  profileVisibility: 'Profile visibility',
};

export function VisibilitySettingsWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
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

export function RuntimeProjectionWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
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
