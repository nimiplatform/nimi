import { Button, ScrollArea, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';

import { formatConfidenceLabel, InfoPill, type ReviewItem, resolveVenueStatus } from './app-surface-shared.js';

export function ReviewSurface(props: {
  reviewItems: ReviewItem[];
  reviewIndex: number;
  selectedReviewItem: ReviewItem | null;
  confirmationPending: boolean;
  favoritePending: boolean;
  onSelectIndex: (next: number) => void;
  onNext: () => void;
  onConfirm: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onOpenInDiscover: (recordId: string, venueId: string) => void;
}) {
  if (!props.selectedReviewItem) {
    return (
      <Surface tone="panel" elevation="base" className="vfm-radius-shell flex h-full min-h-[540px] items-center justify-center p-10 text-center">
        <div className="max-w-xl space-y-3">
          <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">当前没有待确认项</div>
          <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
            已确认或者已经能稳定上图的店都会从这里退出。你可以先回到发现页继续导入更多视频。
          </div>
        </div>
      </Surface>
    );
  }

  const { venue, record } = props.selectedReviewItem;
  const status = resolveVenueStatus(venue);
  const selectedReviewVenueId = props.selectedReviewItem.venue.id;
  const nextButtonLabel = props.reviewItems.length > 1 ? '跳过看下一条' : '留在当前';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <Surface tone="panel" elevation="base" className="vfm-radius-stage relative overflow-hidden p-8">
          <div className="vfm-radius-badge vfm-review-index absolute right-6 top-6 px-4 py-3 text-sm font-semibold shadow-sm">
            #{props.reviewIndex + 1}
          </div>
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              <StatusBadge tone="info">{record.creatorName || '未知作者'}</StatusBadge>
              {venue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--nimi-text-muted)]">提取自：{record.title || record.sourceUrl}</div>
            <div className="mt-4 text-4xl font-semibold tracking-tight text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
            <div className="mt-3 text-base leading-7 text-[var(--nimi-text-secondary)]">{venue.addressText || '暂无地址线索'}</div>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <Surface tone="card" elevation="base" className="vfm-radius-panel w-full min-w-0 overflow-hidden p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">审核判断</div>
              <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                置信度：{formatConfidenceLabel(venue.confidence)}。{venue.evidence[0] || '当前没有证据句，就按地址和评论线索人工判断。'}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {venue.recommendedDishes.map((dish) => <InfoPill key={dish} tone="danger">{dish}</InfoPill>)}
                {venue.flavorTags.map((tag) => <InfoPill key={tag} tone="warm">{tag}</InfoPill>)}
              </div>
            </Surface>
            <Surface tone="card" elevation="base" className="vfm-radius-panel w-full min-w-0 overflow-hidden p-5">
              <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">定位状态</div>
              <div className="mt-3 text-sm leading-7 text-[var(--nimi-text-secondary)]">
                {venue.geocodeStatus === 'resolved'
                  ? '已经拿到坐标，但还没确认是否收进地图。'
                  : venue.geocodeStatus === 'failed'
                    ? '这次定位没成功，需要你人工判断。'
                    : '这条记录还没有稳定坐标。'}
              </div>
              {venue.geocodeQuery ? (
                <div className="vfm-geocode-query mt-3 rounded-2xl px-4 py-3 text-xs text-[var(--nimi-text-muted)]">
                  定位查询词：{venue.geocodeQuery}
                </div>
              ) : null}
            </Surface>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              tone="primary"
              onClick={() => props.onConfirm(venue.id, true)}
              disabled={props.confirmationPending}
            >
              确认收录
            </Button>
            <Button
              tone={venue.isFavorite ? 'primary' : 'secondary'}
              onClick={() => props.onToggleFavorite(venue.id)}
              disabled={props.favoritePending}
            >
              {venue.isFavorite ? '取消收藏' : '加入收藏'}
            </Button>
            <Button tone="secondary" onClick={props.onNext} disabled={props.reviewItems.length <= 1}>
              {nextButtonLabel}
            </Button>
            <Button tone="secondary" onClick={() => props.onOpenInDiscover(record.id, venue.id)}>
              回到视频详情
            </Button>
          </div>
        </Surface>
      </div>

      <div className="space-y-4">
        <Surface tone="panel" elevation="base" className="vfm-radius-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">待确认队列</div>
              <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">宽窗口会在这里显示其余项，窄窗口就保留主卡片。</div>
            </div>
            <StatusBadge tone="warning">{props.reviewItems.length} 条</StatusBadge>
          </div>
        </Surface>

        <ScrollArea className="max-h-[620px]" contentClassName="space-y-3">
          {props.reviewItems.map((item, index) => (
            <button
              key={item.venue.id}
              type="button"
              data-testid={`review-queue-${item.venue.id}`}
              onClick={() => props.onSelectIndex(index)}
              className={`vfm-radius-card w-full border p-4 text-left transition ${
                item.venue.id === selectedReviewVenueId
                  ? 'vfm-list-card-active shadow-[0_16px_30px_rgba(251,146,60,0.14)]'
                  : 'vfm-list-card-idle'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{item.venue.venueName || '未明确店名'}</div>
                <StatusBadge tone={resolveVenueStatus(item.venue).tone}>{resolveVenueStatus(item.venue).label}</StatusBadge>
              </div>
              <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{item.venue.addressText || '暂无地址线索'}</div>
            </button>
          ))}
        </ScrollArea>
      </div>
    </div>
  );
}
