import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import { i18n } from '@renderer/i18n';
import type { ProfileDetailSeed } from '@renderer/features/relationship/profile-detail-modal.js';
import type { EditablePostSeed } from '@renderer/features/profile/create-post-modal-helpers.js';
import { readCharacterSourceRefV3 } from '@renderer/features/realm-source/realm-source-identity.js';
import {
  normalizeMediaType,
  resolveMediaUrl,
  resolveMediaThumbnailUrl,
  resolveRenderableMediaAttachment,
  resolveVideoPlaybackSource,
} from './utils';

type PostDto = RealmModel<'PostDto'>;
type PostSourceAuthorDto = NonNullable<PostDto['sourceAuthor']>;

export type PostCardDisplayAuthor = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  isSource: boolean;
};

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
  displayAuthor: PostCardDisplayAuthor | null;
  isSourceAuthored: boolean;
} {
  const { authorId, post } = input;
  const author = post.author ?? null;
  const sourceAuthor = post.sourceAuthor ?? null;
  const isSourceAuthored = post.authorKind !== 'human' && Boolean(sourceAuthor);

  if (isSourceAuthored && sourceAuthor) {
    const sourceAuthorSeed = buildSourceAuthorProfileSeed(sourceAuthor);
    return {
      authorProfileSeed: sourceAuthorSeed,
      displayAuthor: {
        id: sourceAuthor.id,
        displayName: sourceAuthor.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
        handle: sourceAuthor.handle || '',
        avatarUrl: sourceAuthor.avatarUrl ?? null,
        isSource: true,
      },
      isSourceAuthored: true,
    };
  }

  if (!authorId) {
    return {
      authorProfileSeed: null,
      displayAuthor: null,
      isSourceAuthored: false,
    };
  }

  const displayName = author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' });
  const handle = author?.handle || '';

  return {
    authorProfileSeed: {
      id: authorId,
      displayName,
      handle,
      avatarUrl: author?.avatarUrl ?? null,
      bio: author?.bio ?? null,
      isSource: false,
      isOnline: author?.isOnline === true,
      createdAt: author?.createdAt ?? '',
      friendsCount: author?.friendCount,
      sourceState: null,
      sourceArchetype: null,
      sourceOrigin: null,
      sourceTier: null,
      sourcePacing: null,
      sourceOwnershipType: null,
      sourceWorldId: null,
    },
    displayAuthor: {
      id: authorId,
      displayName,
      handle,
      avatarUrl: author?.avatarUrl ?? null,
      isSource: false,
    },
    isSourceAuthored: false,
  };
}

function buildSourceAuthorProfileSeed(sourceAuthor: PostSourceAuthorDto): ProfileDetailSeed {
  const sourceRef = readCharacterSourceRefV3(sourceAuthor.sourceRef);
  if (!sourceRef
    || sourceRef.kind !== sourceAuthor.kind
    || sourceRef.worldId !== sourceAuthor.worldId
    || sourceRef.id !== sourceAuthor.id) {
    throw new Error('Post source author requires a matching CharacterSourceRefV3');
  }
  return {
    id: sourceAuthor.id,
    displayName: sourceAuthor.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
    handle: sourceAuthor.handle || '',
    avatarUrl: sourceAuthor.avatarUrl ?? null,
    bio: null,
    isSource: true,
    isOnline: false,
    createdAt: '',
    friendsCount: undefined,
    sourceState: null,
    sourceArchetype: null,
    sourceOrigin: null,
    sourceTier: null,
    sourcePacing: null,
    sourceOwnershipType: null,
    sourceWorldId: sourceAuthor.worldId,
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.id,
    sourceHash: sourceRef.sourceHash,
    runtimeSourceRef: sourceAuthor.runtimeSourceRef,
    sourceRef,
  };
}
