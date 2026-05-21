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
import {
  getOwnerPortfolioAgentDetail,
  listOwnerPortfolioAgents,
  publishReviewedPostDraft,
  type RealmPostPublishResult,
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
  SETTING_PROPOSAL_BLOCKED_REASON,
  buildBlockedSettingProposal,
  type SettingProposalInput,
} from './setting-proposal.js';
import {
  MEDIA_CANDIDATE_BINDING_POINTS,
  MEDIA_CANDIDATE_RESOURCE_TYPES,
  VOICE_DEMO_BLOCKED_REASON,
  VISUAL_MEDIA_BLOCKED_REASON,
  buildBlockedVisualAssetCandidatePayload,
  buildBlockedVoiceDemoRequestPayload,
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

function createSettingProposalInput(agent: OwnerPortfolioAgentDetail): SettingProposalInput {
  return {
    displayName: agent.displayName.value,
    bio: agent.bio.value,
    profileCoverUrl: agent.profileCoverUrl.value,
    ruleText: '',
    naturalLanguageInstruction: '',
  };
}

function SettingProposalWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
  const [draft, setDraft] = useState<SettingProposalInput>(() => createSettingProposalInput(agent));
  const [saveAttempted, setSaveAttempted] = useState(false);
  const proposal = useMemo(() => buildBlockedSettingProposal(draft, agent), [agent, draft]);

  useEffect(() => {
    setDraft(createSettingProposalInput(agent));
    setSaveAttempted(false);
  }, [agent.id]);

  function updateDraft(patch: Partial<SettingProposalInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveAttempted(false);
  }

  function useInstructionAsRuleCandidate() {
    const instruction = draft.naturalLanguageInstruction.trim();
    if (!instruction) {
      return;
    }
    updateDraft({ ruleText: instruction });
  }

  return (
    <Surface tone="panel" padding="lg" className="mt-5">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Setting proposal workspace</h3>
            <StatusBadge tone="warning">save blocked</StatusBadge>
            <StatusBadge tone="neutral">owner-reviewed candidate</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Editable local proposal for {agent.handle.value ? `@${agent.handle.value}` : agent.displayName.value || agent.id}; no CreatorService or AgentRulesService write is called.
          </p>

          <div className="mt-4 grid gap-4">
            <FieldShell label="Display name" message="Candidate for UpdateCreatorAgentDto.displayName evidence; omitted if unchanged or empty.">
              <TextField
                value={draft.displayName}
                placeholder="Public display name"
                onChange={(event) => updateDraft({ displayName: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Public bio" message="Candidate for UpdateCreatorAgentDto.bio evidence; omitted if unchanged or empty.">
              <TextareaField
                value={draft.bio}
                placeholder="Public bio proposal"
                onChange={(event) => updateDraft({ bio: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Profile cover URL" message="Candidate for UpdateCreatorAgentDto.profileCoverUrl evidence; omitted if unchanged or empty.">
              <TextField
                value={draft.profileCoverUrl}
                placeholder="https://..."
                onChange={(event) => updateDraft({ profileCoverUrl: event.currentTarget.value })}
              />
            </FieldShell>
            <FieldShell label="Natural-language instruction" message="Local drafting aid only. It never calls Runtime, provider, model, CreatorService, or AgentRulesService.">
              <TextareaField
                value={draft.naturalLanguageInstruction}
                placeholder="Describe the owner-reviewed change you want to draft locally"
                onChange={(event) => updateDraft({ naturalLanguageInstruction: event.currentTarget.value })}
              />
            </FieldShell>
            <div className="flex flex-wrap gap-3">
              <Button disabled={!draft.naturalLanguageInstruction.trim()} onClick={useInstructionAsRuleCandidate}>
                Use as rule candidate
              </Button>
            </div>
            <FieldShell label="Visible rule text candidate" message="Owner-reviewed visible AgentRule-shaped text only. No hidden personality, worldview, provider, model, or LocalAgent state.">
              <TextareaField
                value={draft.ruleText}
                placeholder="Visible rule text candidate for owner review"
                onChange={(event) => updateDraft({ ruleText: event.currentTarget.value })}
              />
            </FieldShell>
            {proposal.changed ? (
              <InlineAlert tone="warning">
                {SETTING_PROPOSAL_BLOCKED_REASON}
              </InlineAlert>
            ) : (
              <InlineAlert tone="warning">
                {proposal.errors.join('; ')}
              </InlineAlert>
            )}
            {saveAttempted ? (
              <InlineAlert tone="danger">
                Realm save remains blocked. This app slice has no admitted owner update semantics for selected Realm Agent settings.
              </InlineAlert>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={!proposal.changed}
                onClick={() => setSaveAttempted(true)}
              >
                Check save admission
              </Button>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="m-0 text-base font-semibold">Blocked candidate payload</h4>
            <StatusBadge tone="warning">not saved</StatusBadge>
          </div>
          <FieldShell label="Payload preview" message="Separated profile update candidate and visible rule text candidate.">
            <pre className="ras-json-preview m-0 min-h-80 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
              {proposal.payload ? JSON.stringify(proposal.payload, null, 2) : proposal.errors.join('; ')}
            </pre>
          </FieldShell>
        </div>
      </div>
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
  };
}

function MediaVoiceCandidateWorkspace({ agent }: { agent: OwnerPortfolioAgentDetail }) {
  const [visualDraft, setVisualDraft] = useState<VisualMediaCandidateInput>(() => createVisualMediaCandidateInput());
  const [voiceDraft, setVoiceDraft] = useState<VoiceDemoCandidateInput>(() => createVoiceDemoCandidateInput(agent));
  const visualPayload = useMemo(() => buildBlockedVisualAssetCandidatePayload(visualDraft, agent), [agent, visualDraft]);
  const voicePayload = useMemo(() => buildBlockedVoiceDemoRequestPayload(voiceDraft, agent), [agent, voiceDraft]);
  const visualResourceTypes = MEDIA_CANDIDATE_RESOURCE_TYPES.filter((resourceType): resourceType is VisualCandidateResourceType => resourceType === 'IMAGE');
  const visualBindingPoints = MEDIA_CANDIDATE_BINDING_POINTS.filter((bindingPoint) => bindingPoint !== 'AGENT_VOICE_SAMPLE');

  useEffect(() => {
    setVisualDraft(createVisualMediaCandidateInput());
    setVoiceDraft(createVoiceDemoCandidateInput(agent));
  }, [agent.id]);

  function updateVisualDraft(patch: Partial<VisualMediaCandidateInput>) {
    setVisualDraft((current) => ({ ...current, ...patch }));
  }

  function updateVoiceDraft(patch: Partial<VoiceDemoCandidateInput>) {
    setVoiceDraft((current) => ({ ...current, ...patch }));
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
            Local Resource and Binding evidence preview for {agent.handle.value ? `@${agent.handle.value}` : agent.displayName.value || agent.id}; no upload, finalize, binding upsert, profile update, provider, or model is called.
          </p>
          <div className="mt-4 grid gap-4">
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
            <FieldShell label="Blocked visual payload" message="Preview only. Resource upload/finalize and Binding/Profile writes remain blocked.">
              <pre className="ras-json-preview m-0 min-h-72 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 text-xs">
                {visualPayload.payload ? JSON.stringify(visualPayload.payload, null, 2) : visualPayload.errors.join('; ')}
              </pre>
            </FieldShell>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="m-0 text-xl font-semibold">Voice demo candidate</h3>
            <StatusBadge tone="warning">synthesis blocked</StatusBadge>
            <StatusBadge tone="neutral">sample only</StatusBadge>
          </div>
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
            Blocked request preview for Runtime capability audio.synthesize and SDK path media.tts.synthesize; no Runtime, Resource, Binding, or voice authority write is called.
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
            <FieldShell label="Demo script" message="Local draft text only. No chat transcript, LocalAgent memory, emotion, cognition, provider, or model.">
              <TextareaField
                value={voiceDraft.scriptText}
                placeholder="Short public voice demo script"
                onChange={(event) => updateVoiceDraft({ scriptText: event.currentTarget.value })}
              />
            </FieldShell>
            <InlineAlert tone="warning">
              {voicePayload.changed ? VOICE_DEMO_BLOCKED_REASON : voicePayload.errors.join('; ')}
            </InlineAlert>
            <FieldShell label="Blocked voice payload" message="Preview only. Runtime synthesis and public voice/sample admission remain blocked.">
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
  const [scheduleInput, setScheduleInput] = useState<LocalPostScheduleInput>(() => createEmptyLocalPostScheduleInput());
  const [schedulePreview, setSchedulePreview] = useState<LocalPostScheduleCandidate | null>(null);
  const [scheduleErrors, setScheduleErrors] = useState<string[]>([]);
  const [assetCandidates, setAssetCandidates] = useState<LocalCreativeAssetCandidate[]>([]);
  const validation = validateLocalPostDraft(draft, agent);

  useEffect(() => {
    setDraft(createEmptyPostDraft());
    setPayloadPreview(null);
    setPublishResult(null);
    setIsPublishing(false);
    setScheduleInput(createEmptyLocalPostScheduleInput());
    setSchedulePreview(null);
    setScheduleErrors([]);
    setAssetCandidates([]);
  }, [agent.id]);

  function updateDraft(patch: Partial<LocalPostDraftInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPayloadPreview(null);
    setPublishResult(null);
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
      <SettingProposalWorkspace agent={agent} />
      <MediaVoiceCandidateWorkspace agent={agent} />
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
