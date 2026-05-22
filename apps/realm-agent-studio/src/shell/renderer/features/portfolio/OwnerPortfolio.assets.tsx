import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, EmptyState, FieldShell, InlineAlert, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  generateReviewedVisualImageCandidate,
  selectReviewedAgentAvatarUrl,
  synthesizeReviewedVoiceDemo,
  type RealmAgentAvatarSelectResult,
  type RuntimeVisualImageGenerationResult,
  type RuntimeVoiceDemoSynthesisResult,
} from './portfolio-client.js';
import {
  uploadReviewedIdentityMediaResource,
  type DirectMediaResourceUploadResult,
} from './portfolio-client.js';
import {
  MEDIA_CANDIDATE_BINDING_POINTS,
  MEDIA_CANDIDATE_RESOURCE_TYPES,
  VISUAL_IMAGE_CANDIDATE_NOTICE,
  VOICE_DEMO_CANDIDATE_NOTICE,
  VISUAL_MEDIA_BLOCKED_REASON,
  buildBlockedVisualAssetCandidatePayload,
  buildReviewedVisualImageCandidatePayload,
  buildReviewedVoiceDemoCandidatePayload,
  type MediaCandidateBindingPoint,
  type VisualCandidateResourceType,
  type VisualMediaCandidateInput,
  type VoiceDemoCandidateInput,
} from './media-voice-candidate.js';
import {
  appendLocalCreativeAssetHistory,
  loadLocalCreativeAssetHistory,
  type CreativeAssetHistoryRecord,
} from './creative-asset-history.js';
import { TechnicalReviewDetails } from './OwnerPortfolio.shared.js';

export function createVisualMediaCandidateInput(): VisualMediaCandidateInput {
  return {
    resourceType: 'IMAGE',
    bindingPoint: 'AGENT_CANDIDATE',
    prompt: '',
    notes: '',
  };
}

export function createVisualImageGenerationDraft(): VisualMediaCandidateInput & { model: string; aspectRatio: string } {
  return {
    ...createVisualMediaCandidateInput(),
    model: import.meta.env.VITE_RUNTIME_IMAGE_MODEL || '',
    aspectRatio: '1:1',
  };
}

export function createVoiceDemoCandidateInput(agent: OwnerPortfolioAgentDetail): VoiceDemoCandidateInput {
  return {
    scriptText: agent.greeting.value || '',
    model: import.meta.env.VITE_RUNTIME_TTS_MODEL || '',
  };
}

