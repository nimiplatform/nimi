import type { RealmModel } from '@nimiplatform/sdk/realm';
import { getCachedContacts } from './flows/profile-flow-social';

type PostDto = RealmModel<'PostDto'>;

export const BLOCKED_USERS_UPDATED_EVENT = 'nimi:blocked-users-updated';

function normalizeUserId(value: unknown): string {
  return String(value || '').trim();
}

export function getBlockedUserIds(): Set<string> {
  const blocked = getCachedContacts().blocked;
  const ids = new Set<string>();
  for (const item of blocked) {
    const id = normalizeUserId(item.id);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function isBlockedUser(userId: string): boolean {
  const normalized = normalizeUserId(userId);
  return normalized ? getBlockedUserIds().has(normalized) : false;
}

export function getPostAuthorId(post: Partial<PostDto> | null | undefined): string {
  if (!post || typeof post !== 'object') {
    return '';
  }

  const author = typeof post.author === 'object' && post.author
    ? (post.author as { id?: string; _id?: string })
    : null;

  return normalizeUserId(post.authorId) || normalizeUserId(author?.id) || normalizeUserId(author?._id);
}

export function isPostHiddenByBlockedAuthor(post: PostDto | null | undefined): boolean {
  const authorId = getPostAuthorId(post);
  return authorId ? isBlockedUser(authorId) : false;
}

export function filterBlockedPosts<T extends PostDto>(posts: T[]): T[] {
  const blockedIds = getBlockedUserIds();
  if (blockedIds.size === 0) {
    return posts;
  }
  return posts.filter((post) => {
    const authorId = getPostAuthorId(post);
    return !authorId || !blockedIds.has(authorId);
  });
}

export function dispatchBlockedUsersUpdated(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(BLOCKED_USERS_UPDATED_EVENT));
}
