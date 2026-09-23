import { Button, LoadingSkeleton, ProgressIndicator } from '@nimiplatform/kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Image as ImageIcon, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import {
  normalizeMediaType,
  prepareHomeFeedItems,
  resolveMediaThumbnailUrl,
  resolveMediaUrl,
  resolveRenderableMediaAttachment,
} from './utils.js';

type PostDto = RealmModel<'PostDto'>;

// One personal-scope page is enough for a sidebar; the backend has no
// per-author-kind filter yet, so agent posts are picked client-side.
const ACTIVITY_PAGE_SIZE = 20;
export const HOME_ACTIVITY_LIMIT = 5;
const THUMBNAIL_SLOTS = 3;

export type HomeAttentionItem = {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  progress: { value: number; max: number } | null;
  action: string;
  onAction: () => void;
  tone: 'info' | 'warning' | 'neutral';
};

export type HomeActivityThumbnail = { url: string; kind: 'IMAGE' | 'VIDEO' };

export type HomeActivityPost = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  caption: string;
  createdAtLabel: string;
  thumbnails: HomeActivityThumbnail[];
  /** Media beyond the thumbnails shown; rendered as a "+N" tile. */
  hiddenMediaCount: number;
};

export type HomeActivityColumnViewProps = {
  attention: HomeAttentionItem[];
  posts: { status: 'loading' | 'ready' | 'unavailable'; items: HomeActivityPost[] };
  onViewActivity: () => void;
};

/** Newest agent-authored posts in the page; human posts are the viewer's own and stay on the feed. */
export function pickAgentPosts(posts: readonly PostDto[], limit = HOME_ACTIVITY_LIMIT): PostDto[] {
  return prepareHomeFeedItems(posts).filter((post) => post.authorKind !== 'human').slice(0, limit);
}

export function summarizeActivityPost(
  post: PostDto,
  input: { realmBaseUrl: string; i18n: Pick<DesktopI18nResource, 'formatRelativeTime'>; unknownAuthor: string },
): HomeActivityPost {
  const media = (post.attachments ?? [])
    .map((attachment) => {
      const renderable = resolveRenderableMediaAttachment(attachment);
      const kind = normalizeMediaType(renderable?.displayKind);
      if (!kind) return null;
      const url = resolveMediaThumbnailUrl(renderable, input.realmBaseUrl)
        || (kind === 'IMAGE' ? resolveMediaUrl(renderable, input.realmBaseUrl) : undefined);
      return url ? { url, kind } : null;
    })
    .filter((item): item is HomeActivityThumbnail => item !== null);
  const shown = media.length > THUMBNAIL_SLOTS ? THUMBNAIL_SLOTS - 1 : media.length;
  return {
    id: post.id,
    authorName: post.sourceAuthor?.displayName?.trim() || input.unknownAuthor,
    authorAvatarUrl: post.sourceAuthor?.avatarUrl?.trim() || null,
    caption: String(post.caption ?? '').trim(),
    createdAtLabel: input.i18n.formatRelativeTime(post.createdAt),
    thumbnails: media.slice(0, shown),
    hiddenMediaCount: media.length - shown,
  };
}

function AuthorAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return avatarUrl ? (
    <img src={avatarUrl} alt="" className="size-[34px] shrink-0 rounded-[11px] object-cover" />
  ) : (
    <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-[var(--nimi-status-info-soft-bg)] text-sm font-semibold text-[var(--nimi-status-info-soft-text)]">
      {name.trim().slice(0, 1) || '?'}
    </span>
  );
}

