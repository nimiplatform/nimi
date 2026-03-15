import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { ReportReason } from '@nimiplatform/sdk/realm';
import { i18n } from '@renderer/i18n';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ContactDetailProfileModal } from '@renderer/features/contacts/contact-detail-profile-modal.js';
import type { ContactDetailProfileSeed } from '@renderer/features/contacts/contact-detail-profile-modal.js';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { CreatePostModal } from '@renderer/features/profile/create-post-modal.js';
import type { EditablePostSeed } from '@renderer/features/profile/create-post-modal-helpers.js';
import { dataSync } from '@runtime/data-sync';
import { AddFriendModal } from './add-friend-modal';
import { PostCardArticle } from './article';
import { BlockUserConfirmModal, DeletePostConfirmModal } from './confirm-modals';
import { EditVisibilityModal } from './edit-visibility-modal';
import { ReportModal } from './report-modal';
import { usePostCardUi } from './use-post-card-ui';
import { normalizeMediaType, resolveMediaUrl, resolveMediaThumbnailUrl, resolveVideoPlaybackSource } from './utils';

const INTERNAL_OPEN_CHAT_ERROR_CODE = 'HOME_OPEN_CHAT_FAILED';

function extractPostMediaId(media: unknown): string {
  if (!media || typeof media !== 'object') {
    return '';
  }
  const payload = media as Record<string, unknown>;
  return String(payload.assetId || '').trim();
}

function toBannerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next && next !== INTERNAL_OPEN_CHAT_ERROR_CODE) {
      return next;
    }
  }
  return fallback;
}

export type PostCardAuthorProfileTarget = {
  profileId: string;
  profileSeed: ContactDetailProfileSeed;
};

type PostCardProps = {
  post: PostDto;
  onDelete?: () => void;
  onBlock?: () => void;
  showAddFriendBadge?: boolean;
  onOpenAuthorProfile?: (target: PostCardAuthorProfileTarget) => void;
};

