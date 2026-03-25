/**
 * Content Library Page (FG-CONTENT-003)
 *
 * Unified resource browser for images, videos, and audio.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useResourceQuery, useResourcesQuery } from '@renderer/hooks/use-content-queries.js';
import { useContentMutations } from '@renderer/hooks/use-content-mutations.js';

type ResourceTypeFilter = 'ALL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
type ViewMode = 'grid' | 'list';

export default function ContentLibraryPage() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const resourcesQuery = useResourcesQuery(true);
  const resources = resourcesQuery.data || [];
  const { deleteResourceMutation } = useContentMutations();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ResourceTypeFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedResourceId = selectedIds.size === 1 ? Array.from(selectedIds)[0] || '' : '';
  const selectedResourceQuery = useResourceQuery(selectedResourceId);
  const selectedResourceDetail = selectedResourceQuery.data;

  const filtered = useMemo(() => {
    let list = resources;
    if (typeFilter !== 'ALL') {
      list = list.filter((a) => a.resourceType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          String(a.title || '').toLowerCase().includes(q) ||
          String(a.label || '').toLowerCase().includes(q) ||
          a.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          a.controllerId.toLowerCase().includes(q),
      );
    }
    return list;
  }, [resources, typeFilter, search]);

  async function handleDeleteSelected() {
    for (const resourceId of selectedIds) {
      await deleteResourceMutation.mutateAsync(resourceId);
    }
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['forge', 'content', 'resources'] });
    if (selectedResourceId) {
      await queryClient.invalidateQueries({ queryKey: ['forge', 'content', 'resource', selectedResourceId] });
    }
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
              {t('contentLibrary.subtitle', 'Browse and manage all your content resources')}
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
                disabled={deleteResourceMutation.isPending}
                className="rounded px-3 py-1.5 text-xs font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                {deleteResourceMutation.isPending ? t('contentLibrary.deleting', 'Deleting...') : t('contentLibrary.delete', 'Delete')}
              </button>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder={t('contentLibrary.searchPlaceholder', 'Search resources...')}
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
        {resourcesQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-12 text-center">
            <div className="text-4xl text-neutral-700 mb-2">📁</div>
            <p className="text-sm text-neutral-500">
              {resources.length === 0
                ? t('contentLibrary.noResources', 'No content yet. Create images, videos, or music to build your library.')
                : t('contentLibrary.noResults', 'No resources match your filters.')}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid grid-cols-4 gap-3">
            {filtered.map((resource) => (
              <div
                key={resource.id}
                onClick={() => toggleSelect(resource.id)}
                className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-colors ${
                  selectedIds.has(resource.id)
                    ? 'border-white ring-1 ring-white'
                    : 'border-neutral-800 hover:border-neutral-700'
                }`}
              >
                    {resource.url && resource.resourceType === 'IMAGE' ? (
                      <img
                        src={resource.url}
                        alt={resource.title || resource.label || resource.id}
                    className="aspect-square w-full object-cover bg-neutral-950"
                  />
                ) : (
                  <div className="aspect-square bg-neutral-900 flex items-center justify-center">
                    <span className="text-2xl text-neutral-700">
                      {resource.resourceType === 'IMAGE' ? '🖼️' : resource.resourceType === 'VIDEO' ? '📹' : resource.resourceType === 'AUDIO' ? '🎵' : '📝'}
                    </span>
                  </div>
                )}
                <div className="absolute top-2 right-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    resource.resourceType === 'IMAGE' ? 'bg-amber-500/20 text-amber-300' :
                    resource.resourceType === 'VIDEO' ? 'bg-sky-500/20 text-sky-300' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {resource.resourceType}
                  </span>
                </div>
                <div className="p-2">
                  <p className="text-xs text-white truncate">{resource.title || resource.label || 'Untitled'}</p>
                  <p className="mt-1 text-[11px] text-neutral-500 truncate">
                    {resource.controllerKind} · {resource.controllerId}
                  </p>
                </div>
              </div>
            ))}
            </div>
            <aside className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
              {selectedResourceId ? (
                selectedResourceQuery.isLoading ? (
                  <div className="text-sm text-neutral-500">{t('contentLibrary.loadingDetails', 'Loading resource details...')}</div>
                ) : selectedResourceDetail ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {String(selectedResourceDetail.title || selectedResourceDetail.label || selectedResourceId)}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {String(selectedResourceDetail.resourceType || '')} · {String(selectedResourceDetail.status || '')}
                      </p>
                    </div>
                    <div className="space-y-1 text-xs text-neutral-400">
                      <p>{String(selectedResourceDetail.controllerKind || '')} · {String(selectedResourceDetail.controllerId || '')}</p>
                      <p>{String(selectedResourceDetail.deliveryAccess || '')} · {String(selectedResourceDetail.provider || '')}</p>
                      <p className="break-all">{String(selectedResourceDetail.storageRef || '')}</p>
                      {Array.isArray(selectedResourceDetail.tags) && selectedResourceDetail.tags.length > 0 ? (
                        <p>{selectedResourceDetail.tags.join(', ')}</p>
                      ) : null}
                    </div>
                    {typeof selectedResourceDetail.url === 'string' && selectedResourceDetail.url ? (
                      selectedResourceDetail.resourceType === 'IMAGE' ? (
                        <img
                          src={selectedResourceDetail.url}
                          alt={String(selectedResourceDetail.title || selectedResourceDetail.label || selectedResourceId)}
                          className="w-full rounded-md border border-neutral-800 object-cover"
                        />
                      ) : (
                        <a
                          href={selectedResourceDetail.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-xs text-sky-300 hover:text-sky-200"
                        >
                          {t('contentLibrary.openPreview', 'Open preview')}
                        </a>
                      )
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-neutral-500">{t('contentLibrary.noDetails', 'Resource details are unavailable.')}</div>
                )
              ) : (
                <div className="text-sm text-neutral-500">{t('contentLibrary.selectResource', 'Select one resource to inspect controller and delivery details.')}</div>
              )}
            </aside>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((resource) => (
              <div
                key={resource.id}
                onClick={() => toggleSelect(resource.id)}
                className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 cursor-pointer transition-colors ${
                  selectedIds.has(resource.id)
                    ? 'border-white bg-white/5'
                    : 'border-neutral-800 bg-neutral-900/50 hover:border-neutral-700'
                }`}
              >
                <span className="text-lg">
                  {resource.resourceType === 'IMAGE' ? '🖼️' : resource.resourceType === 'VIDEO' ? '📹' : resource.resourceType === 'AUDIO' ? '🎵' : '📝'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{resource.title || resource.label || 'Untitled'}</p>
                  <p className="text-xs text-neutral-500">
                    {resource.resourceType} · {new Date(resource.createdAt).toLocaleDateString()}
                    {` · ${resource.controllerKind}:${resource.controllerId}`}
                    {` · ${resource.deliveryAccess}`}
                    {resource.tags.length > 0 ? ` · ${resource.tags.join(', ')}` : ''}
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
