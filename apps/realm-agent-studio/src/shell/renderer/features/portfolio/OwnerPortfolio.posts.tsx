import { useEffect, useState } from 'react';
import { Button, Checkbox, EmptyState, FieldShell, InlineAlert, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  createReviewedPostTextResource,
  listReadyPostAttachmentResources,
  proposeReviewedPostCopy,
  publishReviewedPostDraft,
  uploadReviewedPostMediaResource,
  type DirectMediaResourceType,
  type DirectMediaResourceUploadResult,
  type PostAttachmentResourceOption,
  type RealmPostPublishResult,
  type RealmTextResourceCreateResult,
  type RuntimePostCopyProposalResult,
} from './portfolio-client.js';
import {
  ATTACHMENT_TARGET_TYPES,
  applyRuntimePostCopyProposal,
  buildLocalPostScheduleCandidate,
  validateLocalPostDraft,
  type AttachmentTargetType,
  type CandidatePostPayload,
  type LocalPostDraftInput,
  type LocalPostScheduleCandidate,
  type LocalPostScheduleInput,
} from './post-draft.js';
import {
  clearLocalPostSchedule,
  isLocalPostScheduleDue,
  loadLocalPostSchedule,
  saveLocalPostSchedule,
  type LocalPostScheduleRecord,
} from './local-post-schedule-store.js';
import { TechnicalReviewDetails } from './OwnerPortfolio.shared.js';

type LocalCreativeAssetCandidate = {
  sequence: number;
  label: string;
  captionSnapshot: string;
  tagsSnapshot: string;
};

export function createEmptyPostDraft(): LocalPostDraftInput {
  return {
    caption: '',
    tagsText: '',
    humanReviewed: false,
    attachmentEnabled: false,
    attachmentTargetType: 'RESOURCE',
    attachmentTargetId: '',
  };
}

export function createEmptyLocalPostScheduleInput(): LocalPostScheduleInput {
  return {
    localDate: '',
    localTime: '',
  };
}

