import type { RealmModel } from '@nimiplatform/sdk/realm';
import { i18n } from '@renderer/i18n';
import type { ProfileDetailSeed } from '@renderer/features/relationship/profile-detail-modal.js';
import type { EditablePostSeed } from '@renderer/features/profile/create-post-modal-helpers.js';
import {
  normalizeMediaType,
  resolveMediaUrl,
  resolveMediaThumbnailUrl,
  resolveRenderableMediaAttachment,
  resolveVideoPlaybackSource,
} from './utils';

type PostDto = RealmModel<'PostDto'>;

function extractPostAttachmentId(attachment: unknown): string {
  if (!attachment || typeof attachment !== 'object') {
    return '';
  }
  const payload = attachment as Record<string, unknown>;
  return String(payload.targetType === 'RESOURCE' ? payload.targetId || '' : '').trim();
}

export function buildPostCardMediaProjection(input: {
  post: PostDto;
  postVisibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  realmBaseUrl: string;
}) {
  const { post, postVisibility, realmBaseUrl } = input;
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  const firstDisplayAttachment = attachments.length > 0
    ? attachments.find((item) => {
        const attachmentKind = normalizeMediaType(
          resolveRenderableMediaAttachment(item)?.displayKind,
        );
        return attachmentKind === 'IMAGE' || attachmentKind === 'VIDEO';
      })
    : null;
  const firstMedia = resolveRenderableMediaAttachment(firstDisplayAttachment);
  const firstMediaType = normalizeMediaType(firstMedia?.displayKind);
  const firstMediaUrl = resolveMediaUrl(firstMedia, realmBaseUrl);
  const firstMediaThumbnail = resolveMediaThumbnailUrl(firstMedia, realmBaseUrl);
  const editPostSeed: EditablePostSeed | null = post.id
    ? {
        postId: post.id,
        caption: post.caption,
        tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
        visibility: postVisibility,
        attachment:
          firstDisplayAttachment?.targetType === 'RESOURCE' && firstMedia && firstMediaUrl
            ? {
                id: extractPostAttachmentId(firstDisplayAttachment),
                type: firstMediaType === 'VIDEO' ? 'video' : 'image',
                previewUrl: firstMediaUrl,
              }
            : null,
      }
    : null;

  return {
    canEditPostAttachment: Boolean(editPostSeed?.attachment),
    editPostSeed,
    firstMediaThumbnail,
    firstMediaType,
    firstMediaUrl,
    videoSource: firstMediaType === 'VIDEO' ? resolveVideoPlaybackSource(firstMediaUrl) : null,
  };
}

export function buildPostCardAuthorProjection(input: {
  authorId: string;
  post: PostDto;
}): {
  authorProfileSeed: ProfileDetailSeed | null;
  authorRecord: Record<string, unknown> | null;
} {
  const { authorId, post } = input;
  const authorRecord =
    post.author && typeof post.author === 'object'
      ? (post.author as Record<string, unknown>)
      : null;

  if (!authorId) {
    return {
      authorProfileSeed: null,
      authorRecord,
    };
  }

  return {
    authorRecord,
    authorProfileSeed: {
      id: authorId,
      displayName:
        post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      handle: post.author?.handle || '',
      avatarUrl: post.author?.avatarUrl,
      bio: typeof authorRecord?.bio === 'string' ? authorRecord.bio : null,
      isAgent: post.author?.isAgent === true,
      isOnline: authorRecord?.isOnline === true,
      createdAt: typeof authorRecord?.createdAt === 'string' ? authorRecord.createdAt : '',
      tags: Array.isArray(authorRecord?.tags) ? authorRecord.tags.map(String) : [],
      city: typeof authorRecord?.city === 'string' ? authorRecord.city : null,
      countryCode: typeof authorRecord?.countryCode === 'string' ? authorRecord.countryCode : null,
      gender: typeof authorRecord?.gender === 'string' ? authorRecord.gender : null,
      worldName: typeof authorRecord?.worldName === 'string' ? authorRecord.worldName : null,
      worldBannerUrl:
        typeof authorRecord?.worldBannerUrl === 'string' ? authorRecord.worldBannerUrl : null,
      friendsCount:
        typeof authorRecord?.friendsCount === 'number' ? authorRecord.friendsCount : undefined,
      postsCount:
        typeof authorRecord?.postsCount === 'number' ? authorRecord.postsCount : undefined,
      likesCount:
        typeof authorRecord?.likesCount === 'number'
          ? authorRecord.likesCount
          : typeof authorRecord?.likeCount === 'number'
            ? authorRecord.likeCount
            : undefined,
      giftStats:
        authorRecord?.giftStats && typeof authorRecord.giftStats === 'object'
          ? (authorRecord.giftStats as Record<string, number>)
          : undefined,
      agentState: typeof authorRecord?.state === 'string' ? authorRecord.state : null,
      agentCategory: typeof authorRecord?.category === 'string' ? authorRecord.category : null,
      agentOrigin: typeof authorRecord?.origin === 'string' ? authorRecord.origin : null,
      agentTier: typeof authorRecord?.tier === 'string' ? authorRecord.tier : null,
      agentWakeStrategy:
        typeof authorRecord?.wakeStrategy === 'string' ? authorRecord.wakeStrategy : null,
      agentOwnershipType:
        typeof authorRecord?.ownershipType === 'string' ? authorRecord.ownershipType : null,
      agentWorldId: typeof authorRecord?.worldId === 'string' ? authorRecord.worldId : null,
      agentOwnerWorldId:
        typeof authorRecord?.ownerWorldId === 'string' ? authorRecord.ownerWorldId : null,
    },
  };
}