export function PostCard(input: PostCardProps) {
  const { post, onDelete, onBlock, showAddFriendBadge = true, onOpenAuthorProfile } = input;
  const queryClient = useQueryClient();
  const savedPostsStorageKey = 'nimi.desktop.saved-post-ids';
  const savedPostsUpdatedEvent = 'nimi:saved-posts-updated';

  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUserId = useAppStore((state) => state.auth.user?.id);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [isSavedPost, setIsSavedPost] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const authorId = String(
    post.authorId
    || post.author?.id
    || (post.author as unknown as { _id?: string })?._id
    || '',
  ).trim();
  const hasMedia = post.media && post.media.length > 0;
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
    setStatusBanner,
  });

  const firstMedia = hasMedia
    ? post.media.find((item) => {
      const mediaType = normalizeMediaType(item.type);
      return mediaType === PostMediaType.IMAGE || mediaType === PostMediaType.VIDEO;
    })
    : null;
  const firstMediaType = normalizeMediaType(firstMedia?.type);
  const firstMediaUrl = resolveMediaUrl(firstMedia, realmBaseUrl);
  const firstMediaThumbnail = resolveMediaThumbnailUrl(firstMedia, realmBaseUrl);
  const editPostSeed = useMemo<EditablePostSeed | null>(() => {
    if (!post.id) {
      return null;
    }
    const media: EditablePostSeed['media'] = firstMedia && firstMediaUrl ? {
      id: extractPostMediaId(firstMedia),
      type: firstMediaType === PostMediaType.VIDEO ? 'video' : 'image',
      previewUrl: firstMediaUrl,
    } : null;
    return {
      postId: post.id,
      caption: post.caption,
      tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
      visibility: postVisibility,
      media,
    };
  }, [firstMedia, firstMediaType, firstMediaUrl, post.caption, post.id, post.tags, postVisibility]);
  const videoSource = firstMediaType === PostMediaType.VIDEO ? resolveVideoPlaybackSource(firstMediaUrl) : null;

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
  const isAuthorFriend = authorRecord?.isFriend === true;

  useEffect(() => {
    ui.setIsFriend(isAuthorFriend);
  }, [isAuthorFriend, ui.setIsFriend]);

  useEffect(() => {
    if (post.visibility === 'PUBLIC' || post.visibility === 'FRIENDS' || post.visibility === 'PRIVATE') {
      setPostVisibility(post.visibility);
    }
  }, [post.visibility]);

  useEffect(() => {
    if (!post.id || typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(savedPostsStorageKey);
      const ids = raw ? JSON.parse(raw) : [];
      const savedIds = Array.isArray(ids) ? ids.map(String) : [];
      setIsSavedPost(savedIds.includes(post.id));
    } catch {
      setIsSavedPost(false);
    }
  }, [post.id, savedPostsStorageKey]);

  const handleBlockUser = useCallback(async () => {
    if (!authorId) {
      return;
    }
    ui.setIsBlocking(true);
    try {
      await dataSync.blockUser({
        id: authorId,
        displayName: post.author.displayName || '',
        handle: post.author.handle || '',
        avatarUrl: post.author.avatarUrl,
      });
      setStatusBanner({
        kind: 'success',
        message: `Blocked ${post.author.displayName || post.author.handle}`,
      });
      onBlock?.();
    } catch (error) {
      setStatusBanner({
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
  }, [authorId, post.author.avatarUrl, post.author.displayName, post.author.handle, setStatusBanner, ui]);

  const handleReportPost = useCallback(async (payload: { reason: keyof typeof ReportReason; description?: string }) => {
    try {
      await dataSync.createReport({
        targetType: 'POST',
        targetId: post.id,
        reason: payload.reason,
        description: payload.description,
      });
      setStatusBanner({
        kind: 'success',
        message: i18n.t('Home.reportSubmitted', { defaultValue: 'Report submitted successfully' }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Home.reportSubmitFailed', { defaultValue: 'Failed to submit report' }),
        ),
      });
    } finally {
      ui.setShowReportModal(false);
    }
  }, [post.id, setStatusBanner, ui]);

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
        await dataSync.likePost(post.id);
      } else {
        await dataSync.unlikePost(post.id);
      }
    } catch (error) {
      ui.setIsLiked(previous);
      setStatusBanner({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Home.updateLikeFailed', { defaultValue: 'Failed to update like' }),
        ),
      });
    } finally {
      setIsLikePending(false);
    }
  }, [isLikePending, post.id, setStatusBanner, ui]);

  const handleUpdateVisibility = useCallback(async (visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') => {
    if (!post.id || isVisibilityPending) {
      return;
    }
    setIsVisibilityPending(true);
    try {
      await dataSync.updatePostVisibility(post.id, visibility);
      setPostVisibility(visibility);
      setStatusBanner({
        kind: 'success',
        message: i18n.t('Home.postVisibilityUpdated', { defaultValue: 'Post visibility updated' }),
      });
      ui.setShowEditVisibilityModal(false);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : i18n.t('Home.postVisibilityUpdateFailed', { defaultValue: 'Failed to update post visibility' }),
      });
    } finally {
      setIsVisibilityPending(false);
    }
  }, [isVisibilityPending, post.id, setStatusBanner, ui]);

  const handleDeletePost = useCallback(async () => {
    if (!post.id) {
      return;
    }
    ui.setIsDeleting(true);
    try {
      await dataSync.deletePost(post.id);
      setStatusBanner({ kind: 'success', message: i18n.t('Home.postDeleted', { defaultValue: 'Post deleted successfully' }) });
      onDelete?.();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : i18n.t('Home.postDeleteFailed', { defaultValue: 'Failed to delete post' }),
      });
    } finally {
      ui.setIsDeleting(false);
      ui.setShowDeleteConfirm(false);
    }
  }, [onDelete, post.id, setStatusBanner, ui]);

  const handleEditPost = useCallback(() => {
    ui.togglePostMenu();
    setEditModalOpen(true);
  }, [ui]);

  const handleCopyLink = useCallback(async () => {
    ui.togglePostMenu();
    const postLink = `nimi://moments/posts/${post.id}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(postLink);
      }
      setStatusBanner({
        kind: 'success',
        message: i18n.t('Home.postLinkCopied', { defaultValue: 'Post link copied' }),
      });
    } catch {
      setStatusBanner({
        kind: 'error',
        message: i18n.t('Home.copyLinkFailed', { defaultValue: 'Failed to copy post link' }),
      });
    }
  }, [post.id, setStatusBanner, ui]);

  const handleSavePost = useCallback(() => {
    ui.togglePostMenu();
    if (!post.id || typeof window === 'undefined') {
      setStatusBanner({
        kind: 'error',
        message: i18n.t('Home.savePostFailed', { defaultValue: 'Failed to save post' }),
      });
      return;
    }
    try {
      const raw = window.localStorage.getItem(savedPostsStorageKey);
      const ids = raw ? JSON.parse(raw) : [];
      const savedIds = Array.isArray(ids) ? ids.map(String) : [];
      const nextSaved = !savedIds.includes(post.id);
      const nextIds = nextSaved
        ? [...savedIds, post.id]
        : savedIds.filter((id) => id !== post.id);
      window.localStorage.setItem(savedPostsStorageKey, JSON.stringify(nextIds));
      window.dispatchEvent(new CustomEvent(savedPostsUpdatedEvent, { detail: { savedIds: nextIds } }));
      setIsSavedPost(nextSaved);
      setStatusBanner({
        kind: 'success',
        message: nextSaved
          ? i18n.t('Home.postSaved', { defaultValue: 'Post saved' })
          : i18n.t('Home.postRemovedFromSaved', { defaultValue: 'Post removed from saved' }),
      });
    } catch {
      setStatusBanner({
        kind: 'error',
        message: i18n.t('Home.savePostFailed', { defaultValue: 'Failed to save post' }),
      });
    }
  }, [post.id, savedPostsStorageKey, savedPostsUpdatedEvent, setStatusBanner, ui]);

  const handleAddFriend = useCallback(async () => {
    if (!authorId) {
      throw new Error(i18n.t('Home.missingAuthorForFriendRequest', { defaultValue: 'Cannot add friend: user ID not found' }));
    }
    await dataSync.requestOrAcceptFriend(authorId);
    ui.setIsFriend(true);
    setStatusBanner({
      kind: 'success',
      message: i18n.t('Home.friendRequestSentTo', {
        name: post.author?.displayName || post.author?.handle || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
        defaultValue: 'Friend request sent to {{name}}',
      }),
    });
    await queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }, [authorId, post.author?.displayName, post.author?.handle, queryClient, setStatusBanner, ui]);

  const handleChat = useCallback(async () => {
    const userId = authorId;
    if (!userId) {
      setStatusBanner({
        kind: 'error',
        message: i18n.t('Home.missingAuthorForChat', { defaultValue: 'Cannot start chat: user ID not found' }),
      });
      return;
    }

    if (post.author?.isAgent) {
      setStatusBanner({
        kind: 'error',
        message: i18n.t('Home.agentChatUnavailableFromMoments', { defaultValue: 'Agent chat is not available from Moments.' }),
      });
      return;
    }

    try {
      const result = await dataSync.startChat(userId);
      if (!result?.chatId) {
        throw new Error(INTERNAL_OPEN_CHAT_ERROR_CODE);
      }
      const requestedChatId = String(
        (result.chat && typeof result.chat === 'object'
          ? (result.chat as { id?: string | number }).id
          : null)
        ?? result.chatId,
      ).trim();
      if (!requestedChatId) {
        throw new Error(INTERNAL_OPEN_CHAT_ERROR_CODE);
      }
      const chatsSnapshot = await dataSync.loadChats();
      const createdChat = result.chat && typeof result.chat === 'object'
        ? ({
          ...(result.chat as Record<string, unknown>),
          id: String((result.chat as { id?: string | number }).id ?? requestedChatId),
        })
        : null;
      const snapshotItems = Array.isArray((chatsSnapshot as { items?: unknown[] })?.items)
        ? (chatsSnapshot as { items: unknown[] }).items
        : [];
      const matchedChat = snapshotItems.find((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }
        const otherUser = (item as { otherUser?: { id?: string | number } }).otherUser;
        return String(otherUser?.id ?? '').trim() === userId;
      });
      const chatId = String(
        (matchedChat && typeof matchedChat === 'object'
          ? (matchedChat as { id?: string | number }).id
          : null)
        ?? createdChat?.id
        ?? requestedChatId,
      ).trim();
      if (!chatId) {
        throw new Error(INTERNAL_OPEN_CHAT_ERROR_CODE);
      }
      const mergedItems = createdChat
        ? [createdChat, ...snapshotItems.filter((item) => String((item as { id?: string | number })?.id ?? '') !== chatId)]
        : snapshotItems;
      const nextChatsSnapshot = { ...chatsSnapshot, items: mergedItems };
      queryClient.setQueryData(['chats', authStatus], nextChatsSnapshot);
      queryClient.setQueryData(['chats'], nextChatsSnapshot);
      setSelectedChatId(chatId);
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: userId,
        agentId: '',
        worldId: '',
      });
      setActiveTab('chat');
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          setSelectedChatId(chatId);
        });
      }
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toBannerErrorMessage(
          error,
          i18n.t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' }),
        ),
      });
    }
  }, [
    authorId,
    post.author?.isAgent,
    authStatus,
    queryClient,
    setActiveTab,
    setRuntimeFields,
    setSelectedChatId,
    setStatusBanner,
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
    setProfileModalOpen(true);
  }, [authorId, authorProfileSeed, onOpenAuthorProfile]);

  return (
    <>
      <PostCardArticle
        post={post}
        authorId={authorId}
        isFriend={ui.isFriend}
        isOwnPost={isOwnPost}
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
        onSavePost={handleSavePost}
        isSavedPost={isSavedPost}
        onToggleLike={() => {
          void handleToggleLike();
        }}
        onChat={() => {
          void handleChat();
        }}
        showChatButton={post.author?.isAgent !== true}
        onOpenGift={ui.openGiftModal}
      />

      <SendGiftModal
        open={ui.isSendGiftOpen && Boolean(authorId)}
        receiverId={authorId}
        receiverName={post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' })}
        receiverHandle={post.author?.handle || ''}
        receiverAvatarUrl={post.author?.avatarUrl}
        onClose={() => ui.setIsSendGiftOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: i18n.t('Contacts.giftSentTo', {
              name: post.author?.displayName || post.author?.handle || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
              defaultValue: 'Gift sent to {{name}}',
            }),
          });
          ui.setIsSendGiftOpen(false);
        }}
      />

      <AddFriendModal
        author={{
          name: post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
          handle: post.author?.handle || '',
          avatarUrl: post.author?.avatarUrl,
          isAgent: post.author?.isAgent || false,
        }}
        isOpen={ui.showAddFriendModal}
        onClose={() => ui.setShowAddFriendModal(false)}
        onAddFriend={handleAddFriend}
      />

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

      <CreatePostModal
        open={editModalOpen}
        initialPost={editPostSeed}
        onClose={() => setEditModalOpen(false)}
        onComplete={({ success }) => {
          setEditModalOpen(false);
          if (success) {
            setStatusBanner({
              kind: 'success',
              message: i18n.t('Home.postUpdated', { defaultValue: 'Post updated successfully!' }),
            });
            onDelete?.();
            return;
          }
          setStatusBanner({
            kind: 'error',
            message: i18n.t('Home.postUpdateFailed', { defaultValue: 'Failed to update post' }),
          });
        }}
      />

      <ContactDetailProfileModal
        open={profileModalOpen && Boolean(authorId)}
        profileId={authorId}
        profileSeed={authorProfileSeed}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
}
