import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import type { HomeRealmPost, HomeRealmThumbnail } from './home-messages-model.js';
import {
  normalizeMediaType,
  prepareHomeFeedItems,
  resolveMediaThumbnailUrl,
  resolveMediaUrl,
  resolveRenderableMediaAttachment,
} from './utils.js';

type PostDto = RealmModel<'PostDto'>;

// The backend has no per-author-kind filter, so agent Posts are picked
// client-side from each personal-scope page.
const REALM_PAGE_SIZE = 20;
/** Home previews at most this many agent Posts. */
export const HOME_REALM_POST_PREVIEW = 5;

/** Agent-authored Posts newest first; human Posts are the viewer's own and stay on the feed. */
export function pickAgentPosts(posts: readonly PostDto[], limit?: number): PostDto[] {
  const agentPosts = prepareHomeFeedItems(posts).filter((post) => post.authorKind !== 'human');
  return limit === undefined ? agentPosts : agentPosts.slice(0, limit);
}

export function summarizeRealmPost(
  post: PostDto,
  input: { realmBaseUrl: string; unknownAuthor: string },
): HomeRealmPost {
  const media = (post.attachments ?? [])
    .map((attachment) => {
      const renderable = resolveRenderableMediaAttachment(attachment);
      const kind = normalizeMediaType(renderable?.displayKind);
      if (!kind) return null;
      const url = resolveMediaThumbnailUrl(renderable, input.realmBaseUrl)
        || (kind === 'IMAGE' ? resolveMediaUrl(renderable, input.realmBaseUrl) : undefined);
      return url ? { url, kind } : null;
    })
    .filter((item): item is HomeRealmThumbnail => item !== null);
  return {
    id: post.id,
    authorKind: post.authorKind,
    // Only Realm's own author identity groups Posts; display names never do.
    authorRef: post.sourceAuthor?.id?.trim() || null,
    authorName: post.sourceAuthor?.displayName?.trim() || input.unknownAuthor,
    authorAvatarUrl: post.sourceAuthor?.avatarUrl?.trim() || null,
    caption: String(post.caption ?? '').trim(),
    createdAt: post.createdAt,
    media,
  };
}

export type HomeRealmPostsStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export type HomeRealmPosts = Readonly<{
  status: HomeRealmPostsStatus;
  /** Loaded agent Posts, newest first. */
  posts: readonly HomeRealmPost[];
  /** A refresh failed; the Posts shown are from the last successful read. */
  stale: boolean;
  /** The personal feed has another page behind its cursor. */
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  retry: () => void;
}>;

/** Agent Posts of the viewer's personal Realm feed, continued by the feed's own cursor. */
export function useHomeRealmPosts(enabled: boolean): HomeRealmPosts {
  const { t } = useTranslation();
  const realmSocialData = useRealmSocialData();
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const active = enabled && Boolean(ownerUserId);
  const query = useInfiniteQuery({
    queryKey: ['home-messages', 'realm-posts', ownerUserId],
    queryFn: async ({ pageParam }) => {
      const feed = await realmSocialData.loadPostFeed({
        scope: 'personal',
        limit: REALM_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return { posts: pickAgentPosts(feed?.items ?? []), nextCursor: feed?.page?.nextCursor ?? null };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: active,
    staleTime: 60_000,
  });
  const unknownAuthor = t('runtimeConfig.overview.agentCard.title');
  const posts = useMemo(() => {
    const seen = new Set<string>();
    const summaries: HomeRealmPost[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const post of page.posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        summaries.push(summarizeRealmPost(post, { realmBaseUrl, unknownAuthor }));
      }
    }
    return summaries;
  }, [query.data, realmBaseUrl, unknownAuthor]);
  return {
    status: !active ? 'idle' : query.isPending ? 'loading' : query.data ? 'ready' : 'unavailable',
    posts,
    stale: query.isRefetchError,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMoreFailed: query.isFetchNextPageError,
    loadMore: () => {
      if (!query.isFetchingNextPage) void query.fetchNextPage();
    },
    retry: () => {
      void query.refetch();
    },
  };
}
