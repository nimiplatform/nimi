import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { ReportReason } from '@nimiplatform/sdk/realm';
import { i18n } from '@renderer/i18n';
import type { ContactDetailProfileSeed } from '@renderer/features/contacts/contact-detail-profile-modal.js';
import type { EditablePostSeed } from '@renderer/features/profile/create-post-modal-helpers.js';
import { PostCardArticle } from './article';
import { BlockUserConfirmModal, DeletePostConfirmModal } from './confirm-modals';
import { EditVisibilityModal } from './edit-visibility-modal';
import { ReportModal } from './report-modal';
import { usePostCardUi } from './use-post-card-ui';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  normalizeMediaType,
  resolveMediaUrl,
  resolveMediaThumbnailUrl,
  resolveRenderableMediaAttachment,
  resolveVideoPlaybackSource,
} from './utils';

type PostDto = RealmModel<'PostDto'>;
type CreateReportDto = RealmModel<'CreateReportDto'>;

function extractPostAttachmentId(attachment: unknown): string {
  if (!attachment || typeof attachment !== 'object') {
    return '';
  }
  const payload = attachment as Record<string, unknown>;
  return String(payload.targetType === 'RESOURCE' ? payload.targetId || '' : '').trim();
}

function toBannerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

export type PostCardAuthorProfileTarget = {
  profileId: string;
  profileSeed: ContactDetailProfileSeed;
};