export function MediaVoiceCandidateWorkspace({ agent, onAgentWrite }: { agent: OwnerPortfolioAgentDetail; onAgentWrite: () => Promise<void> }) {
  const [visualDraft, setVisualDraft] = useState<VisualMediaCandidateInput>(() => createVisualMediaCandidateInput());
  const [visualImageDraft, setVisualImageDraft] = useState(() => createVisualImageGenerationDraft());
  const [visualImageResult, setVisualImageResult] = useState<RuntimeVisualImageGenerationResult | null>(null);
  const [isGeneratingVisualImage, setIsGeneratingVisualImage] = useState(false);
  const [identityUploadReviewed, setIdentityUploadReviewed] = useState(false);
  const [identityUploadFile, setIdentityUploadFile] = useState<File | null>(null);
  const [identityUploadResult, setIdentityUploadResult] = useState<DirectMediaResourceUploadResult | null>(null);
  const [isUploadingIdentityResource, setIsUploadingIdentityResource] = useState(false);
  const [creativeHistory, setCreativeHistory] = useState<CreativeAssetHistoryRecord[]>([]);
  const [avatarUrlDraft, setAvatarUrlDraft] = useState(() => agent.avatarUrl || '');
  const [avatarReviewed, setAvatarReviewed] = useState(false);
  const [avatarResult, setAvatarResult] = useState<RealmAgentAvatarSelectResult | null>(null);
  const [isSelectingAvatar, setIsSelectingAvatar] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDemoCandidateInput>(() => createVoiceDemoCandidateInput(agent));
  const [voiceResult, setVoiceResult] = useState<RuntimeVoiceDemoSynthesisResult | null>(null);
  const [isSynthesizingVoice, setIsSynthesizingVoice] = useState(false);
  const visualPayload = useMemo(() => buildBlockedVisualAssetCandidatePayload(visualDraft, agent), [agent, visualDraft]);
  const visualImagePayload = useMemo(() => buildReviewedVisualImageCandidatePayload(visualImageDraft, agent), [agent, visualImageDraft]);
  const voicePayload = useMemo(() => buildReviewedVoiceDemoCandidatePayload(voiceDraft, agent), [agent, voiceDraft]);
  const avatarUrlChanged = avatarUrlDraft.trim() !== (agent.avatarUrl || '');
  const visualResourceTypes = MEDIA_CANDIDATE_RESOURCE_TYPES.filter((resourceType): resourceType is VisualCandidateResourceType => resourceType === 'IMAGE');
  const visualBindingPoints = MEDIA_CANDIDATE_BINDING_POINTS.filter((bindingPoint) => bindingPoint !== 'AGENT_VOICE_SAMPLE');

  useEffect(() => {
    setVisualDraft(createVisualMediaCandidateInput());
    setVisualImageDraft(createVisualImageGenerationDraft());
    setVisualImageResult(null);
    setIsGeneratingVisualImage(false);
    setIdentityUploadReviewed(false);
    setIdentityUploadFile(null);
    setIdentityUploadResult(null);
    setIsUploadingIdentityResource(false);
    setCreativeHistory(loadLocalCreativeAssetHistory(agent.id));
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
    setVisualImageDraft((current) => ({ ...current, ...patch }));
    setVisualImageResult(null);
  }

  function updateVisualImageDraft(patch: Partial<typeof visualImageDraft>) {
    setVisualImageDraft((current) => ({ ...current, ...patch }));
    setVisualImageResult(null);
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

  async function generateVisualImageCandidate() {
    setIsGeneratingVisualImage(true);
    setVisualImageResult(null);
    try {
      const result = await generateReviewedVisualImageCandidate(visualImageDraft, agent);
      setVisualImageResult(result);
      if (result.ok) {
        setCreativeHistory(appendLocalCreativeAssetHistory(agent.id, {
          kind: 'runtime-image-candidate',
          label: 'Runtime image candidate',
          source: result.source,
          detail: result.runtime.artifactUris[0] || result.runtime.artifactIds[0] || result.runtime.jobId || 'image artifact generated',
          artifactIds: result.runtime.artifactIds,
          ...(result.runtime.traceId ? { traceId: result.runtime.traceId } : {}),
        }));
      }
    } finally {
      setIsGeneratingVisualImage(false);
    }
  }

  async function uploadIdentityResource() {
    if (!identityUploadFile) {
      setIdentityUploadResult({
        ok: false,
        source: 'Realm ResourcesService direct upload + finalizeResource',
        attachmentTruth: false,
        publicTruth: false,
        failure: 'media-upload-file-invalid',
        message: 'Reviewed identity Resource upload requires a selected image file.',
        submitted: null,
      });
      return;
    }

    setIsUploadingIdentityResource(true);
    setIdentityUploadResult(null);
    try {
      const result = await uploadReviewedIdentityMediaResource({
        resourceType: 'IMAGE',
        file: identityUploadFile,
        agent,
        tags: ['realm-agent-studio', 'identity-candidate'],
      });
      setIdentityUploadResult(result);
      if (result.ok) {
        setCreativeHistory(appendLocalCreativeAssetHistory(agent.id, {
          kind: 'identity-resource-upload',
          label: 'Identity Resource upload',
          source: result.source,
          detail: result.canonical.id,
          resourceId: result.canonical.id,
        }));
      }
    } finally {
      setIsUploadingIdentityResource(false);
    }
  }

  async function synthesizeVoiceDemo() {
    setIsSynthesizingVoice(true);
    setVoiceResult(null);
    try {
      const result = await synthesizeReviewedVoiceDemo(voiceDraft, agent);
      setVoiceResult(result);
      if (result.ok) {
        setCreativeHistory(appendLocalCreativeAssetHistory(agent.id, {
          kind: 'voice-demo-candidate',
          label: 'Voice demo candidate',
          source: result.source,
          detail: result.runtime.artifactIds[0] || result.runtime.jobId || 'voice artifact generated',
          artifactIds: result.runtime.artifactIds,
          ...(result.runtime.traceId ? { traceId: result.runtime.traceId } : {}),
        }));
      }
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
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">Runtime image candidate</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Generate one reviewed visual candidate for local history. Public profile binding remains separate.
                  </div>
                </div>
                <StatusBadge tone="info">AI candidate</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_150px]">
                <FieldShell label="Image model" message="Configured Runtime image model.">
                  <TextField
                    value={visualImageDraft.model}
                    placeholder="Configured Runtime image model"
                    onChange={(event) => updateVisualImageDraft({ model: event.currentTarget.value })}
                  />
                </FieldShell>
                <FieldShell label="Aspect ratio">
                  <SelectField
                    value={visualImageDraft.aspectRatio}
                    options={[
                      { value: '1:1', label: '1:1' },
                      { value: '4:5', label: '4:5' },
                      { value: '16:9', label: '16:9' },
                    ]}
                    onValueChange={(value) => updateVisualImageDraft({ aspectRatio: value })}
                  />
                </FieldShell>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={!visualImagePayload.changed || isGeneratingVisualImage}
                  loading={isGeneratingVisualImage}
                  onClick={() => void generateVisualImageCandidate()}
                >
                  Generate image candidate
                </Button>
              </div>
              <InlineAlert tone={visualImagePayload.changed ? 'info' : 'warning'} className="mt-3">
                {visualImagePayload.changed ? VISUAL_IMAGE_CANDIDATE_NOTICE : visualImagePayload.errors.join('; ')}
              </InlineAlert>
              {visualImageResult ? (
                <InlineAlert tone={visualImageResult.ok ? 'success' : 'danger'} className="mt-3">
                  {visualImageResult.ok
                    ? 'Image candidate generated for local review. It has not been published to the profile.'
                    : visualImageResult.message}
                </InlineAlert>
              ) : null}
              {visualImageResult?.ok ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Surface tone="panel" padding="md">
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Generated artifacts</div>
                    <div className="ras-break-anywhere mt-1 font-medium">
                      {visualImageResult.runtime.artifactUris.concat(visualImageResult.runtime.artifactIds).join(', ') || 'artifact unavailable'}
                    </div>
                  </Surface>
                  <Surface tone="panel" padding="md">
                    <div className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">Public state</div>
                    <div className="mt-1 font-medium">Candidate only</div>
                  </Surface>
                </div>
              ) : null}
              <TechnicalReviewDetails title="Image generation request details">
                <pre className="ras-json-preview m-0 min-h-32 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                  {visualImagePayload.payload ? JSON.stringify(visualImagePayload.payload.runtime.request, null, 2) : visualImagePayload.errors.join('; ')}
                </pre>
              </TechnicalReviewDetails>
            </Surface>
            <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">Upload identity Resource</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Upload an owner-reviewed image as a READY Resource for local identity review. It is not a profile binding.
                  </div>
                </div>
                <StatusBadge tone="info">Resource upload</StatusBadge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <FieldShell label="Identity image" message={identityUploadReviewed ? 'Owner-reviewed image only.' : 'Human review complete is required before upload.'} messageTone={identityUploadReviewed ? 'neutral' : 'danger'}>
                  <TextField
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      setIdentityUploadFile(event.currentTarget.files?.[0] ?? null);
                      setIdentityUploadResult(null);
                    }}
                  />
                </FieldShell>
                <div className="flex items-end">
                  <Checkbox
                    checked={identityUploadReviewed}
                    onChange={(event) => setIdentityUploadReviewed(event.currentTarget.checked)}
                    label="Human review complete"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  disabled={!identityUploadReviewed || !identityUploadFile || isUploadingIdentityResource}
                  loading={isUploadingIdentityResource}
                  onClick={() => void uploadIdentityResource()}
                >
                  Upload identity Resource
                </Button>
              </div>
              {identityUploadResult ? (
                <InlineAlert tone={identityUploadResult.ok ? 'success' : 'danger'} className="mt-3">
                  {identityUploadResult.ok
                    ? `Identity Resource uploaded for local review as ${identityUploadResult.canonical.id}. Public profile binding remains deferred.`
                    : identityUploadResult.message}
                </InlineAlert>
              ) : null}
              {identityUploadResult ? (
                <TechnicalReviewDetails title="Identity upload response">
                  <pre className="ras-json-preview m-0 min-h-24 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                    {JSON.stringify(identityUploadResult, null, 2)}
                  </pre>
                </TechnicalReviewDetails>
              ) : null}
            </Surface>
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
      <Surface tone="card" padding="md" className="mt-5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">Local creative history</div>
            <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
              Candidate history is stored on this desktop device and does not publish profile assets.
            </div>
          </div>
          <StatusBadge tone="warning">app-local</StatusBadge>
        </div>
        {creativeHistory.length === 0 ? (
          <EmptyState title="No creative history" description="Generate or upload a reviewed candidate to add local history." />
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {creativeHistory.map((record) => (
              <Surface key={record.id} tone="panel" padding="md">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{record.label}</div>
                  <StatusBadge tone="warning">local only</StatusBadge>
                </div>
                <div className="ras-break-anywhere mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                  {record.detail}
                </div>
                <div className="ras-break-anywhere mt-2 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                  {record.source}
                </div>
              </Surface>
            ))}
          </div>
        )}
      </Surface>
    </Surface>
  );
}