export function CreativePostWorkspace({ agent, mode }: { agent: OwnerPortfolioAgentDetail; mode: 'posts' | 'schedule' }) {
  const [draft, setDraft] = useState<LocalPostDraftInput>(() => createEmptyPostDraft());
  const [postCopyIntent, setPostCopyIntent] = useState('');
  const [postCopyResult, setPostCopyResult] = useState<RuntimePostCopyProposalResult | null>(null);
  const [isProposingPostCopy, setIsProposingPostCopy] = useState(false);
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
  const [savedSchedule, setSavedSchedule] = useState<LocalPostScheduleRecord | null>(null);
  const [schedulePublishResult, setSchedulePublishResult] = useState<RealmPostPublishResult | null>(null);
  const [isPublishingSchedule, setIsPublishingSchedule] = useState(false);
  const [scheduleErrors, setScheduleErrors] = useState<string[]>([]);
  const [assetCandidates, setAssetCandidates] = useState<LocalCreativeAssetCandidate[]>([]);
  const validation = validateLocalPostDraft(draft, agent);
  const postTextResourceDraft = validateLocalPostDraft({ ...draft, attachmentEnabled: false, attachmentTargetId: '' }, agent);
  const isScheduleWorkspace = mode === 'schedule';

  useEffect(() => {
    setDraft(createEmptyPostDraft());
    setPostCopyIntent('');
    setPostCopyResult(null);
    setIsProposingPostCopy(false);
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
    setSavedSchedule(loadLocalPostSchedule(agent.id));
    setSchedulePublishResult(null);
    setIsPublishingSchedule(false);
    setScheduleErrors([]);
    setAssetCandidates([]);
  }, [agent.id]);

  function updateDraft(patch: Partial<LocalPostDraftInput>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPayloadPreview(null);
    setPublishResult(null);
    setTextResourceResult(null);
    setPostCopyResult(null);
    setResourceListStatus(null);
    setMediaUploadResult(null);
    setSchedulePreview(null);
    setSchedulePublishResult(null);
    setScheduleErrors([]);
  }

  function updateScheduleInput(patch: Partial<LocalPostScheduleInput>) {
    setScheduleInput((current) => ({ ...current, ...patch }));
    setSchedulePreview(null);
    setSchedulePublishResult(null);
    setScheduleErrors([]);
  }

  async function requestPostCopyProposal() {
    setIsProposingPostCopy(true);
    setPostCopyResult(null);
    try {
      const result = await proposeReviewedPostCopy(agent, draft, postCopyIntent);
      setPostCopyResult(result);
    } finally {
      setIsProposingPostCopy(false);
    }
  }

  function applyPostCopyProposal() {
    if (!postCopyResult?.ok) {
      return;
    }
    setDraft((current) => applyRuntimePostCopyProposal(current, postCopyResult.proposal));
    setPayloadPreview(null);
    setPublishResult(null);
    setSchedulePreview(null);
    setSchedulePublishResult(null);
  }

  function saveScheduleCandidate() {
    if (!schedulePreview) {
      return;
    }
    setSavedSchedule(saveLocalPostSchedule(agent.id, schedulePreview));
    setSchedulePublishResult(null);
  }

  async function publishSavedSchedule() {
    if (!savedSchedule || !isLocalPostScheduleDue(savedSchedule)) {
      return;
    }
    setIsPublishingSchedule(true);
    setSchedulePublishResult(null);
    try {
      const result = await publishReviewedPostDraft(savedSchedule.candidate.postCandidate);
      setSchedulePublishResult(result);
      if (result.ok) {
        clearLocalPostSchedule(agent.id);
        setSavedSchedule(null);
      }
    } finally {
      setIsPublishingSchedule(false);
    }
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
            {!isScheduleWorkspace ? <Surface tone="card" padding="md">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">Runtime post copy</div>
                  <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                    Draft caption and tags as editable candidate text. Human review is still required before publish.
                  </div>
                </div>
                <StatusBadge tone="info">AI candidate</StatusBadge>
              </div>
              <FieldShell label="Post copy intent" message="Describe the agent-authored post you want.">
                <TextareaField
                  value={postCopyIntent}
                  placeholder="Describe the post copy you want"
                  onChange={(event) => {
                    setPostCopyIntent(event.currentTarget.value);
                    setPostCopyResult(null);
                  }}
                />
              </FieldShell>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  tone="secondary"
                  disabled={!postCopyIntent.trim() || isProposingPostCopy}
                  loading={isProposingPostCopy}
                  onClick={() => void requestPostCopyProposal()}
                >
                  Ask Runtime for post copy
                </Button>
              </div>
              {postCopyResult ? (
                <Surface tone="panel" padding="md" className="mt-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">Post copy proposal</div>
                      <div className="ras-break-anywhere mt-1 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
                        {postCopyResult.ok ? postCopyResult.proposal.rationale : postCopyResult.message}
                      </div>
                    </div>
                    <StatusBadge tone={postCopyResult.ok ? 'info' : 'danger'}>
                      {postCopyResult.ok ? 'candidate' : 'unavailable'}
                    </StatusBadge>
                  </div>
                  {postCopyResult.ok ? (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {postCopyResult.proposal.changedPostKeys.map((key) => (
                          <StatusBadge key={key} tone="neutral">{key}</StatusBadge>
                        ))}
                      </div>
                      <InlineAlert tone="info" className="mt-3">
                        Runtime copy is candidate material only. Apply it, review the post, then publish through Realm.
                      </InlineAlert>
                      <div className="mt-3">
                        <Button onClick={applyPostCopyProposal}>Apply post copy</Button>
                      </div>
                    </>
                  ) : (
                    <InlineAlert tone="danger" className="mt-3">
                      Draft fields were preserved. Edit manually or retry after Runtime text generation is available.
                    </InlineAlert>
                  )}
                </Surface>
              ) : null}
            </Surface> : null}
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
              <div className="mt-3 flex flex-wrap gap-3">
                <Button disabled={!schedulePreview} onClick={saveScheduleCandidate}>
                  Save local schedule
                </Button>
                <Button
                  disabled={!savedSchedule || !isLocalPostScheduleDue(savedSchedule) || isPublishingSchedule}
                  loading={isPublishingSchedule}
                  onClick={() => void publishSavedSchedule()}
                >
                  Publish due schedule
                </Button>
              </div>
              {savedSchedule ? (
                <InlineAlert tone={isLocalPostScheduleDue(savedSchedule) ? 'info' : 'success'} className="mt-3">
                  {isLocalPostScheduleDue(savedSchedule)
                    ? 'Saved local schedule is due. Publish due schedule will call Realm Create Post now.'
                    : `Saved local schedule for ${savedSchedule.localRunAt}. It will be executable here when due.`}
                </InlineAlert>
              ) : null}
              {schedulePublishResult ? (
                <InlineAlert tone={schedulePublishResult.ok ? 'success' : 'danger'} className="mt-3">
                  {schedulePublishResult.ok
                    ? 'Due local schedule published through Realm and cleared from local storage.'
                    : schedulePublishResult.message}
                </InlineAlert>
              ) : null}
              <TechnicalReviewDetails title="Local schedule payload">
                <pre className="ras-json-preview m-0 min-h-28 overflow-auto rounded-[var(--nimi-radius-field)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs">
                  {schedulePreview ? JSON.stringify(schedulePreview, null, 2) : savedSchedule ? JSON.stringify(savedSchedule, null, 2) : 'No local schedule preview yet.'}
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
                This workspace stores one reviewed local scheduled candidate on this device. It executes only in the foreground when due, and Realm publish is the only public success state.
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
