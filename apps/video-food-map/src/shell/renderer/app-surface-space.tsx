import { Button, StatusBadge, Surface } from '@nimiplatform/nimi-kit/ui';
import { DINING_PREFERENCE_GROUPS } from '@renderer/data/preferences.js';
import type { CreatorSyncRecord, ImportRecord, VenueRecord, VideoFoodMapDiningProfile, VideoFoodMapSnapshot } from '@renderer/data/types.js';

import { formatImportTime, resolveImportStatusLabel } from './app-helpers.js';
import { InfoPill, resolveVenueStatus } from './app-surface-shared.js';

type VenueEntry = {
  venue: VenueRecord;
  record: ImportRecord;
};

function collectProfileLabels(profile: VideoFoodMapDiningProfile): string[] {
  return DINING_PREFERENCE_GROUPS.flatMap((group) =>
    group.options
      .filter((option) => profile[group.id].includes(option.value))
      .map((option) => option.label),
  );
}

function buildTasteReason(entry: VenueEntry, profile: VideoFoodMapDiningProfile): string {
  const tags = new Set([...entry.venue.cuisineTags, ...entry.venue.flavorTags]);
  const matchedCuisine = profile.cuisinePreferences.find((value) => tags.has(value));
  const matchedFlavor = profile.flavorPreferences.find((value) => tags.has(value));
  if (entry.venue.isFavorite) {
    return '你已经收进收藏了，可以直接拿来做决定。';
  }
  if (matchedCuisine) {
    return `这家带 ${matchedCuisine} 方向，和你常吃的菜系对得上。`;
  }
  if (matchedFlavor) {
    return `这家带 ${matchedFlavor} 方向，和你最近的口味偏好接近。`;
  }
  if (entry.venue.userConfirmed) {
    return '你已经人工确认过这家，稳定度比普通候选更高。';
  }
  return '它已经能稳定落到地图上，适合先留在你的空间里慢慢筛。';
}

function uniqueEntries(entries: VenueEntry[]): VenueEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.venue.id)) {
      return false;
    }
    seen.add(entry.venue.id);
    return true;
  });
}

