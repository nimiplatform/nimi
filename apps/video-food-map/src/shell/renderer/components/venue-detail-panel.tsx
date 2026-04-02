import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  StatusBadge,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
import {
  setVenueConfirmation,
  toggleVenueFavorite,
} from '@renderer/data/api.js';
import type { ImportRecord, VenueRecord } from '@renderer/data/types.js';

function venueShowsOnMap(venue: VenueRecord) {
  return (venue.reviewState === 'map_ready' || venue.userConfirmed) && venue.latitude != null && venue.longitude != null;
}

function resolveVenueStatus(venue: VenueRecord) {
  if (venue.userConfirmed) {
    return { label: '已确认', tone: 'success' as const };
  }
  if (venue.reviewState === 'map_ready') {
    return { label: '已上图', tone: 'success' as const };
  }
  if (venue.reviewState === 'review' || venue.geocodeStatus === 'failed') {
    return { label: '待确认', tone: 'warning' as const };
  }
  return { label: '仅列表展示', tone: 'info' as const };
}

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isImportActive(status: ImportRecord['status']) {
  return status === 'queued' || status === 'resolving' || status === 'geocoding' || status === 'running';
}

function resolveImportTone(record: ImportRecord) {
  if (record.status === 'queued' || record.status === 'resolving' || record.status === 'geocoding' || record.status === 'running') {
    return 'warning' as const;
  }
  if (record.status === 'failed') {
    return 'danger' as const;
  }
  if (record.venues.some((venue) => venue.userConfirmed || venueShowsOnMap(venue))) {
    return 'success' as const;
  }
  if (record.venues.some((venue) => venue.reviewState === 'review')) {
    return 'warning' as const;
  }
  return 'info' as const;
}

function resolveImportStatusLabel(record: ImportRecord) {
  switch (record.status) {
    case 'queued':
      return '排队中';
    case 'resolving':
    case 'running':
      return '解析中';
    case 'geocoding':
      return '定位中';
    case 'failed':
      return '失败';
    default:
      if (record.venues.some((venue) => venue.userConfirmed)) {
        return '已确认';
      }
      return record.venues.some((venue) => venueShowsOnMap(venue)) ? '已上图' : '待确认';
  }
}

export type VenueDetailPanelProps = {
  selectedImport: ImportRecord;
  selectedVenue: VenueRecord | null;
  selectedDetailVenueId: string | null;
  videoMapPoints: Array<{ venueId: string }>;
  onSelectVenue: (venueId: string) => void;
  onSwitchToVideoMap: () => void;
  refreshSnapshot: () => Promise<void>;
};

