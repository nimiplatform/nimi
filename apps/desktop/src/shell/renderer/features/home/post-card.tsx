import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RealmModel, ReportReason } from '@nimiplatform/sdk/realm/generated';

import type { ProfileDetailSeed } from '../relationship/profile-detail-modal.js';
import type { EditablePostSeed } from '../profile/create-post-modal-helpers.js';
import { PostCardArticle } from './article';
import { BlockUserConfirmModal, DeletePostConfirmModal } from './confirm-modals';
import { EditVisibilityModal } from './edit-visibility-modal';
import { ReportModal } from './report-modal';
import { usePostCardUi } from './use-post-card-ui';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import {
  buildPostCardAuthorProjection,
  buildPostCardMediaProjection,
} from './post-card-projections';

type PostDto = RealmModel<'PostDto'>;
type CreateReportDto = RealmModel<'CreateReportDto'>;

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
  profileSeed: ProfileDetailSeed;
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
  updatePostVisibility(
    postId: string,
    visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
  ): Promise<unknown>;
  deletePost(postId: string): Promise<void>;
  copyText(value: string): Promise<void>;
  requestOrAcceptFriend(authorId: string, message?: string): Promise<unknown>;
  openChat(input: { authorId: string; authStatus: string }): Promise<void>;
  invalidateContacts?: () => Promise<unknown>;
  renderGiftSurface?: (input: {
    open: boolean;
    authorId: string;
    authorName: string;
    authorHandle: string;
    authorIsSource: boolean;
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
      isSource: boolean;
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
  const i18n = useDesktopI18nResource().instance;
  const {
    post,
    actionAdapter,
    onDelete,
    onBlock,
    showAddFriendBadge = true,
    onOpenAuthorProfile,
  } = input;

  const realmBaseUrl = actionAdapter.realmBaseUrl;
  const authStatus = actionAdapter.authStatus;
  const currentUserId = actionAdapter.currentUserId;
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  const ownerAuthorId = String(post.authorId || post.author?.id || '').trim();
  const isOwnPost = Boolean(currentUserId && ownerAuthorId === currentUserId);
  const [isLikePending, setIsLikePending] = useState(false);
  const [isVisibilityPending, setIsVisibilityPending] = useState(false);
  const [postVisibility, setPostVisibility] = useState<'PUBLIC' | 'FRIENDS' | 'PRIVATE'>(
    post.visibility === 'PUBLIC' || post.visibility === 'FRIENDS' || post.visibility === 'PRIVATE'
      ? post.visibility
      : 'PUBLIC',
  );

  const {
    canEditPostAttachment,
    editPostSeed,
    firstMediaThumbnail,
    firstMediaType,
    firstMediaUrl,
    videoSource,
  } = useMemo(
    () => buildPostCardMediaProjection({ post, postVisibility, realmBaseUrl }),
    [post, postVisibility, realmBaseUrl],
  );
  const { authorProfileSeed, displayAuthor, isSourceAuthored } = useMemo(
    () => buildPostCardAuthorProjection({
      authorId: ownerAuthorId,
      post,
      unknownDisplayName: String(i18n.t('Common.unknown', { defaultValue: 'Unknown' })),
    }),
    [i18n, ownerAuthorId, post],
  );
  const humanActionAuthorId = isSourceAuthored ? '' : ownerAuthorId;
  const displayProfileId = displayAuthor?.id ?? ownerAuthorId;
  const canUseHumanAuthorActions = Boolean(humanActionAuthorId);

  const ui = usePostCardUi({
    authorId: humanActionAuthorId,
    initialLiked: post.likedByCurrentUser || false,
    setFeedback,
  });

  const isAuthorFriend = canUseHumanAuthorActions
    ? actionAdapter.isFriend(humanActionAuthorId)
    : false;

  useEffect(() => {
    ui.setIsFriend(isAuthorFriend);
  }, [isAuthorFriend, ui.setIsFriend]);

  useEffect(() => {
    if (
      post.visibility === 'PUBLIC' ||
      post.visibility === 'FRIENDS' ||
      post.visibility === 'PRIVATE'
    ) {
      setPostVisibility(post.visibility);
    }
  }, [post.visibility]);

  const handleBlockUser = useCallback(async () => {
    if (!humanActionAuthorId) {
      return;
    }
    ui.setIsBlocking(true);
    try {
      await actionAdapter.blockUser({
        id: humanActionAuthorId,
        displayName: displayAuthor?.displayName || '',
        handle: displayAuthor?.handle || '',
        avatarUrl: displayAuthor?.avatarUrl,
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
  }, [
    actionAdapter,
    displayAuthor?.avatarUrl,
    displayAuthor?.displayName,
    displayAuthor?.handle,
    humanActionAuthorId,
    onBlock,
    ui,
  ]);

  const handleReportPost = useCallback(
    async (payload: { reason: ReportReason; description?: string }) => {
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
    },
    [actionAdapter, post.id, ui],
  );

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

  const handleUpdateVisibility = useCallback(
    async (visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') => {
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
          message:
            error instanceof Error
              ? error.message
              : i18n.t('Home.postVisibilityUpdateFailed', {
                  defaultValue: 'Failed to update post visibility',
                }),
        });
      } finally {
        setIsVisibilityPending(false);
      }
    },
    [actionAdapter, isVisibilityPending, post.id, ui],
  );

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
        message:
          error instanceof Error
            ? error.message
            : i18n.t('Home.postDeleteFailed', { defaultValue: 'Failed to delete post' }),
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
          defaultValue:
            'Editing is only available for resource-backed image and video posts right now.',
        }),
      });
      return;
    }
    setEditModalOpen(true);
  }, [canEditPostAttachment, ui]);

  const handleCopyLink = useCallback(async () => {
    ui.togglePostMenu();
    const webBaseUrl =
      (import.meta as { env?: Record<string, string> }).env?.VITE_WEB_BASE_URL ?? 'https://nimi.ai';
    const postLink = `${webBaseUrl}/posts/${post.id}`;
    try {
      await actionAdapter.copyText(postLink);
      setFeedback(null);
    } catch {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.copyLinkFailed', { defaultValue: 'Failed to copy post link' }),
      });
    }
  }, [actionAdapter, post.id, ui]);

  const handleAddFriend = useCallback(
    async (message?: string) => {
      if (!humanActionAuthorId) {
        throw new Error(
          i18n.t('Home.missingAuthorForFriendRequest', {
            defaultValue: 'Cannot add friend: user ID not found',
          }),
        );
      }
      await actionAdapter.requestOrAcceptFriend(humanActionAuthorId, message);
      ui.setIsFriend(true);
      setFeedback(null);
      await actionAdapter.invalidateContacts?.();
    },
    [actionAdapter, humanActionAuthorId, ui],
  );

  const handleChat = useCallback(async () => {
    const userId = humanActionAuthorId;
    if (!userId) {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.missingAuthorForChat', {
          defaultValue: 'Cannot start chat: user ID not found',
        }),
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
          i18n.t('Relationship.openChatFailed', { defaultValue: 'Failed to open chat' }),
        ),
      });
    }
  }, [actionAdapter, humanActionAuthorId, authStatus]);

  const openAuthorProfile = useCallback(() => {
    if (!displayProfileId || !authorProfileSeed) {
      return;
    }
    if (onOpenAuthorProfile) {
      onOpenAuthorProfile({
        profileId: displayProfileId,
        profileSeed: authorProfileSeed,
      });
      return;
    }
  }, [authorProfileSeed, displayProfileId, onOpenAuthorProfile]);

  return (
    <>
      {feedback ? (
        <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-3" />
      ) : null}
      <PostCardArticle
        post={post}
        authorId={displayProfileId}
        authorName={displayAuthor?.displayName ?? ''}
        authorHandle={displayAuthor?.handle ?? ''}
        authorAvatarUrl={displayAuthor?.avatarUrl}
        authorIsSource={isSourceAuthored}
        canUseHumanAuthorActions={canUseHumanAuthorActions}
        isFriend={ui.isFriend}
        isOwnPost={isOwnPost}
        canEditPost={canEditPostAttachment}
        canEditVisibility={!isSourceAuthored}
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
        showChatButton
        onOpenGift={ui.openGiftModal}
      />

      {actionAdapter.renderGiftSurface?.({
        open: ui.isSendGiftOpen && canUseHumanAuthorActions,
        authorId: humanActionAuthorId,
        authorName:
          displayAuthor?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
        authorHandle: displayAuthor?.handle || '',
        authorIsSource: isSourceAuthored,
        authorAvatarUrl: displayAuthor?.avatarUrl,
        onClose: () => ui.setIsSendGiftOpen(false),
        onSent: () => {
          setFeedback(null);
          ui.setIsSendGiftOpen(false);
        },
      })}

      {actionAdapter.renderFriendRequestSurface?.({
        open: ui.showAddFriendModal && canUseHumanAuthorActions,
        author: {
          name: displayAuthor?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
          handle: displayAuthor?.handle || '',
          avatarUrl: displayAuthor?.avatarUrl,
          isSource: isSourceAuthored,
        },
        onClose: () => ui.setShowAddFriendModal(false),
        onAddFriend: handleAddFriend,
      })}

      <BlockUserConfirmModal
        isOpen={ui.showBlockConfirm}
        authorName={
          displayAuthor?.displayName ||
          displayAuthor?.handle ||
          i18n.t('Common.unknown', { defaultValue: 'Unknown' })
        }
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
