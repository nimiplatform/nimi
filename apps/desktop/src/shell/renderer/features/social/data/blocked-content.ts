import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import type { SocialContactSnapshot } from './social-snapshot';

type PostDto = RealmModel<'PostDto'>;

function normalizeUserId(value: unknown): string {
  return String(value || '').trim();
}

export function getBlockedUserIds(contacts: SocialContactSnapshot): Set<string> {
  const blocked = contacts.blocked;
  const ids = new Set<string>();
  for (const item of blocked) {
    const id = normalizeUserId(item.id);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function isBlockedUser(contacts: SocialContactSnapshot, userId: string): boolean {
  const normalized = normalizeUserId(userId);
  return normalized ? getBlockedUserIds(contacts).has(normalized) : false;
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

export function isPostHiddenByBlockedAuthor(
  contacts: SocialContactSnapshot,
  post: PostDto | null | undefined,
): boolean {
  const authorId = getPostAuthorId(post);
  return authorId ? isBlockedUser(contacts, authorId) : false;
}

export function filterBlockedPosts<T extends PostDto>(
  contacts: SocialContactSnapshot,
  posts: T[],
): T[] {
  const blockedIds = getBlockedUserIds(contacts);
  if (blockedIds.size === 0) {
    return posts;
  }
  return posts.filter((post) => {
    const authorId = getPostAuthorId(post);
    return !authorId || !blockedIds.has(authorId);
  });
}