function ActivityPostRow({ post, onOpen }: { post: HomeActivityPost; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <article className="flex gap-3 py-3" data-testid={`home-activity-post:${post.id}`}>
      <AuthorAvatar name={post.authorName} avatarUrl={post.authorAvatarUrl} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-2 text-left">
        <span className="flex items-baseline gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{post.authorName}</span>{' '}
            <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.postedActivity')}</span>
          </span>
          <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">{post.createdAtLabel}</span>
        </span>
        {post.caption ? (
          <span className="line-clamp-3 text-[13px]">{post.caption}</span>
        ) : post.thumbnails.length === 0 ? (
          <span className="text-[13px] text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.noCaption')}</span>
        ) : null}
        {post.thumbnails.length ? (
          <span className="grid grid-cols-3 gap-1.5">
            {post.thumbnails.map((thumbnail, index) => (
              <span
                key={`${post.id}:${index}`}
                className="relative aspect-square overflow-hidden rounded-xl bg-[var(--nimi-surface-active)]"
              >
                <img src={thumbnail.url} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                {thumbnail.kind === 'VIDEO' ? (
                  <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">
                    <Play size={16} fill="currentColor" />
                  </span>
                ) : null}
              </span>
            ))}
            {post.hiddenMediaCount > 0 ? (
              <span className="flex aspect-square items-center justify-center rounded-xl bg-[var(--nimi-text-primary)] text-sm font-medium text-[var(--nimi-text-inverse)]">
                {`+${post.hiddenMediaCount}`}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
    </article>
  );
}

/** Presentational sidebar: items needing the user, then recent agent posts. Sections stay independent so one missing source does not hide the other. */
export function HomeActivityColumnView({ attention, posts, onViewActivity }: HomeActivityColumnViewProps) {
  const { t } = useTranslation();
  return (
    <aside
      className="flex min-h-0 flex-col rounded-[24px] bg-[var(--nimi-surface-panel)] shadow-[var(--nimi-elevation-base)]"
      aria-label={t('runtimeConfig.overview.activity')}
      data-testid="home-activity-column"
    >
      {attention.length ? (
        <section className="flex flex-col gap-2.5 px-5 pt-5" data-testid="home-attention">
          <h2 className="text-base font-semibold">{t('runtimeConfig.overview.attention')}</h2>
          <div className="flex flex-col gap-2">
            {attention.map((item) => (
              <div
                key={item.key}
                className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 ${
                  item.tone === 'warning'
                    ? 'border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)]'
                    : 'bg-[var(--nimi-surface-card)]'
                }`}
                data-tone={item.tone}
              >
                <span className="shrink-0">{item.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  {item.progress ? (
                    <ProgressIndicator value={item.progress.value} max={item.progress.max} className="mt-1.5" aria-label={item.title} />
                  ) : null}
                  {item.detail ? (
                    <p className="mt-0.5 truncate text-xs tabular-nums text-[var(--nimi-text-secondary)]">{item.detail}</p>
                  ) : null}
                </div>
                <Button size="sm" tone="secondary" onClick={item.onAction}>
                  {item.action}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col px-5 pt-5" data-testid="home-activity-posts" data-state={posts.status}>
        <h2 className="text-base font-semibold">{t('runtimeConfig.overview.activity')}</h2>
        <div className="mt-1 flex flex-col divide-y divide-[var(--nimi-border-subtle)]">
          {posts.status === 'loading' ? (
            <div className="py-3">
              <LoadingSkeleton lines={3} label={t('Common.loading')} />
            </div>
          ) : posts.status === 'unavailable' ? (
            <p className="py-3 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.postUnavailable')}</p>
          ) : posts.items.length === 0 ? (
            <p className="flex items-center gap-2 py-3 text-sm text-[var(--nimi-text-secondary)]">
              <ImageIcon size={15} />
              {t('runtimeConfig.overview.agentCard.noPost')}
            </p>
          ) : (
            posts.items.map((post) => <ActivityPostRow key={post.id} post={post} onOpen={onViewActivity} />)
          )}
        </div>
      </section>

      <div className="px-5 pb-5 pt-3">
        <Button tone="secondary" size="md" className="w-full" onClick={onViewActivity} data-testid="home-activity-all">
          {t('runtimeConfig.overview.viewAllActivity')}
          <ArrowRight size={14} />
        </Button>
      </div>
    </aside>
  );
}

/** Live wrapper used by Home; agent posts come from the viewer's personal Realm feed. */
export function HomeActivityColumn({ attention, onViewActivity }: { attention: HomeAttentionItem[]; onViewActivity: () => void }) {
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const realmSocialData = useRealmSocialData();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const enabled = authStatus === 'authenticated' && Boolean(ownerUserId);

  const posts = useQuery({
    queryKey: ['home-agent-activity', ownerUserId],
    queryFn: async () => {
      const feed = await realmSocialData.loadPostFeed({ scope: 'personal', limit: ACTIVITY_PAGE_SIZE });
      return pickAgentPosts(feed?.items ?? []);
    },
    enabled,
    staleTime: 60_000,
  });

  const unknownAuthor = t('runtimeConfig.overview.agentCard.title');
  return (
    <HomeActivityColumnView
      attention={attention}
      posts={{
        status: !enabled || posts.isPending ? 'loading' : posts.isError ? 'unavailable' : 'ready',
        items: (posts.data ?? []).map((post) => summarizeActivityPost(post, { realmBaseUrl, i18n, unknownAuthor })),
      }}
      onViewActivity={onViewActivity}
    />
  );
}