export type PostCardActionAdapter = {
  realmBaseUrl: string;
  authStatus: string;
  currentUserId: string | null;
  isFriend(authorId: string): boolean;
  blockUser(author: {
    id: string;
    displayName: string;
    handle: string;
    avatarUrl?: string | null;
  }): Promise<unknown>;
  createReport(payload: CreateReportDto): Promise<unknown>;
  likePost(postId: string): Promise<void>;
  unlikePost(postId: string): Promise<void>;
  updatePostVisibility(postId: string, visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE'): Promise<unknown>;
  deletePost(postId: string): Promise<void>;
  requestOrAcceptFriend(authorId: string, message?: string): Promise<unknown>;
  openChat(input: { authorId: string; authStatus: string }): Promise<void>;
  invalidateContacts?: () => Promise<unknown>;
  renderGiftSurface?: (input: {
    open: boolean;
    authorId: string;
    authorName: string;
    authorHandle: string;
    authorIsAgent: boolean;
    authorAvatarUrl?: string | null;
    onClose: () => void;
    onSent: () => void;
  }) => ReactNode;
  renderFriendRequestSurface?: (input: {
    open: boolean;
    author: {
      name: string;
      handle: string;
      avatarUrl?: string | null;
      isAgent: boolean;
    };
    onClose: () => void;
    onAddFriend: (message?: string) => Promise<void>;
  }) => ReactNode;
  renderEditPostSurface?: (input: {
    open: boolean;
    initialPost: EditablePostSeed | null;
    onClose: () => void;
    onComplete: (result: { success: boolean }) => void;
  }) => ReactNode;
};

type PostCardProps = {
  post: PostDto;
  actionAdapter: PostCardActionAdapter;
  onDelete?: () => void;
  onBlock?: () => void;
  showAddFriendBadge?: boolean;
  onOpenAuthorProfile?: (target: PostCardAuthorProfileTarget) => void;
};

export function PostCard(input: PostCardProps) {
  const { post, actionAdapter, onDelete, onBlock, showAddFriendBadge = true, onOpenAuthorProfile } = input;

  const realmBaseUrl = actionAdapter.realmBaseUrl;
  const authStatus = actionAdapter.authStatus;
  const currentUserId = actionAdapter.currentUserId;
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const authorId = String(
    post.authorId
    || post.author?.id
    || (post.author as unknown as { _id?: string })?._id
    || '',
  ).trim();
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  const hasMedia = attachments.length > 0;
  const isOwnPost = Boolean(currentUserId && post.author?.id && post.author.id === currentUserId);
  const [isLikePending, setIsLikePending] = useState(false);
  const [isVisibilityPending, setIsVisibilityPending] = useState(false);
  const [postVisibility, setPostVisibility] = useState<'PUBLIC' | 'FRIENDS' | 'PRIVATE'>(
    post.visibility === 'PUBLIC' || post.visibility === 'FRIENDS' || post.visibility === 'PRIVATE'
      ? post.visibility
      : 'PUBLIC',
  );

  const ui = usePostCardUi({
    authorId,
    initialLiked: post.likedByCurrentUser || false,
    setFeedback,
  });

  const firstDisplayAttachment = hasMedia
    ? attachments.find((item) => {
      const attachmentKind = normalizeMediaType(resolveRenderableMediaAttachment(item)?.displayKind);
      return attachmentKind === 'IMAGE' || attachmentKind === 'VIDEO';
    })
    : null;
  const firstMedia = resolveRenderableMediaAttachment(firstDisplayAttachment);
  const firstMediaType = normalizeMediaType(firstMedia?.displayKind);
  const firstMediaUrl = resolveMediaUrl(firstMedia, realmBaseUrl);
  const firstMediaThumbnail = resolveMediaThumbnailUrl(firstMedia, realmBaseUrl);
  const editPostSeed = useMemo<EditablePostSeed | null>(() => {
    if (!post.id) {
      return null;
    }
    const attachment: EditablePostSeed['attachment'] =
      firstDisplayAttachment?.targetType === 'RESOURCE' && firstMedia && firstMediaUrl
        ? {
      id: extractPostAttachmentId(firstDisplayAttachment),
      type: firstMediaType === 'VIDEO' ? 'video' : 'image',
      previewUrl: firstMediaUrl,
    }
        : null;
    return {
      postId: post.id,
      caption: post.caption,
      tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
      visibility: postVisibility,
      attachment,
    };
  }, [firstDisplayAttachment, firstMedia, firstMediaType, firstMediaUrl, post.caption, post.id, post.tags, postVisibility]);
  const canEditPostAttachment = Boolean(editPostSeed?.attachment);
  const videoSource = firstMediaType === 'VIDEO' ? resolveVideoPlaybackSource(firstMediaUrl) : null;

  const authorRecord = (
    post.author && typeof post.author === 'object'
  )
    ? (post.author as Record<string, unknown>)
    : null;
  const authorProfileSeed = useMemo<ContactDetailProfileSeed | null>(() => {
    if (!authorId) {
      return null;
    }
    return {
      id: authorId,
      displayName: post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
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
      worldBannerUrl: typeof authorRecord?.worldBannerUrl === 'string' ? authorRecord.worldBannerUrl : null,
      friendsCount: typeof authorRecord?.friendsCount === 'number' ? authorRecord.friendsCount : undefined,
      postsCount: typeof authorRecord?.postsCount === 'number' ? authorRecord.postsCount : undefined,
      likesCount: typeof authorRecord?.likesCount === 'number'
        ? authorRecord.likesCount
        : typeof authorRecord?.likeCount === 'number'
          ? authorRecord.likeCount
          : undefined,
      giftStats: authorRecord?.giftStats && typeof authorRecord.giftStats === 'object'
        ? (authorRecord.giftStats as Record<string, number>)
        : undefined,
      agentState: typeof authorRecord?.state === 'string' ? authorRecord.state : null,
      agentCategory: typeof authorRecord?.category === 'string' ? authorRecord.category : null,
      agentOrigin: typeof authorRecord?.origin === 'string' ? authorRecord.origin : null,
      agentTier: typeof authorRecord?.tier === 'string' ? authorRecord.tier : null,
      agentWakeStrategy: typeof authorRecord?.wakeStrategy === 'string' ? authorRecord.wakeStrategy : null,
      agentOwnershipType: typeof authorRecord?.ownershipType === 'string' ? authorRecord.ownershipType : null,
      agentWorldId: typeof authorRecord?.worldId === 'string' ? authorRecord.worldId : null,
      agentOwnerWorldId: typeof authorRecord?.ownerWorldId === 'string' ? authorRecord.ownerWorldId : null,
    };
  }, [authorId, authorRecord, post.author?.avatarUrl, post.author?.displayName, post.author?.handle, post.author?.isAgent]);
  const isAuthorFriend = authorRecord?.isFriend === true || actionAdapter.isFriend(authorId);

  useEffect(() => {
    ui.setIsFriend(isAuthorFriend);
  }, [isAuthorFriend, ui.setIsFriend]);

  useEffect(() => {
    if (post.visibility === 'PUBLIC' || post.visibility === 'FRIENDS' || post.visibility === 'PRIVATE') {
      setPostVisibility(post.visibility);
    }
  }, [post.visibility]);

  const handleBlockUser = useCallback(async () => {
    if (!authorId) {
      return;
    }
    ui.setIsBlocking(true);
    try {
      await actionAdapter.blockUser({
        id: authorId,
        displayName: post.author.displayName || '',
        handle: post.author.handle || '',
        avatarUrl: post.author.avatarUrl,
      });
      setFeedback(null);
      onBlock?.();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Home.blockUserFailed', { defaultValue: 'Failed to block user' }),
        ),
      });
    } finally {
      ui.setIsBlocking(false);
      ui.setShowBlockConfirm(false);
    }
  }, [actionAdapter, authorId, onBlock, post.author.avatarUrl, post.author.displayName, post.author.handle, ui]);

  const handleReportPost = useCallback(async (payload: { reason: keyof typeof ReportReason; description?: string }) => {
    try {
      await actionAdapter.createReport({
        targetType: 'POST',
        targetId: post.id,
        reason: payload.reason,
        description: payload.description,
      });
      setFeedback(null);
      ui.setShowReportModal(false);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Home.reportSubmitFailed', { defaultValue: 'Failed to submit report' }),
        ),
      });
      throw error;
    }
  }, [actionAdapter, post.id, ui]);

  const handleToggleLike = useCallback(async () => {
    if (!post.id || isLikePending) {
      return;
    }
    const previous = ui.isLiked;
    const next = !previous;
      ui.setIsLiked(next);
      setIsLikePending(true);
    try {
      if (next) {
        await actionAdapter.likePost(post.id);
      } else {
        await actionAdapter.unlikePost(post.id);
      }
    } catch (error) {
      ui.setIsLiked(previous);
      setFeedback({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Home.updateLikeFailed', { defaultValue: 'Failed to update like' }),
        ),
      });
    } finally {
      setIsLikePending(false);
    }
  }, [actionAdapter, isLikePending, post.id, ui]);

  const handleUpdateVisibility = useCallback(async (visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') => {
    if (!post.id || isVisibilityPending) {
      return;
    }
    setIsVisibilityPending(true);
    try {
      await actionAdapter.updatePostVisibility(post.id, visibility);
      setPostVisibility(visibility);
      setFeedback(null);
      ui.setShowEditVisibilityModal(false);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : i18n.t('Home.postVisibilityUpdateFailed', { defaultValue: 'Failed to update post visibility' }),
      });
    } finally {
      setIsVisibilityPending(false);
    }
  }, [actionAdapter, isVisibilityPending, post.id, ui]);

  const handleDeletePost = useCallback(async () => {
    if (!post.id) {
      return;
    }
    ui.setIsDeleting(true);
    try {
      await actionAdapter.deletePost(post.id);
      setFeedback(null);
      onDelete?.();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : i18n.t('Home.postDeleteFailed', { defaultValue: 'Failed to delete post' }),
      });
    } finally {
      ui.setIsDeleting(false);
      ui.setShowDeleteConfirm(false);
    }
  }, [actionAdapter, onDelete, post.id, ui]);

  const handleEditPost = useCallback(() => {
    ui.togglePostMenu();
    if (!canEditPostAttachment) {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.editUnsupportedAttachment', {
          defaultValue: 'Editing is only available for resource-backed image and video posts right now.',
        }),
      });
      return;
    }
    setEditModalOpen(true);
  }, [canEditPostAttachment, ui]);

  const handleCopyLink = useCallback(async () => {
    ui.togglePostMenu();
    const webBaseUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_WEB_BASE_URL ?? 'https://nimi.xyz';
    const postLink = `${webBaseUrl}/posts/${post.id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(postLink);
      }
      setFeedback(null);
    } catch {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.copyLinkFailed', { defaultValue: 'Failed to copy post link' }),
      });
    }
  }, [post.id, ui]);

  const handleAddFriend = useCallback(async (message?: string) => {
    if (!authorId) {
      throw new Error(i18n.t('Home.missingAuthorForFriendRequest', { defaultValue: 'Cannot add friend: user ID not found' }));
    }
    await actionAdapter.requestOrAcceptFriend(authorId, message);
    ui.setIsFriend(true);
    setFeedback(null);
    await actionAdapter.invalidateContacts?.();
  }, [actionAdapter, authorId, ui]);

  const handleChat = useCallback(async () => {
    const userId = authorId;
    if (!userId) {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.missingAuthorForChat', { defaultValue: 'Cannot start chat: user ID not found' }),
      });
      return;
    }

    try {
      await actionAdapter.openChat({ authorId: userId, authStatus });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' }),
        ),
      });
    }
  }, [
    actionAdapter,
    authorId,
    authStatus,
  ]);

  const openAuthorProfile = useCallback(() => {
    if (!authorId || !authorProfileSeed) {
      return;
    }
    if (onOpenAuthorProfile) {
      onOpenAuthorProfile({
        profileId: authorId,
        profileSeed: authorProfileSeed,
      });
      return;
    }
  }, [authorId, authorProfileSeed, onOpenAuthorProfile]);

  return (
    <>
      {feedback ? (
        <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-3" />
      ) : null}
      <PostCardArticle
        post={post}
        authorId={authorId}
        isFriend={ui.isFriend}
        isOwnPost={isOwnPost}
        canEditPost={canEditPostAttachment}
        showAddFriendBadge={showAddFriendBadge}
        isLiked={ui.isLiked}
        isLikePending={isLikePending}
        showPostMenu={ui.showPostMenu}
        menuButtonRef={ui.menuButtonRef}
        firstMediaType={firstMediaType}
        firstMediaUrl={firstMediaUrl}
        firstMediaThumbnail={firstMediaThumbnail}
        videoSource={videoSource}
        onOpenAuthorProfile={openAuthorProfile}
        onOpenAddFriendModal={ui.openAddFriendModal}
        onTogglePostMenu={ui.togglePostMenu}
        onOpenEditPost={handleEditPost}
        onOpenEditVisibility={ui.openEditPost}
        onOpenDeleteConfirm={ui.openDeleteConfirm}
        onOpenBlockConfirm={ui.openBlockConfirm}
        onOpenReportModal={ui.openReportModal}
        onCopyLink={() => {
          void handleCopyLink();
        }}
        onToggleLike={() => {
          void handleToggleLike();
        }}
        onChat={() => {
          void handleChat();
        }}
        showChatButton={post.author?.isAgent !== true}
        onOpenGift={ui.openGiftModal}
      />

      {actionAdapter.renderGiftSurface?.({
        open: ui.isSendGiftOpen && Boolean(authorId),
        authorId,
        authorName: post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
        authorHandle: post.author?.handle || '',
        authorIsAgent: post.author?.isAgent === true,
        authorAvatarUrl: post.author?.avatarUrl,
        onClose: () => ui.setIsSendGiftOpen(false),
        onSent: () => {
          setFeedback(null);
          ui.setIsSendGiftOpen(false);
        },
      })}

      {actionAdapter.renderFriendRequestSurface?.({
        open: ui.showAddFriendModal,
        author: {
          name: post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
          handle: post.author?.handle || '',
          avatarUrl: post.author?.avatarUrl,
          isAgent: post.author?.isAgent || false,
        },
        onClose: () => ui.setShowAddFriendModal(false),
        onAddFriend: handleAddFriend,
      })}

      <BlockUserConfirmModal
        isOpen={ui.showBlockConfirm}
        authorName={post.author?.displayName || post.author?.handle || i18n.t('Common.unknown', { defaultValue: 'Unknown' })}
        pending={ui.isBlocking}
        onClose={() => ui.setShowBlockConfirm(false)}
        onConfirm={() => {
          void handleBlockUser();
        }}
      />

      {ui.showReportModal ? (
        <ReportModal
          post={post}
          onClose={() => ui.setShowReportModal(false)}
          onSubmit={handleReportPost}
        />
      ) : null}

      {ui.showEditVisibilityModal ? (
        <EditVisibilityModal
          currentVisibility={postVisibility}
          pending={isVisibilityPending}
          onClose={() => ui.setShowEditVisibilityModal(false)}
          onSubmit={handleUpdateVisibility}
        />
      ) : null}

      <DeletePostConfirmModal
        isOpen={ui.showDeleteConfirm}
        pending={ui.isDeleting}
        onClose={() => ui.setShowDeleteConfirm(false)}
        onConfirm={() => {
          void handleDeletePost();
        }}
      />

      {actionAdapter.renderEditPostSurface?.({
        open: editModalOpen,
        initialPost: editPostSeed,
        onClose: () => setEditModalOpen(false),
        onComplete: ({ success }) => {
          setEditModalOpen(false);
          if (success) {
            setFeedback(null);
            onDelete?.();
            return;
          }
          setFeedback({
            kind: 'error',
            message: i18n.t('Home.postUpdateFailed', { defaultValue: 'Failed to update post' }),
          });
        },
      })}
    </>
  );
}
