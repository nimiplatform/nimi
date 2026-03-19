/**
 * Releases Page (FG-CONTENT-007)
 *
 * Publish workspace built on top of local drafts and existing post primitives.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createRelease,
  listReleases,
  publishRelease,
  updateRelease,
  type PublishReleaseDraft,
} from '@renderer/data/content-data-client.js';
import { useCreatorPostsQuery } from '@renderer/hooks/use-content-queries.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';

type ReleaseStatus = 'ALL' | 'DRAFT' | 'PUBLISHED';
type DraftMediaType = 'IMAGE' | 'VIDEO';
type DraftIdentity = 'USER' | 'AGENT';

type DraftMediaItem = {
  assetId: string;
  type: DraftMediaType;
};

type PublishDraft = PublishReleaseDraft;

function emptyMedia(): DraftMediaItem {
  return { assetId: '', type: 'IMAGE' };
}

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
  const [media, setMedia] = useState<DraftMediaItem[]>([emptyMedia()]);
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
      setMedia([emptyMedia()]);
      return;
    }
    setTitle(selectedDraft.title || '');
    setCaption(selectedDraft.caption || '');
    setTagsInput(selectedDraft.tags.join(', '));
    setIdentity(selectedDraft.identity || 'USER');
    setAgentId(selectedDraft.agentId || '');
    setMedia(selectedDraft.media.length > 0 ? selectedDraft.media : [emptyMedia()]);
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
      media: media
        .filter((item) => item.assetId.trim())
        .map((item) => ({ assetId: item.assetId.trim(), type: item.type })),
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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.releases')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('releases.subtitle', 'Draft posts, choose a publish identity, and review publish history')}
            </p>
          </div>
          <button
            onClick={() => createDraftMutation.mutate()}
            disabled={createDraftMutation.isPending}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity disabled:opacity-60"
          >
            {t('releases.createRelease', 'New Draft')}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="space-y-4">
            <div className="flex rounded-lg border border-neutral-700 overflow-hidden w-fit">
              {(['ALL', 'DRAFT', 'PUBLISHED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    statusFilter === status
                      ? 'bg-white text-black'
                      : 'bg-neutral-900 text-neutral-400 hover:text-white'
                  }`}
                >
                  {status === 'ALL' ? t('releases.filterAll', 'All') : status}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {!drafts.length && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-center">
                  <p className="text-sm text-neutral-400">
                    {t('releases.noReleases', 'No publish drafts yet. Create a draft to prepare a post and publish it as yourself or a selected agent.')}
                  </p>
                  <p className="mt-2 text-xs text-neutral-600">
                    {t('releases.releaseHint', 'Drafts stay in Forge app state. Published history will be derived from existing post and feed queries.')}
                  </p>
                </div>
              )}

              {drafts.map((draft) => (
                <button
                  key={draft.id}
                  onClick={() => setSelectedDraftId(draft.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                    selectedDraftId === draft.id
                      ? 'border-white bg-white/10'
                      : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">
                      {draft.title || t('releases.untitledDraft', 'Untitled Draft')}
                    </p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      draft.status === 'PUBLISHED'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-neutral-800 text-neutral-400'
                    }`}>
                      {draft.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-neutral-400">
                    {draft.caption || t('releases.emptyDraftCaption', 'No caption yet.')}
                  </p>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    {draft.media.length} {t('releases.assets', 'assets')} · {draft.identity}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    {t('releases.editorTitle', 'Draft Editor')}
                  </h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    {t('releases.editorHint', 'Current publish path supports creator-authored posts with image/video assets.')}
                  </p>
                </div>
                {selectedDraft && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteDraftMutation.mutate(selectedDraft.id)}
                      disabled={deleteDraftMutation.isPending}
                      className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 disabled:opacity-60"
                    >
                      {t('releases.deleteDraft', 'Delete')}
                    </button>
                    <button
                      onClick={() => saveDraftMutation.mutate(selectedDraft.id)}
                      disabled={saveDraftMutation.isPending || publishDraftMutation.isPending}
                      className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {t('releases.saveDraft', 'Save Draft')}
                    </button>
                    <button
                      onClick={() => publishDraftMutation.mutate(selectedDraft.id)}
                      disabled={!selectedDraft || publishDraftMutation.isPending || saveDraftMutation.isPending}
                      className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black disabled:opacity-60"
                    >
                      {t('releases.publishNow', 'Publish Now')}
                    </button>
                  </div>
                )}
              </div>

              {!selectedDraft && (
                <div className="mt-4 rounded-lg border border-dashed border-neutral-700 px-4 py-8 text-center text-sm text-neutral-500">
                  {t('releases.selectDraft', 'Create or select a draft to start publishing.')}
                </div>
              )}

              {selectedDraft && (
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">{t('releases.title', 'Title')}</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                      placeholder={t('releases.titlePlaceholder', 'Draft title')}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">{t('releases.caption', 'Caption')}</span>
                    <textarea
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                      placeholder={t('releases.captionPlaceholder', 'Write the text that will accompany the post')}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">{t('releases.tags', 'Tags')}</span>
                    <input
                      value={tagsInput}
                      onChange={(event) => setTagsInput(event.target.value)}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                      placeholder={t('releases.tagsPlaceholder', 'fantasy, cover, trailer')}
                    />
                  </label>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-neutral-400">{t('releases.identity', 'Publish Identity')}</span>
                      <select
                        value={identity}
                        onChange={(event) => setIdentity(event.target.value === 'AGENT' ? 'AGENT' : 'USER')}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                      >
                        <option value="USER">{t('releases.identityUser', 'Creator')}</option>
                        <option value="AGENT">{t('releases.identityAgent', 'Agent')}</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs text-neutral-400">{t('releases.agent', 'Agent')}</span>
                      <select
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                        disabled={identity !== 'AGENT'}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500 disabled:opacity-50"
                      >
                        <option value="">{t('releases.selectAgent', 'Select agent')}</option>
                        {(agentListQuery.data || []).map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.displayName || agent.handle}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {identity === 'AGENT' && (
                    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-300">
                      {t('releases.agentPublishNotice', 'Agent identity is selectable now, but publishing through the Forge realm client is not wired yet. Save the draft and switch back to Creator to publish today.')}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400">{t('releases.media', 'Media Assets')}</span>
                      <button
                        onClick={() => setMedia((current) => [...current, emptyMedia()])}
                        className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs font-medium text-neutral-200"
                      >
                        {t('releases.addAsset', 'Add Asset')}
                      </button>
                    </div>

                    {media.map((item, index) => (
                      <div key={`${index}-${item.assetId}`} className="grid gap-2 lg:grid-cols-[140px_minmax(0,1fr)_80px]">
                        <select
                          value={item.type}
                          onChange={(event) => setMedia((current) => current.map((entry, entryIndex) => (
                            entryIndex === index
                              ? { ...entry, type: event.target.value === 'VIDEO' ? 'VIDEO' : 'IMAGE' }
                              : entry
                          )))}
                          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                        >
                          <option value="IMAGE">{t('releases.mediaImage', 'Image')}</option>
                          <option value="VIDEO">{t('releases.mediaVideo', 'Video')}</option>
                        </select>
                        <input
                          value={item.assetId}
                          onChange={(event) => setMedia((current) => current.map((entry, entryIndex) => (
                            entryIndex === index
                              ? { ...entry, assetId: event.target.value }
                              : entry
                          )))}
                          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
                          placeholder={t('releases.assetIdPlaceholder', 'Selected media asset id')}
                        />
                        <button
                          onClick={() => setMedia((current) => {
                            const next = current.filter((_, entryIndex) => entryIndex !== index);
                            return next.length > 0 ? next : [emptyMedia()];
                          })}
                          className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300"
                        >
                          {t('releases.removeAsset', 'Remove')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-white">
                {t('releases.historyTitle', 'Recent Published Posts')}
              </h2>
              <div className="mt-4 space-y-3">
                {(postsQuery.data || []).slice(0, 6).map((post) => (
                  <div key={post.id} className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-white">{post.caption || t('releases.untitledPost', 'Untitled post')}</p>
                      <span className="text-[11px] text-neutral-500">{post.media.length} {t('releases.assets', 'assets')}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">
                      {post.tags.join(', ') || t('releases.noTags', 'No tags')}
                    </p>
                  </div>
                ))}
                {!postsQuery.data?.length && (
                  <p className="text-sm text-neutral-500">
                    {t('releases.noPublishedPosts', 'No published posts yet.')}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function parseTags(input: string) {
  return input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
