import { Button, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import type { ImportRecord, MapPoint, VenueRecord } from '@renderer/data/types.js';

import { InfoPill, formatCommentTime, formatSelectedModelLabel, resolveVenueStatus } from './app-surface-shared.js';

export function DiscoverSurface(props: {
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  selectedDetailVenueId: string | null;
  visibleCommentClues: ImportRecord['commentClues'];
  videoMapPoints: MapPoint[];
  onSelectVenue: (venueId: string) => void;
  onOpenSource: () => void;
  onConfirmVenue: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onSwitchToVideoMap: () => void;
  onRetryImport: (importId: string) => void;
  confirmationPending: boolean;
  favoritePending: boolean;
  retryPending: boolean;
}) {
  if (!props.selectedImport) {
    return (
      <Surface tone="panel" elevation="base" className="vfm-radius-shell flex h-full min-h-[540px] items-center justify-center p-10 text-center">
        <div className="max-w-xl space-y-3">
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">先导入一条视频</div>
          <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
            新界面已经准备好。等有第一条视频进来，这里会直接显示店铺结果、评论线索和地图入口。
          </div>
        </div>
      </Surface>
    );
  }

  if (props.selectedImport.status === 'failed') {
    return (
      <Surface tone="panel" elevation="base" className="vfm-radius-shell space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="danger">导入失败</StatusBadge>
          <StatusBadge tone="info">{props.selectedImport.creatorName || '未知作者'}</StatusBadge>
        </div>
        <div>
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.selectedImport.title || '未命名视频'}</div>
          <div className="mt-2 text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {props.selectedImport.errorMessage || '这条视频这次没有跑通。'}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button tone="primary" onClick={() => props.onRetryImport(props.selectedImport!.id)} disabled={props.retryPending}>
            {props.retryPending ? '正在重试...' : '重试这条视频'}
          </Button>
          <Button tone="secondary" onClick={props.onOpenSource}>查看原始视频</Button>
        </div>
      </Surface>
    );
  }

  const selectedVenueStatus = props.selectedVenue ? resolveVenueStatus(props.selectedVenue) : null;
  const venueCount = props.selectedImport.venues.length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--nimi-text-primary)]">提取结果</h1>
        </div>
        <button
          type="button"
          onClick={props.onOpenSource}
          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--nimi-action-primary-bg)] transition hover:text-[var(--nimi-action-primary-bg-hover)]"
        >
          查看原始视频
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Surface tone="panel" elevation="base" className="vfm-radius-shell col-span-12 border border-black/6 p-8 lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="max-md:text-[30px] text-[36px] font-bold leading-none tracking-[-0.03em] text-[var(--nimi-text-primary)]">
                  {props.selectedVenue?.venueName || props.selectedImport.title || '未命名视频'}
                </div>
                {selectedVenueStatus ? <StatusBadge tone={selectedVenueStatus.tone}>{selectedVenueStatus.label}</StatusBadge> : null}
              </div>
              <div className="mt-3 text-sm text-[var(--nimi-text-secondary)]">
                {props.selectedVenue?.addressText || '还没有稳定地址线索'}
              </div>
              <div className="mt-5 max-w-[720px] text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {props.selectedImport.videoSummary || props.selectedImport.description || '当前没有摘要，先保留原始结果。'}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                className="vfm-icon-button inline-flex h-12 w-12 items-center justify-center rounded-2xl text-xl transition"
                aria-label="更多操作"
              >
                …
              </button>
              {props.selectedVenue ? (
                <Button
                  tone={props.selectedVenue.userConfirmed ? 'secondary' : 'primary'}
                  onClick={() => props.onConfirmVenue(props.selectedVenue!.id, !props.selectedVenue!.userConfirmed)}
                  disabled={props.confirmationPending}
                >
                  {props.selectedVenue.userConfirmed ? '取消确认' : '确认收录'}
                </Button>
              ) : null}
              {props.selectedVenue ? (
                <Button
                  tone={props.selectedVenue.isFavorite ? 'primary' : 'secondary'}
                  onClick={() => props.onToggleFavorite(props.selectedVenue!.id)}
                  disabled={props.favoritePending}
                >
                  {props.selectedVenue.isFavorite ? '取消收藏' : '加入收藏'}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <Surface tone="card" elevation="base" className="vfm-radius-card vfm-soft-card border border-black/4 p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">推荐菜品</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.selectedVenue?.recommendedDishes.length
                  ? props.selectedVenue.recommendedDishes.map((dish) => <InfoPill key={dish}>{dish}</InfoPill>)
                  : <span className="text-sm text-[var(--nimi-text-secondary)]">还没有稳定的菜品线索</span>}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="vfm-radius-card vfm-soft-card border border-black/4 p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">风味标签</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.selectedVenue && [...props.selectedVenue.flavorTags, ...props.selectedVenue.cuisineTags].length > 0
                  ? [...props.selectedVenue.flavorTags, ...props.selectedVenue.cuisineTags].map((tag) => <InfoPill key={tag} tone="warm">#{tag}</InfoPill>)
                  : <span className="text-sm text-[var(--nimi-text-secondary)]">还没有稳定的标签线索</span>}
              </div>
            </Surface>
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="vfm-radius-shell col-span-12 border border-black/6 p-6 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">评论线索补全</div>
            <StatusBadge tone="info">{props.visibleCommentClues.length} 条</StatusBadge>
          </div>
          {props.visibleCommentClues.length === 0 ? (
            <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
              {props.selectedImport.publicCommentCount > 0
                ? `这次拿到了 ${props.selectedImport.publicCommentCount} 条公开评论，但里面没有足够稳的店名或地址线索。`
                : '这次没有拿到可用的公开评论。'}
            </div>
          ) : (
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {props.visibleCommentClues.map((clue) => (
                <div
                  key={clue.commentId}
                  className="vfm-radius-card vfm-comment-clue border p-4"
                >
                  <div className="text-sm leading-7 text-[var(--nimi-text-primary)]">{clue.message}</div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--nimi-text-muted)]">
                    <span>{clue.authorName || '匿名评论'}</span>
                    {clue.addressHint ? <span className="vfm-comment-clue-accent">带地址线索</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <Surface tone="panel" elevation="base" className="vfm-radius-panel col-span-12 border border-black/6 p-5 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">这条视频提到的店</div>
            <StatusBadge tone="neutral">{venueCount} 家</StatusBadge>
          </div>
          <div className="space-y-3">
            {props.selectedImport.venues.map((venue) => {
              const status = resolveVenueStatus(venue);
              return (
                <button
                  key={venue.id}
                  type="button"
                  data-testid={`discover-venue-${venue.id}`}
                  onClick={() => props.onSelectVenue(venue.id)}
                  className={`vfm-radius-tight w-full border p-4 text-left transition ${
                    props.selectedDetailVenueId === venue.id
                      ? 'vfm-list-card-active'
                      : 'vfm-list-card-idle'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '还没有可用地址线索'}</div>
                </button>
              );
            })}
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="vfm-radius-panel col-span-12 border border-black/6 p-5 lg:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">证据与转写</div>
            <div className="text-xs text-[var(--nimi-text-muted)]">语音模型：{formatSelectedModelLabel(props.selectedImport.selectedSttModel)}</div>
          </div>
          {props.selectedVenue?.evidence.length ? (
            <div className="space-y-2">
              {props.selectedVenue.evidence.map((evidence) => (
                <div key={evidence} className="rounded-2xl border border-black/6 bg-white/72 px-4 py-3 text-sm leading-6 text-[var(--nimi-text-secondary)]">
                  {evidence}
                </div>
              ))}
            </div>
          ) : null}
          <div className="vfm-radius-tight vfm-transcript-panel mt-4 max-h-[280px] overflow-auto whitespace-pre-wrap border p-4 text-sm leading-7 text-[var(--nimi-text-secondary)]">
            {props.selectedImport.transcript || '当前没有转写文本。'}
          </div>
        </Surface>

        <Surface tone="panel" elevation="base" className="vfm-radius-panel col-span-12 border border-black/6 p-5 lg:col-span-4">
          <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">视频信息</div>
          <div className="mt-4 space-y-4">
            <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">视频摘要</div>
              <div className="mt-2 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {props.selectedImport.videoSummary || props.selectedImport.description || '当前没有摘要。'}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
              <div className="text-xs text-[var(--nimi-text-muted)]">原始链接</div>
              <div className="mt-2 break-all text-sm text-[var(--nimi-text-primary)]">{props.selectedImport.sourceUrl}</div>
            </Surface>
            <div className="grid gap-3 sm:grid-cols-2">
              <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">公开评论</div>
                <div className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{props.selectedImport.publicCommentCount}</div>
              </Surface>
              <Surface tone="card" elevation="base" className="vfm-radius-tight p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">处理时间</div>
                <div className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">{formatCommentTime(props.selectedImport.updatedAt)}</div>
              </Surface>
            </div>
            {props.selectedVenue ? (
              <Button
                tone="secondary"
                onClick={props.onSwitchToVideoMap}
                disabled={!props.videoMapPoints.some((point) => point.venueId === props.selectedVenue!.id)}
              >
                看单视频地图
              </Button>
            ) : null}
          </div>
        </Surface>
      </div>
    </div>
  );
}
