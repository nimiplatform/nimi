import { ScrollArea, SelectField, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import type { ImportRecord, VenueRecord, VideoFoodMapSnapshot } from '@renderer/data/types.js';
import type { ReviewFilter } from '@renderer/data/filter.js';

import { formatImportTime, resolveImportStatusLabel, resolveImportTone } from './app-helpers.js';

export function ContextSidebar(props: {
  snapshotPending: boolean;
  creatorSyncs: VideoFoodMapSnapshot['creatorSyncs'];
  favoriteVenues: Array<{ venue: VenueRecord; record: ImportRecord }>;
  filteredImports: ImportRecord[];
  selectedImport: ImportRecord | null;
  searchText: string;
  reviewFilter: ReviewFilter;
  onSearchTextChange: (next: string) => void;
  onReviewFilterChange: (next: ReviewFilter) => void;
  onSelectImport: (record: ImportRecord) => void;
  onSelectFavoriteVenue: (entry: { venue: VenueRecord; record: ImportRecord }) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className="border-b border-[var(--nimi-border-subtle)] px-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-[var(--nimi-text-primary)]">我的清单</div>
            <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">从这里切回最近的视频、收藏和常看的博主。</div>
          </div>
          <StatusBadge tone="neutral">{props.filteredImports.length} 条</StatusBadge>
        </div>
        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              value={props.searchText}
              onChange={(event) => props.onSearchTextChange(event.target.value)}
              placeholder="搜索视频、店铺、博主..."
              className="vfm-search-field w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition"
            />
          </div>
          <SelectField
            value={props.reviewFilter}
            onValueChange={(value) => props.onReviewFilterChange(value as ReviewFilter)}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'map_ready', label: '只看已上图' },
              { value: 'review', label: '只看待确认' },
              { value: 'search_only', label: '只看仅列表展示' },
              { value: 'failed_import', label: '只看解析失败' },
            ]}
          />
          <div className="flex items-center justify-between text-xs text-[var(--nimi-text-muted)]">
            <span>{props.filteredImports.length} 条结果</span>
            <span>越新的越靠前</span>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1" contentClassName="space-y-4 p-4">
        {props.snapshotPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Surface key={index} tone="card" elevation="base" className="vfm-radius-card vfm-skeleton-card h-28 animate-pulse" />
            ))}
          </div>
        ) : null}

        {!props.snapshotPending && props.filteredImports.length === 0 ? (
          <Surface tone="card" elevation="base" className="vfm-radius-card p-4 text-sm text-[var(--nimi-text-secondary)]">
            还没有可看的记录。先导入一条视频，或者换个筛选条件。
          </Surface>
        ) : null}

        {props.filteredImports.map((record) => (
          <button
            key={record.id}
            type="button"
            onClick={() => props.onSelectImport(record)}
            className={`vfm-radius-card w-full min-w-0 overflow-hidden border p-4 text-left transition ${
              record.id === props.selectedImport?.id
                ? 'vfm-list-card-active shadow-[0_18px_35px_rgba(251,146,60,0.18)]'
                : 'vfm-list-card-idle'
            }`}
            title={record.title || record.sourceUrl}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
                  {record.creatorName || '未知作者'}
                </div>
                <div className="vfm-clamp-2 vfm-break-anywhere mt-2 text-sm font-semibold leading-6 text-[var(--nimi-text-primary)]">
                  {record.title || record.sourceUrl}
                </div>
              </div>
              <StatusBadge tone={resolveImportTone(record)}>{resolveImportStatusLabel(record)}</StatusBadge>
            </div>
            <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-xs text-[var(--nimi-text-secondary)]">
              <span className="shrink-0">{formatImportTime(record.createdAt)}</span>
              <span className="shrink-0">{record.venues.length} 家候选</span>
              {record.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate">#{tag}</span>)}
            </div>
          </button>
        ))}

        {!props.snapshotPending && props.favoriteVenues.length > 0 ? (
          <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">我的收藏</div>
              <StatusBadge tone="warning">{props.favoriteVenues.length} 家</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.favoriteVenues.slice(0, 4).map((entry) => (
                <button
                  key={entry.venue.id}
                  type="button"
                  className="vfm-secondary-list-button w-full rounded-2xl border px-3 py-3 text-left transition"
                  onClick={() => props.onSelectFavoriteVenue(entry)}
                >
                  <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{entry.venue.venueName || '未明确店名'}</div>
                  <div className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{entry.record.creatorName || '未知作者'}</div>
                </button>
              ))}
            </div>
          </Surface>
        ) : null}

        {!props.snapshotPending && props.creatorSyncs.length > 0 ? (
          <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">最近常看的博主</div>
              <StatusBadge tone="info">{props.creatorSyncs.length} 个</StatusBadge>
            </div>
            <div className="space-y-2">
              {props.creatorSyncs.slice(0, 3).map((record) => (
                <div key={record.creatorMid} className="vfm-secondary-list-button rounded-2xl border px-3 py-3">
                  <div className="text-sm font-medium text-[var(--nimi-text-primary)]">{record.creatorName || record.creatorMid}</div>
                  <div className="mt-1 text-xs text-[var(--nimi-text-secondary)]">上次扫了 {record.lastScannedCount} 条，新增 {record.lastQueuedCount} 条</div>
                  <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">{formatImportTime(record.lastSyncedAt)}</div>
                </div>
              ))}
            </div>
          </Surface>
        ) : null}
      </ScrollArea>
    </div>
  );
}
