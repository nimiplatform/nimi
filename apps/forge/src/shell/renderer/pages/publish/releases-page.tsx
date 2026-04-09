/**
 * Releases Page (FG-CONTENT-007)
 *
 * Publish workspace built on top of local drafts and existing post primitives.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { LabeledTextField, LabeledTextareaField, LabeledSelectField } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import {
  createRelease,
  listReleases,
  publishRelease,
  updateRelease,
  type PublishDraftAttachment,
  type PublishReleaseDraft,
} from '@renderer/data/content-data-client.js';
import { useCreatorPostsQuery } from '@renderer/hooks/use-content-queries.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';

type ReleaseStatus = 'ALL' | 'DRAFT' | 'PUBLISHED';
type DraftIdentity = 'USER' | 'AGENT';

type DraftAttachmentItem = PublishDraftAttachment;

type PublishDraft = PublishReleaseDraft;

function emptyAttachment(): DraftAttachmentItem {
  return { targetType: 'RESOURCE', targetId: '', displayKind: 'IMAGE' };
}

const STATUS_OPTIONS = [
  { value: 'ALL' as const, label: 'All' },
  { value: 'DRAFT' as const, label: 'DRAFT' },
  { value: 'PUBLISHED' as const, label: 'PUBLISHED' },
];

const IDENTITY_OPTIONS = [
  { value: 'USER', label: 'Creator' },
  { value: 'AGENT', label: 'Agent' },
];

const DISPLAY_KIND_OPTIONS = [
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'TEXT', label: 'Text' },
  { value: 'CARD', label: 'Card' },
];

export default function ReleasesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReleaseStatus>('ALL');
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [identity, setIdentity] = useState<DraftIdentity>('USER');
  const [agentId, setAgentId] = useState('');
  const [attachments, setAttachments] = useState<DraftAttachmentItem[]>([emptyAttachment()]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draftsQuery = useQuery({
    queryKey: ['forge', 'publish', 'drafts', statusFilter],
    retry: false,
    queryFn: async () => await listReleases({ status: statusFilter }),
  });
  const postsQuery = useCreatorPostsQuery({ limit: 8 }, true);
  const agentListQuery = useAgentListQuery(true);

  const drafts: PublishDraft[] = draftsQuery.data ?? [];
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) || null;

  useEffect(() => {
    if (!drafts.length) {
      setSelectedDraftId(null);
      return;
    }
    if (!selectedDraftId || !drafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(drafts[0]?.id || null);
    }
  }, [drafts, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraft) {
      setTitle('');
      setCaption('');
      setTagsInput('');
      setIdentity('USER');
      setAgentId('');
      setAttachments([emptyAttachment()]);
      return;
    }
    setTitle(selectedDraft.title || '');
    setCaption(selectedDraft.caption || '');
    setTagsInput(selectedDraft.tags.join(', '));
    setIdentity(selectedDraft.identity || 'USER');
    setAgentId(selectedDraft.agentId || '');
    setAttachments(selectedDraft.attachments.length > 0 ? selectedDraft.attachments : [emptyAttachment()]);
  }, [selectedDraft]);

  const createDraftMutation = useMutation({
    mutationFn: async () => await createRelease({}),
    onSuccess: async (draft) => {
      await queryClient.invalidateQueries({ queryKey: ['forge', 'publish', 'drafts'] });
      const draftId = String(draft.id || '').trim();
      setSelectedDraftId(draftId || null);
      setNotice(t('releases.draftCreated', 'Draft created.'));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to create draft.');
      setNotice(null);
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (draftId: string) => await updateRelease(draftId, {
      title,
      caption,
      tags: parseTags(tagsInput),
      identity,
      agentId: identity === 'AGENT' ? agentId || null : null,
      attachments: attachments
        .filter((item) => item.targetId.trim())
        .map((item) => ({
          targetType: item.targetType,
          targetId: item.targetId.trim(),
          displayKind: item.displayKind,
        })),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forge', 'publish', 'drafts'] });
      setNotice(t('releases.draftSaved', 'Draft saved.'));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to save draft.');
      setNotice(null);
    },
  });

  const publishDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      await saveDraftMutation.mutateAsync(draftId);
      return await publishRelease(draftId);
    },
    onSuccess: async (draft) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['forge', 'publish', 'drafts'] }),
        queryClient.invalidateQueries({ queryKey: ['forge', 'content', 'posts'] }),
      ]);
      setNotice(
        String(draft.lastPublishedPostId || '').trim()
          ? t('releases.publishSuccess', 'Draft published as a post.')
          : t('releases.publishSuccess', 'Draft published as a post.'),
      );
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to publish draft.');
      setNotice(null);
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (draftId: string) => await updateRelease(draftId, { delete: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forge', 'publish', 'drafts'] });
      setNotice(t('releases.draftDeleted', 'Draft deleted.'));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to delete draft.');
      setNotice(null);
    },
  });

  const agentOptions = (agentListQuery.data || []).map((agent) => ({
    value: agent.id,
    label: agent.displayName || agent.handle,
  }));

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={t('pages.releases')}
        subtitle={t('releases.subtitle', 'Draft posts, choose a publish identity, and review publish history')}
        actions={
          <Button
            tone="primary"
            size="md"
            onClick={() => createDraftMutation.mutate()}
            disabled={createDraftMutation.isPending}
          >
            {t('releases.createRelease', 'New Draft')}
          </Button>
        }
      />

      {error && <ForgeErrorBanner message={error} />}
      {notice && !error && (
        <Surface tone="card" padding="sm" className="border-[var(--nimi-status-success)]">
          <p className="text-sm text-[var(--nimi-status-success)]">{notice}</p>
        </Surface>
      )}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Draft list sidebar */}
        <section className="space-y-4">
          <ForgeSegmentControl
            options={STATUS_OPTIONS.map((o) => ({
              ...o,
              label: o.value === 'ALL' ? t('releases.filterAll', 'All') : o.label,
            }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />

          <div className="space-y-3">
            {!drafts.length && (
              <ForgeEmptyState
                message={t('releases.noReleases', 'No publish drafts yet. Create a draft to prepare a post and publish it as yourself or a selected agent.')}
              />
            )}

            {drafts.map((draft) => (
              <ForgeListCard
                key={draft.id}
                title={draft.title || t('releases.untitledDraft', 'Untitled Draft')}
                subtitle={draft.caption || t('releases.emptyDraftCaption', 'No caption yet.')}
                badges={
                  <ForgeStatusBadge
                    domain="draft"
                    status={draft.status}
                    label={draft.status}
                  />
                }
                actions={
                  <span className="text-[11px] text-[var(--nimi-text-muted)]">
                    {draft.attachments.length} {t('releases.attachments', 'attachments')} · {draft.identity}
                  </span>
                }
                onClick={() => setSelectedDraftId(draft.id)}
                className={selectedDraftId === draft.id ? 'ring-1 ring-[var(--nimi-border-strong)]' : ''}
              />
            ))}
          </div>
        </section>

        {/* Editor panel */}
        <section className="space-y-6">
          <Surface tone="card" padding="md">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('releases.editorTitle', 'Draft Editor')}
                </h2>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t('releases.editorHint', 'Current publish path supports creator-authored posts with canonical attachment targets and preserves RESOURCE, ASSET, and BUNDLE references in local drafts.')}
                </p>
              </div>
              {selectedDraft && (
                <div className="flex gap-2">
                  <Button
                    tone="danger"
                    size="sm"
                    onClick={() => deleteDraftMutation.mutate(selectedDraft.id)}
                    disabled={deleteDraftMutation.isPending}
                  >
                    {t('releases.deleteDraft', 'Delete')}
                  </Button>
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => saveDraftMutation.mutate(selectedDraft.id)}
                    disabled={saveDraftMutation.isPending || publishDraftMutation.isPending}
                  >
                    {t('releases.saveDraft', 'Save Draft')}
                  </Button>
                  <Button
                    tone="primary"
                    size="sm"
                    onClick={() => publishDraftMutation.mutate(selectedDraft.id)}
                    disabled={!selectedDraft || publishDraftMutation.isPending || saveDraftMutation.isPending}
                  >
                    {t('releases.publishNow', 'Publish Now')}
                  </Button>
                </div>
              )}
            </div>

            {!selectedDraft && (
              <ForgeEmptyState
                message={t('releases.selectDraft', 'Create or select a draft to start publishing.')}
              />
            )}

            {selectedDraft && (
              <div className="mt-4 space-y-4">
                <LabeledTextField
                  label={t('releases.title', 'Title')}
                  value={title}
                  onChange={setTitle}
                  placeholder={t('releases.titlePlaceholder', 'Draft title')}
                />

                <LabeledTextareaField
                  label={t('releases.caption', 'Caption')}
                  value={caption}
                  onChange={setCaption}
                  rows={4}
                  placeholder={t('releases.captionPlaceholder', 'Write the text that will accompany the post')}
                />

                <LabeledTextField
                  label={t('releases.tags', 'Tags')}
                  value={tagsInput}
                  onChange={setTagsInput}
                  placeholder={t('releases.tagsPlaceholder', 'fantasy, cover, trailer')}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <LabeledSelectField
                    label={t('releases.identity', 'Publish Identity')}
                    value={identity}
                    options={IDENTITY_OPTIONS}
                    onChange={(v) => setIdentity(v === 'AGENT' ? 'AGENT' : 'USER')}
                  />

                  <LabeledSelectField
                    label={t('releases.agent', 'Agent')}
                    value={agentId}
                    options={[{ value: '', label: t('releases.selectAgent', 'Select agent') }, ...agentOptions]}
                    onChange={setAgentId}
                    disabled={identity !== 'AGENT'}
                  />
                </div>

                {identity === 'AGENT' && (
                  <Surface tone="card" padding="sm" className="border-[var(--nimi-status-warning)]">
                    <p className="text-xs text-[var(--nimi-status-warning)]">
                      {t('releases.agentPublishNotice', 'Agent identity is selectable now, but publishing through the Forge realm client is not wired yet. Save the draft and switch back to Creator to publish today.')}
                    </p>
                  </Surface>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--nimi-text-muted)]">{t('releases.attachments', 'Attachments')}</span>
                    <Button
                      tone="secondary"
                      size="sm"
                      onClick={() => setAttachments((current) => [...current, emptyAttachment()])}
                    >
                      {t('releases.addAttachment', 'Add Attachment')}
                    </Button>
                  </div>

                  {attachments.map((item, index) => (
                    <div key={`${index}-${item.targetId}`} className="grid gap-2 lg:grid-cols-[140px_minmax(0,1fr)_80px]">
                      <LabeledSelectField
                        label=""
                        value={item.displayKind}
                        options={DISPLAY_KIND_OPTIONS.map((o) => ({
                          ...o,
                          label: t(`releases.attachment${o.value.charAt(0) + o.value.slice(1).toLowerCase()}`, o.label),
                        }))}
                        onChange={(v) => setAttachments((current) => current.map((entry, entryIndex) => (
                          entryIndex === index
                            ? {
                                ...entry,
                                displayKind: (
                                  ['VIDEO', 'AUDIO', 'TEXT', 'CARD'].includes(v) ? v : 'IMAGE'
                                ) as DraftAttachmentItem['displayKind'],
                              }
                            : entry
                        )))}
                      />
                      <LabeledTextField
                        label=""
                        value={item.targetId}
                        onChange={(v) => setAttachments((current) => current.map((entry, entryIndex) => (
                          entryIndex === index
                            ? { ...entry, targetId: v }
                            : entry
                        )))}
                        placeholder={t('releases.attachmentTargetIdPlaceholder', 'Selected attachment target id')}
                      />
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => setAttachments((current) => {
                          const next = current.filter((_, entryIndex) => entryIndex !== index);
                          return next.length > 0 ? next : [emptyAttachment()];
                        })}
                      >
                        {t('releases.removeAttachment', 'Remove')}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Surface>

          <Surface tone="card" padding="md">
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('releases.historyTitle', 'Recent Published Posts')}
            </h2>
            <div className="mt-4 space-y-3">
              {(postsQuery.data || []).slice(0, 6).map((post) => (
                <ForgeListCard
                  key={post.id}
                  title={post.caption || t('releases.untitledPost', 'Untitled post')}
                  subtitle={post.tags.join(', ') || t('releases.noTags', 'No tags')}
                  actions={
                    <span className="text-[11px] text-[var(--nimi-text-muted)]">
                      {post.attachments.length} {t('releases.attachments', 'attachments')}
                    </span>
                  }
                />
              ))}
              {!postsQuery.data?.length && (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('releases.noPublishedPosts', 'No published posts yet.')}
                </p>
              )}
            </div>
          </Surface>
        </section>
      </div>
    </ForgePage>
  );
}

function parseTags(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
