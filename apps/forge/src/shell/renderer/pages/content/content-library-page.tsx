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
import { Button, Surface, SearchField } from '@nimiplatform/nimi-kit/ui';
import { ForgePage, ForgePageHeader, ForgeEmptyState, ForgeLoadingSpinner } from '@renderer/components/page-layout.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { formatDate } from '@renderer/components/format-utils.js';

type ResourceTypeFilter = 'ALL' | 'IMAGE' | 'VIDEO' | 'AUDIO';
type ViewMode = 'grid' | 'list';

const TYPE_FILTER_OPTIONS = [
  { value: 'ALL' as const, label: 'All' },
  { value: 'IMAGE' as const, label: 'Images' },
  { value: 'VIDEO' as const, label: 'Videos' },
  { value: 'AUDIO' as const, label: 'Audio' },
];

const VIEW_MODE_OPTIONS = [
  { value: 'grid' as const, label: '\u229E' },
  { value: 'list' as const, label: '\u2630' },
];

const RESOURCE_TYPE_BADGE_TONE: Record<string, 'warning' | 'info' | 'success'> = {
  IMAGE: 'warning',
  VIDEO: 'info',
  AUDIO: 'success',
};

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
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.contentLibrary')}
        subtitle={t('contentLibrary.subtitle', 'Browse and manage all your content resources')}
        actions={
          selectedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--nimi-text-muted)]">
                {t('contentLibrary.selected', { count: selectedIds.size })}
              </span>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
              >
                {t('contentLibrary.clear', 'Clear')}
              </Button>
              <Button
                tone="danger"
                size="sm"
                onClick={() => void handleDeleteSelected()}
                disabled={deleteResourceMutation.isPending}
              >
                {deleteResourceMutation.isPending ? t('contentLibrary.deleting', 'Deleting...') : t('contentLibrary.delete', 'Delete')}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <SearchField
          placeholder={t('contentLibrary.searchPlaceholder', 'Search resources...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <ForgeSegmentControl
          options={TYPE_FILTER_OPTIONS}
          value={typeFilter}
          onChange={setTypeFilter}
          size="md"
        />
        <ForgeSegmentControl
          options={VIEW_MODE_OPTIONS}
          value={viewMode}
          onChange={setViewMode}
          size="md"
        />
      </div>

      {/* Content */}
      {resourcesQuery.isLoading ? (
        <ForgeLoadingSpinner />
      ) : filtered.length === 0 ? (
        <ForgeEmptyState
          message={
            resources.length === 0
              ? t('contentLibrary.noResources', 'No content yet. Create images, videos, or music to build your library.')
              : t('contentLibrary.noResults', 'No resources match your filters.')
          }
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((resource) => (
              <Surface
                key={resource.id}
                tone="card"
                padding="none"
                interactive
                active={selectedIds.has(resource.id)}
                onClick={() => toggleSelect(resource.id)}
                className="group relative overflow-hidden cursor-pointer"
              >
                {resource.url && resource.resourceType === 'IMAGE' ? (
                  <img
                    src={resource.url}
                    alt={resource.title || resource.label || resource.id}
                    className="aspect-square w-full object-cover bg-[var(--nimi-surface-canvas)]"
                  />
                ) : (
                  <div className="aspect-square bg-[var(--nimi-surface-canvas)] flex items-center justify-center">
                    <span className="text-2xl text-[var(--nimi-text-muted)]">
                      {resource.resourceType === 'IMAGE' ? '\uD83D\uDDBC\uFE0F' : resource.resourceType === 'VIDEO' ? '\uD83D\uDCF9' : resource.resourceType === 'AUDIO' ? '\uD83C\uDFB5' : '\uD83D\uDCDD'}
                    </span>
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <ForgeStatusBadge
                    domain="generic"
                    status={resource.resourceType}
                    tone={RESOURCE_TYPE_BADGE_TONE[resource.resourceType] ?? 'neutral'}
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs text-[var(--nimi-text-primary)] truncate">{resource.title || resource.label || 'Untitled'}</p>
                  <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)] truncate">
                    {resource.controllerKind} · {resource.controllerId}
                  </p>
                </div>
              </Surface>
            ))}
          </div>
          <Surface tone="card" padding="md" className="h-fit">
            {selectedResourceId ? (
              selectedResourceQuery.isLoading ? (
                <div className="text-sm text-[var(--nimi-text-muted)]">{t('contentLibrary.loadingDetails', 'Loading resource details...')}</div>
              ) : selectedResourceDetail ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                      {String(selectedResourceDetail.title || selectedResourceDetail.label || selectedResourceId)}
                    </p>
                    <p className="text-xs text-[var(--nimi-text-muted)]">
                      {String(selectedResourceDetail.resourceType || '')} · {String(selectedResourceDetail.status || '')}
                    </p>
                  </div>
                  <div className="space-y-1 text-xs text-[var(--nimi-text-secondary)]">
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
                        className="w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] object-cover"
                      />
                    ) : (
                      <a
                        href={selectedResourceDetail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs text-[var(--nimi-text-link)] hover:text-[var(--nimi-text-link-hover)]"
                      >
                        {t('contentLibrary.openPreview', 'Open preview')}
                      </a>
                    )
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-[var(--nimi-text-muted)]">{t('contentLibrary.noDetails', 'Resource details are unavailable.')}</div>
              )
            ) : (
              <div className="text-sm text-[var(--nimi-text-muted)]">{t('contentLibrary.selectResource', 'Select one resource to inspect controller and delivery details.')}</div>
            )}
          </Surface>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((resource) => (
            <Surface
              key={resource.id}
              tone="card"
              padding="sm"
              interactive
              active={selectedIds.has(resource.id)}
              onClick={() => toggleSelect(resource.id)}
              className="flex items-center gap-3 cursor-pointer"
            >
              <span className="text-lg">
                {resource.resourceType === 'IMAGE' ? '\uD83D\uDDBC\uFE0F' : resource.resourceType === 'VIDEO' ? '\uD83D\uDCF9' : resource.resourceType === 'AUDIO' ? '\uD83C\uDFB5' : '\uD83D\uDCDD'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--nimi-text-primary)] truncate">{resource.title || resource.label || 'Untitled'}</p>
                <p className="text-xs text-[var(--nimi-text-muted)]">
                  {resource.resourceType} · {formatDate(resource.createdAt)}
                  {` · ${resource.controllerKind}:${resource.controllerId}`}
                  {` · ${resource.deliveryAccess}`}
                  {resource.tags.length > 0 ? ` · ${resource.tags.join(', ')}` : ''}
                </p>
              </div>
            </Surface>
          ))}
        </div>
      )}
    </ForgePage>
  );
}