export function VenueDetailPanel(props: VenueDetailPanelProps) {
  const {
    selectedImport,
    selectedVenue,
    videoMapPoints,
    onSelectVenue,
    onSwitchToVideoMap,
    refreshSnapshot,
  } = props;

  const selectedVenueStatus = selectedVenue ? resolveVenueStatus(selectedVenue) : null;

  const visibleCommentClues = useMemo(() => {
    if (!selectedImport) {
      return [];
    }
    if (!selectedVenue?.venueName) {
      return selectedImport.commentClues;
    }
    const matched = selectedImport.commentClues.filter((clue) =>
      clue.matchedVenueNames.some((name) => name === selectedVenue.venueName),
    );
    return matched.length > 0 ? matched : selectedImport.commentClues;
  }, [selectedImport, selectedVenue]);

  const confirmationMutation = useMutation({
    mutationFn: async (payload: { venueId: string; confirmed: boolean }) =>
      setVenueConfirmation(payload.venueId, payload.confirmed),
    onSuccess: async (_record, payload) => {
      onSelectVenue(payload.venueId);
    },
    onSettled: refreshSnapshot,
  });

  const favoriteMutation = useMutation({
    mutationFn: async (venueId: string) => toggleVenueFavorite(venueId),
    onSuccess: async (_record, venueId) => {
      onSelectVenue(venueId);
    },
    onSettled: refreshSnapshot,
  });

  return (
    <>
      <Surface tone="panel" elevation="base" className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={resolveImportTone(selectedImport)}>{resolveImportStatusLabel(selectedImport)}</StatusBadge>
              <StatusBadge tone="info">{selectedImport.creatorName || '未知作者'}</StatusBadge>
              {selectedImport.tags.slice(0, 3).map((tag) => <StatusBadge key={tag} tone="neutral">{tag}</StatusBadge>)}
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{selectedImport.title || '未命名视频'}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {selectedImport.videoSummary || selectedImport.description || '当前没有摘要，先保留了原始转写和整理结果。'}
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Surface tone="card" elevation="base" className="p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">原始链接</div>
              <div className="mt-2 break-all text-sm text-[var(--nimi-text-primary)]">{selectedImport.sourceUrl}</div>
            </Surface>
            <Surface tone="card" elevation="base" className="p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">解析模型</div>
              <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">
                {selectedImport.selectedSttModel || (isImportActive(selectedImport.status) ? '正在准备中' : '按脚本默认值')}
              </div>
            </Surface>
          </div>
        </div>
        <Surface tone="card" elevation="base" className="space-y-3 p-4">
          <div className="text-sm font-medium text-[var(--nimi-text-primary)]">这条视频的结果</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">候选店铺</div>
              <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.venues.length}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">已收藏</div>
              <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">
                {selectedImport.venues.filter((venue) => venue.isFavorite).length}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">公开评论</div>
              <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.publicCommentCount}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--nimi-text-muted)]">评论线索</div>
              <div className="mt-1 text-lg font-semibold text-[var(--nimi-text-primary)]">{selectedImport.commentClues.length}</div>
            </div>
          </div>
          <div className="text-xs text-[var(--nimi-text-muted)]">处理时间</div>
          <div className="text-sm text-[var(--nimi-text-primary)]">{formatCommentTime(selectedImport.updatedAt)}</div>
          {selectedImport.errorMessage ? (
            <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] p-3 text-sm text-[var(--nimi-status-danger)]">
              {selectedImport.errorMessage}
            </div>
          ) : null}
        </Surface>
      </Surface>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Surface tone="panel" elevation="base" className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-[var(--nimi-text-primary)]">这条视频提到的店</h3>
              <StatusBadge tone="neutral">{selectedImport.venues.length} 家</StatusBadge>
            </div>
            <div className="space-y-3">
              {selectedImport.venues.map((venue) => {
                const status = resolveVenueStatus(venue);
                return (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => onSelectVenue(venue.id)}
                    className={`vfm-card-shell w-full rounded-3xl border p-4 text-left transition ${
                      selectedVenue?.id === venue.id ? 'border-[var(--nimi-action-primary-bg)] shadow-[0_16px_40px_rgba(249,115,22,0.14)]' : 'border-[var(--nimi-border-subtle)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      {venue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
                    </div>
                    <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '还没有可用地址线索'}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {venue.recommendedDishes.map((dish) => <StatusBadge key={dish} tone="danger">{dish}</StatusBadge>)}
                      {venue.cuisineTags.map((tag) => <StatusBadge key={tag} tone="info">{tag}</StatusBadge>)}
                      {venue.flavorTags.map((tag) => <StatusBadge key={tag} tone="warning">{tag}</StatusBadge>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </Surface>

          <Surface tone="panel" elevation="base" className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-[var(--nimi-text-primary)]">筛出的评论线索</h3>
              <StatusBadge tone="info">{visibleCommentClues.length} 条</StatusBadge>
            </div>
            {visibleCommentClues.length === 0 ? (
              <div className="text-sm text-[var(--nimi-text-secondary)]">
                {selectedImport.publicCommentCount > 0
                  ? `这次拿到了 ${selectedImport.publicCommentCount} 条公开评论，但里面没有足够稳的店名或地址线索，所以先不拿来补结果。`
                  : '这次没有拿到可用的公开评论。'}
              </div>
            ) : (
              <div className="space-y-3">
                {visibleCommentClues.map((clue) => (
                  <Surface key={clue.commentId} tone="card" elevation="base" className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="neutral">{clue.authorName || '匿名评论'}</StatusBadge>
                      {clue.matchedVenueNames.map((name) => (
                        <StatusBadge key={`${clue.commentId}-${name}`} tone="info">{name}</StatusBadge>
                      ))}
                      {clue.addressHint ? <StatusBadge tone="warning">带地址线索</StatusBadge> : null}
                    </div>
                    <div className="text-sm leading-6 text-[var(--nimi-text-primary)]">{clue.message}</div>
                    <div className="flex flex-wrap gap-4 text-xs text-[var(--nimi-text-muted)]">
                      <span>{formatCommentTime(clue.publishedAt) || '时间未知'}</span>
                      <span>{`点赞 ${clue.likeCount}`}</span>
                      {clue.addressHint ? <span>{`提到地址：${clue.addressHint}`}</span> : null}
                    </div>
                  </Surface>
                ))}
              </div>
            )}
          </Surface>

          <Surface tone="panel" elevation="base" className="p-5">
            <div className="mb-3 text-lg font-semibold text-[var(--nimi-text-primary)]">转写文本</div>
            <div className="max-h-[360px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {selectedImport.transcript || '当前没有转写文本。'}
            </div>
          </Surface>
        </div>

        <Surface tone="panel" elevation="base" className="space-y-4 p-5">
          <div>
            <div className="text-sm font-medium text-[var(--nimi-text-primary)]">当前选中的店</div>
            {selectedVenue ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="text-xl font-semibold text-[var(--nimi-text-primary)]">{selectedVenue.venueName || '未明确店名'}</div>
                  {selectedVenueStatus ? (
                    <StatusBadge tone={selectedVenueStatus.tone}>{selectedVenueStatus.label}</StatusBadge>
                  ) : null}
                  {selectedVenue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
                </div>
                <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{selectedVenue.addressText || '没有地址线索'}</div>
              </>
            ) : (
              <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">这条视频里还没有店铺候选。</div>
            )}
          </div>
          {selectedVenue ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  tone={selectedVenue.userConfirmed ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={confirmationMutation.isPending}
                  onClick={() =>
                    confirmationMutation.mutate({
                      venueId: selectedVenue.id,
                      confirmed: !selectedVenue.userConfirmed,
                    })
                  }
                >
                  {selectedVenue.userConfirmed ? '取消确认' : '确认这家店'}
                </Button>
                <Button
                  tone={selectedVenue.isFavorite ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={favoriteMutation.isPending}
                  onClick={() => favoriteMutation.mutate(selectedVenue.id)}
                >
                  {selectedVenue.isFavorite ? '取消收藏' : '加入收藏'}
                </Button>
                <Button
                  tone="secondary"
                  size="sm"
                  onClick={onSwitchToVideoMap}
                  disabled={!videoMapPoints.some((point) => point.venueId === selectedVenue.id)}
                >
                  看单视频地图
                </Button>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[var(--nimi-text-muted)]">证据句</div>
                <div className="space-y-2">
                  {selectedVenue.evidence.map((evidence) => (
                    <Surface key={evidence} tone="card" elevation="base" className="p-3 text-sm text-[var(--nimi-text-secondary)]">
                      {evidence}
                    </Surface>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Surface tone="card" elevation="base" className="p-3">
                  <div className="text-xs text-[var(--nimi-text-muted)]">坐标状态</div>
                  <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">
                    {selectedVenue.geocodeStatus === 'resolved'
                      ? '已成功定位'
                      : selectedVenue.geocodeStatus === 'failed'
                        ? '定位失败'
                        : '未尝试定位'}
                  </div>
                </Surface>
                <Surface tone="card" elevation="base" className="p-3">
                  <div className="text-xs text-[var(--nimi-text-muted)]">相关评论</div>
                  <div className="mt-2 text-sm text-[var(--nimi-text-primary)]">
                    {selectedImport.commentClues.filter((clue) => clue.matchedVenueNames.includes(selectedVenue.venueName)).length} 条
                  </div>
                </Surface>
              </div>
              {selectedVenue.geocodeQuery ? (
                <div className="rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,white)] p-3 text-xs leading-5 text-[var(--nimi-text-muted)]">
                  定位查询词：{selectedVenue.geocodeQuery}
                </div>
              ) : null}
            </>
          ) : null}
        </Surface>
      </div>
    </>
  );
}
