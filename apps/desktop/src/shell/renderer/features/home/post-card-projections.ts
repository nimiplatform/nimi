import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
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
} {
  const { authorId, post } = input;
  const author = post.author ?? null;
  const agent = author?.agent ?? null;
  const agentProfile = author?.agentProfile ?? null;

  if (!authorId) {
    return {
      authorProfileSeed: null,
    };
  }

  return {
    authorProfileSeed: {
      id: authorId,
      displayName:
        author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      handle: author?.handle || '',
      avatarUrl: author?.avatarUrl ?? null,
      bio: author?.bio ?? null,
      isAgent: author?.isAgent === true,
      isOnline: author?.isOnline === true,
      createdAt: author?.createdAt ?? '',
      friendsCount: author?.friendCount,
      agentState: agent?.state ?? agentProfile?.state ?? null,
      agentCategory: agent?.category ?? null,
      agentOrigin: agent?.origin ?? null,
      agentTier: agent?.tier ?? null,
      agentWakeStrategy: agent?.wakeStrategy ?? null,
      agentOwnershipType:
        agent?.ownershipType ?? agentProfile?.ownershipType ?? null,
      agentWorldId: agent?.worldId ?? agentProfile?.worldId ?? null,
      agentOwnerWorldId: agent?.ownerWorldId ?? agentProfile?.ownerWorldId ?? null,
    },
  };
}