export function PersonalSpaceSurface(props: {
  snapshot: VideoFoodMapSnapshot | undefined;
  selectedImport: ImportRecord | null;
  selectedVenue: VenueRecord | null;
  favoriteVenues: VenueEntry[];
  mappedVenues: VenueEntry[];
  reviewItems: VenueEntry[];
  creatorSyncs: CreatorSyncRecord[];
  diningProfile: VideoFoodMapDiningProfile;
  visibleCommentClues: ImportRecord['commentClues'];
  selectedDetailVenueId: string | null;
  recentImports: ImportRecord[];
  onSelectVenue: (venueId: string) => void;
  onOpenSource: () => void;
  onConfirmVenue: (venueId: string, confirmed: boolean) => void;
  onToggleFavorite: (venueId: string) => void;
  onOpenMap: () => void;
  onOpenReview: () => void;
  onOpenProfile: () => void;
  onOpenImport: (recordId: string, venueId: string | null) => void;
  onRetryImport: (importId: string) => void;
  confirmationPending: boolean;
  favoritePending: boolean;
  retryPending: boolean;
}) {
  const profileLabels = collectProfileLabels(props.diningProfile);
  const decisionCandidates = uniqueEntries([
    ...props.favoriteVenues,
    ...props.mappedVenues.filter((entry) => entry.venue.userConfirmed),
    ...props.mappedVenues,
  ]).slice(0, 3);
  const selectedVenueStatus = props.selectedVenue ? resolveVenueStatus(props.selectedVenue) : null;
  const currentImport = props.selectedImport;

  if (!currentImport && props.favoriteVenues.length === 0 && props.reviewItems.length === 0) {
    return (
      <Surface tone="hero" material="glass-thick" elevation="raised" className="vfm-radius-stage flex min-h-[560px] items-center justify-center p-10 text-center">
        <div className="max-w-2xl space-y-4">
          <StatusBadge tone="info">我的美食空间</StatusBadge>
          <div className="text-4xl font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary)]">先放进第一条种草视频</div>
          <div className="text-sm leading-8 text-[var(--nimi-text-secondary)]">
            这里不会只是一条导入通道。等第一条记录进来后，你的收藏、地图、待整理清单和口味档案都会在这里慢慢长出来。
          </div>
        </div>
      </Surface>
    );
  }

  return (
    <div className="space-y-6">
      <Surface tone="hero" material="glass-thick" elevation="raised" className="vfm-radius-stage overflow-hidden p-6 md:p-7">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">我的美食空间</StatusBadge>
                <StatusBadge tone="neutral">{props.snapshot?.stats.importCount || 0} 条种草线索</StatusBadge>
                <StatusBadge tone="warning">{props.reviewItems.length} 条待整理</StatusBadge>
              </div>
              <div className="text-4xl font-semibold tracking-[-0.04em] text-[var(--nimi-text-primary)]">
                把想吃的地方、正在整理的线索，放进同一个空间里
              </div>
              <div className="max-w-3xl text-sm leading-8 text-[var(--nimi-text-secondary)]">
                首页现在不再只是导入入口。你已经存下来的店、今天可以直接去吃的地方、还没整理完的候选，以及你自己的口味档案，都应该在这里一眼看清。
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Surface tone="card" material="glass-regular" elevation="base" className="vfm-radius-card p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">我的收藏</div>
                <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.favoriteVenueCount || 0}</div>
              </Surface>
              <Surface tone="card" material="glass-regular" elevation="base" className="vfm-radius-card p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">已确认地点</div>
                <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.confirmedVenueCount || 0}</div>
              </Surface>
              <Surface tone="card" material="glass-regular" elevation="base" className="vfm-radius-card p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">地图上的店</div>
                <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.snapshot?.stats.mappedVenueCount || 0}</div>
              </Surface>
              <Surface tone="card" material="glass-regular" elevation="base" className="vfm-radius-card p-4">
                <div className="text-xs text-[var(--nimi-text-muted)]">最近看的博主</div>
                <div className="mt-2 text-2xl font-semibold text-[var(--nimi-text-primary)]">{props.creatorSyncs.length}</div>
              </Surface>
            </div>
          </div>

          <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">口味档案</div>
                <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">以后点菜和筛选都会先参考这份档案。</div>
              </div>
              <Button tone="secondary" size="sm" onClick={props.onOpenProfile}>
                去完善
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profileLabels.length > 0 ? (
                profileLabels.slice(0, 8).map((label) => <InfoPill key={label} tone="warm">{label}</InfoPill>)
              ) : (
                <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
                  还没写偏好。先记住常吃的菜系、忌口和不想碰的食材，后面每次筛店都会更像你自己的空间。
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button tone="primary" onClick={props.onOpenMap}>看我的地图</Button>
              <Button tone="secondary" onClick={props.onOpenReview}>去整理清单</Button>
            </div>
          </Surface>
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-stage space-y-5 p-6">
          {!currentImport ? (
            <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
              现在还没有正在看的视频详情。你可以先从左侧挑一条最近导入的记录回来继续整理。
            </div>
          ) : currentImport.status === 'failed' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="danger">这条线索没跑通</StatusBadge>
                <StatusBadge tone="info">{currentImport.creatorName || '未知作者'}</StatusBadge>
              </div>
              <div className="text-2xl font-semibold text-[var(--nimi-text-primary)]">{currentImport.title || '未命名视频'}</div>
              <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">{currentImport.errorMessage || '这次导入失败了。'}</div>
              <div className="flex flex-wrap gap-3">
                <Button tone="primary" onClick={() => props.onRetryImport(currentImport.id)} disabled={props.retryPending}>
                  {props.retryPending ? '正在重试...' : '重试这条线索'}
                </Button>
                <Button tone="secondary" onClick={props.onOpenSource}>查看原视频</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="info">{currentImport.creatorName || '未知作者'}</StatusBadge>
                    <StatusBadge tone="neutral">{resolveImportStatusLabel(currentImport)}</StatusBadge>
                    {selectedVenueStatus ? <StatusBadge tone={selectedVenueStatus.tone}>{selectedVenueStatus.label}</StatusBadge> : null}
                  </div>
                  <div className="text-3xl font-semibold tracking-[-0.03em] text-[var(--nimi-text-primary)]">
                    {props.selectedVenue?.venueName || currentImport.title || '未命名线索'}
                  </div>
                  <div className="max-w-3xl text-sm leading-8 text-[var(--nimi-text-secondary)]">
                    {props.selectedVenue?.addressText || currentImport.videoSummary || currentImport.description || '这条线索还没有稳定摘要。'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button tone="secondary" onClick={props.onOpenSource}>查看原视频</Button>
                  {props.selectedVenue ? (
                    <Button
                      tone={props.selectedVenue.userConfirmed ? 'secondary' : 'primary'}
                      onClick={() => props.onConfirmVenue(props.selectedVenue!.id, !props.selectedVenue!.userConfirmed)}
                      disabled={props.confirmationPending}
                    >
                      {props.selectedVenue.userConfirmed ? '取消确认' : '确认收进空间'}
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

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-panel space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">这条线索里的店</div>
                    <StatusBadge tone="neutral">{currentImport.venues.length} 家</StatusBadge>
                  </div>
                  <div className="space-y-3">
                    {currentImport.venues.map((venue) => {
                      const status = resolveVenueStatus(venue);
                      return (
                        <button
                          key={venue.id}
                          type="button"
                          data-testid={`discover-venue-${venue.id}`}
                          onClick={() => props.onSelectVenue(venue.id)}
                          className={`vfm-radius-card w-full border p-4 text-left transition ${
                            props.selectedDetailVenueId === venue.id ? 'vfm-list-card-active' : 'vfm-list-card-idle'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{venue.venueName || '未明确店名'}</div>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          </div>
                          <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{venue.addressText || '还没有稳定地址'}</div>
                        </button>
                      );
                    })}
                  </div>
                </Surface>

                <Surface tone="card" material="glass-thin" elevation="base" className="vfm-radius-panel space-y-4 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">种草理由</div>
                    <Button tone="secondary" size="sm" onClick={props.onOpenMap}>
                      放到地图里看
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {props.selectedVenue?.recommendedDishes.length ? props.selectedVenue.recommendedDishes.map((dish) => (
                      <InfoPill key={dish}>{dish}</InfoPill>
                    )) : <InfoPill tone="neutral">还没有稳定菜品线索</InfoPill>}
                    {props.selectedVenue?.cuisineTags.map((tag) => <InfoPill key={tag} tone="warm">#{tag}</InfoPill>)}
                    {props.selectedVenue?.flavorTags.map((tag) => <InfoPill key={tag} tone="info">#{tag}</InfoPill>)}
                  </div>
                  <div className="text-sm leading-8 text-[var(--nimi-text-secondary)]">
                    {currentImport.videoSummary || currentImport.description || '当前还没有摘要。'}
                  </div>
                  {props.visibleCommentClues.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">评论补充</div>
                      {props.visibleCommentClues.slice(0, 2).map((clue) => (
                        <Surface key={clue.commentId} tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
                          <div className="text-sm leading-7 text-[var(--nimi-text-primary)]">{clue.message}</div>
                          <div className="mt-2 text-xs text-[var(--nimi-text-muted)]">{clue.authorName || '匿名评论'}</div>
                        </Surface>
                      ))}
                    </div>
                  ) : null}
                </Surface>
              </div>
            </>
          )}
        </Surface>

        <div className="space-y-6">
          <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">今晚可以先看这几家</div>
                <div className="mt-1 text-sm text-[var(--nimi-text-secondary)]">先从已经确认、收藏过、或和你口味对得上的地方开始做决定。</div>
              </div>
              <StatusBadge tone="warning">{decisionCandidates.length} 家</StatusBadge>
            </div>
            <div className="space-y-3">
              {decisionCandidates.length > 0 ? decisionCandidates.map((entry) => (
                <button
                  key={entry.venue.id}
                  type="button"
                  className="vfm-radius-card vfm-list-card-idle w-full border p-4 text-left transition"
                  onClick={() => props.onOpenImport(entry.record.id, entry.venue.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{entry.venue.venueName || '未明确店名'}</div>
                    {entry.venue.isFavorite ? <StatusBadge tone="warning">已收藏</StatusBadge> : null}
                    {entry.venue.userConfirmed ? <StatusBadge tone="success">已确认</StatusBadge> : null}
                  </div>
                  <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{buildTasteReason(entry, props.diningProfile)}</div>
                </button>
              )) : (
                <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">
                  先确认几家靠谱的店，或者把喜欢的地点收进收藏，这里才会慢慢变成你的决策入口。
                </div>
              )}
            </div>
          </Surface>

          <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">继续整理</div>
              <Button tone="secondary" size="sm" onClick={props.onOpenReview}>打开待整理</Button>
            </div>
            <div className="space-y-3">
              {props.reviewItems.length > 0 ? props.reviewItems.slice(0, 3).map((item) => (
                <button
                  key={item.venue.id}
                  type="button"
                  className="vfm-radius-card vfm-list-card-idle w-full border p-4 text-left transition"
                  onClick={props.onOpenReview}
                >
                  <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{item.venue.venueName || '未明确店名'}</div>
                  <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{item.venue.addressText || '还没有稳定地址'}</div>
                </button>
              )) : (
                <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">当前没有待整理项，说明你的空间已经比较干净了。</div>
              )}
            </div>
          </Surface>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.92fr)]">
        <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">最近种草的视频</div>
            <StatusBadge tone="neutral">{props.recentImports.length} 条</StatusBadge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {props.recentImports.slice(0, 4).map((record) => (
              <button
                key={record.id}
                type="button"
                className="vfm-radius-card vfm-list-card-idle border p-4 text-left transition"
                onClick={() => props.onOpenImport(record.id, record.venues[0]?.id || null)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{record.title || '未命名视频'}</div>
                  <StatusBadge tone="info">{record.creatorName || '未知作者'}</StatusBadge>
                </div>
                <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{record.videoSummary || record.description || '还没有摘要。'}</div>
                <div className="mt-3 text-xs text-[var(--nimi-text-muted)]">{formatImportTime(record.updatedAt)}</div>
              </button>
            ))}
          </div>
        </Surface>

        <Surface tone="panel" material="glass-regular" elevation="base" className="vfm-radius-panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-semibold text-[var(--nimi-text-primary)]">最近关注的博主</div>
            <StatusBadge tone="info">{props.creatorSyncs.length} 个</StatusBadge>
          </div>
          <div className="space-y-3">
            {props.creatorSyncs.length > 0 ? props.creatorSyncs.slice(0, 4).map((record) => (
              <Surface key={record.creatorMid} tone="card" material="glass-thin" elevation="base" className="vfm-radius-card p-4">
                <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{record.creatorName || record.creatorMid}</div>
                <div className="mt-2 text-sm text-[var(--nimi-text-secondary)]">
                  上次扫了 {record.lastScannedCount} 条视频，新增 {record.lastQueuedCount} 条。
                </div>
                <div className="mt-2 text-xs text-[var(--nimi-text-muted)]">{formatImportTime(record.lastSyncedAt)}</div>
              </Surface>
            )) : (
              <div className="text-sm leading-7 text-[var(--nimi-text-secondary)]">还没有同步过固定博主。以后常看的来源可以在这里慢慢沉淀下来。</div>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}
