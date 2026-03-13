/**
 * Content Library Page (FG-CONTENT-003)
 *
 * Unified asset browser for images, videos, and audio.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useCreatorPostsQuery, type PostSummary } from '@renderer/hooks/use-content-queries.js';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';

type AssetType = 'ALL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
type ViewMode = 'grid' | 'list';

export default function ContentLibraryPage() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const postsQuery = useCreatorPostsQuery({ limit: 50 });
  const posts = postsQuery.data || [];
  const { deletePostMutation } = useContentMutations();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AssetType>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Flatten posts into individual media assets
  const allAssets = useMemo(() => {
    const assets: Array<{
      id: string;
      type: 'IMAGE' | 'VIDEO' | 'AUDIO';
      postId: string;
      caption: string;
      tags: string[];
      createdAt: string;
    }> = [];

    posts.forEach((post) => {
      post.media.forEach((m) => {
        assets.push({
          id: m.assetId,
          type: m.type,
          postId: post.id,
          caption: post.caption,
          tags: post.tags,
          createdAt: post.createdAt,
        });
      });
    });

    return assets;
  }, [posts]);

  const filtered = useMemo(() => {
    let list = allAssets;
    if (typeFilter !== 'ALL') {
      list = list.filter((a) => a.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.caption.toLowerCase().includes(q) ||
          a.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [allAssets, typeFilter, search]);

  async function handleDeleteSelected() {
    const postIds = new Set<string>();
    for (const asset of allAssets) {
      if (selectedIds.has(asset.id)) {
        postIds.add(asset.postId);
      }
    }
    for (const postId of postIds) {
      await deletePostMutation.mutateAsync(postId);
    }
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['forge', 'content', 'posts'] });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.contentLibrary')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('contentLibrary.subtitle', 'Browse and manage all your media assets')}
            </p>
          </div>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">
                {t('contentLibrary.selected', { count: selectedIds.size })}
              </span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="rounded px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors"
              >
                {t('contentLibrary.clear', 'Clear')}
              </button>
              <button
                onClick={() => void handleDeleteSelected()}
                disabled={deletePostMutation.isPending}
                className="rounded px-3 py-1.5 text-xs font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {deletePostMutation.isPending ? t('contentLibrary.deleting', 'Deleting...') : t('contentLibrary.delete', 'Delete')}
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={t('contentLibrary.searchPlaceholder', 'Search assets...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
            {(['ALL', 'IMAGE', 'VIDEO', 'AUDIO'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  typeFilter === filter
                    ? 'bg-white text-black'
                    : 'bg-neutral-900 text-neutral-400 hover:text-white'
                }`}
              >
                {filter === 'ALL' ? t('contentLibrary.filterAll', 'All') :
                 filter === 'IMAGE' ? t('contentLibrary.filterImage', 'Images') :
                 filter === 'VIDEO' ? t('contentLibrary.filterVideo', 'Videos') :
                 t('contentLibrary.filterAudio', 'Audio')}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-neutral-700 overflow-hidden">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-white text-black'
                    : 'bg-neutral-900 text-neutral-400 hover:text-white'
                }`}
              >
                {mode === 'grid' ? '⊞' : '☰'}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {postsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-12 text-center">
            <div className="text-4xl text-neutral-700 mb-2">📁</div>
            <p className="text-sm text-neutral-500">
              {allAssets.length === 0
                ? t('contentLibrary.noAssets', 'No content yet. Create images, videos, or music to build your library.')
                : t('contentLibrary.noResults', 'No assets match your filters.')}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((asset) => (
              <div
                key={asset.id}
                onClick={() => toggleSelect(asset.id)}
                className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-colors ${
                  selectedIds.has(asset.id)
                    ? 'border-white ring-1 ring-white'
                    : 'border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="aspect-square bg-neutral-900 flex items-center justify-center">
                  <span className="text-2xl text-neutral-700">
                    {asset.type === 'IMAGE' ? '🖼️' : asset.type === 'VIDEO' ? '📹' : '🎵'}
                  </span>
                </div>
                <div className="absolute top-2 right-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    asset.type === 'IMAGE' ? 'bg-purple-500/20 text-purple-400' :
                    asset.type === 'VIDEO' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {asset.type}
                  </span>
                </div>
                <div className="p-2">
                  <p className="text-xs text-neutral-400 truncate">{asset.caption || 'Untitled'}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((asset) => (
              <div
                key={asset.id}
                onClick={() => toggleSelect(asset.id)}
                className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 cursor-pointer transition-colors ${
                  selectedIds.has(asset.id)
                    ? 'border-white bg-white/5'
                    : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                }`}
              >
                <span className="text-lg">
                  {asset.type === 'IMAGE' ? '🖼️' : asset.type === 'VIDEO' ? '📹' : '🎵'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{asset.caption || 'Untitled'}</p>
                  <p className="text-xs text-neutral-500">
                    {asset.type} · {new Date(asset.createdAt).toLocaleDateString()}
                    {asset.tags.length > 0 && ` · ${asset.tags.join(', ')}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
