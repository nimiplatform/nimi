import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { ReportReason } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ContactDetailProfileModal } from '@renderer/features/contacts/contact-detail-profile-modal.js';
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
import { normalizeMediaType, resolveMediaUrl, resolveVideoPlaybackSource } from './utils';

function extractPostMediaId(media: unknown): string {
  if (!media || typeof media !== 'object') {
    return '';
  }
  const payload = media as Record<string, unknown>;
  const candidates = [payload.id, payload.imageId, payload.videoId, payload.uid];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

export function PostCard(input: { post: PostDto; onDelete?: () => void; showAddFriendBadge?: boolean }) {
  const { post, onDelete, showAddFriendBadge = true } = input;
  const queryClient = useQueryClient();
  const savedPostsStorageKey = 'nimi.desktop.saved-post-ids';
  const savedPostsUpdatedEvent = 'nimi:saved-posts-updated';

  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const currentUserId = useAppStore((state) => state.auth.user?.id);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [isSavedPost, setIsSavedPost] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const authorId = String(post.author?.id || (post.author as unknown as { _id?: string })?._id || '').trim();
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
  const firstMediaUrl = resolveMediaUrl(firstMedia);
  const videoSource = firstMediaType === PostMediaType.VIDEO ? resolveVideoPlaybackSource(firstMediaUrl) : null;
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

  const authorRecord = (
    post.author && typeof post.author === 'object'
  )
    ? (post.author as Record<string, unknown>)
    : null;
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
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to block user',
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
      setStatusBanner({ kind: 'success', message: 'Report submitted successfully' });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit report',
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
        message: error instanceof Error ? error.message : 'Failed to update like',
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
        message: 'Post visibility updated',
      });
      ui.setShowEditVisibilityModal(false);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update post visibility',
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
      setStatusBanner({ kind: 'success', message: 'Post deleted successfully' });
      onDelete?.();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete post',
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
        message: 'Post link copied',
      });
    } catch {
      setStatusBanner({
        kind: 'error',
        message: 'Failed to copy post link',
      });
    }
  }, [post.id, setStatusBanner, ui]);

  const handleSavePost = useCallback(() => {
    ui.togglePostMenu();
    if (!post.id || typeof window === 'undefined') {
      setStatusBanner({
        kind: 'error',
        message: 'Failed to save post',
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
        message: nextSaved ? 'Post saved' : 'Post removed from saved',
      });
    } catch {
      setStatusBanner({
        kind: 'error',
        message: 'Failed to save post',
      });
    }
  }, [post.id, savedPostsStorageKey, savedPostsUpdatedEvent, setStatusBanner, ui]);

  const handleAddFriend = useCallback(async () => {
    if (!authorId) {
      throw new Error('Cannot add friend: user ID not found');
    }
    await dataSync.requestOrAcceptFriend(authorId);
    ui.setIsFriend(true);
    setStatusBanner({
      kind: 'success',
      message: `Friend request sent to ${post.author?.displayName || post.author?.handle || 'user'}`,
    });
    await queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }, [authorId, post.author?.displayName, post.author?.handle, queryClient, setStatusBanner, ui]);

  const handleChat = useCallback(async () => {
    const userId = authorId;
    if (!userId) {
      setStatusBanner({ kind: 'error', message: 'Cannot start chat: user ID not found' });
      return;
    }

    if (post.author?.isAgent) {
      let worldId = '';
      try {
        const profile = await dataSync.loadUserProfile(userId);
        const payload = profile as Record<string, unknown>;
        const direct = String(payload.worldId || '').trim();
        if (direct) {
          worldId = direct;
        } else {
          const agent = payload.agent && typeof payload.agent === 'object'
            ? (payload.agent as Record<string, unknown>)
            : null;
          const fromAgent = String(agent?.worldId || '').trim();
          if (fromAgent) {
            worldId = fromAgent;
          }
        }
      } catch {
        worldId = '';
      }

      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: userId,
        agentId: userId,
        targetId: userId,
        worldId,
      });
      openModWorkspaceTab('mod:local-chat', 'Local Chat', 'local-chat');
      setActiveTab('mod:local-chat');
      return;
    }

    try {
      const result = await dataSync.startChat(userId);
      if (!result?.chatId) {
        throw new Error('Failed to create chat');
      }
      const chatId = String(result.chatId);
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: userId,
        agentId: '',
        worldId: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      setActiveTab('chat');
      setTimeout(() => {
        setSelectedChatId(chatId);
      }, 100);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open chat',
      });
    }
  }, [
    authorId,
    openModWorkspaceTab,
    post.author?.isAgent,
    queryClient,
    setActiveTab,
    setRuntimeFields,
    setSelectedChatId,
    setStatusBanner,
  ]);

  const openAuthorProfile = useCallback(() => {
    if (authorId) {
      setSelectedProfileId(authorId);
      setSelectedProfileIsAgent(post.author?.isAgent === true);
      setProfileModalOpen(true);
    }
  }, [authorId, post.author?.isAgent, setSelectedProfileId, setSelectedProfileIsAgent]);

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
        firstMediaThumbnail={firstMedia?.thumbnail}
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
        onOpenGift={ui.openGiftModal}
      />

      <SendGiftModal
        open={ui.isSendGiftOpen && Boolean(authorId)}
        receiverId={authorId}
        receiverName={post.author?.displayName || 'Unknown'}
        receiverHandle={post.author?.handle || ''}
        receiverAvatarUrl={post.author?.avatarUrl}
        onClose={() => ui.setIsSendGiftOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: `Gift sent to ${post.author?.displayName || post.author?.handle || 'user'}`,
          });
          ui.setIsSendGiftOpen(false);
        }}
      />

      <AddFriendModal
        author={{
          name: post.author?.displayName || 'Unknown',
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
        authorName={post.author?.displayName || post.author?.handle || 'Unknown'}
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
              message: 'Post updated successfully',
            });
            onDelete?.();
            return;
          }
          setStatusBanner({
            kind: 'error',
            message: 'Failed to update post',
          });
        }}
      />

      <ContactDetailProfileModal
        open={profileModalOpen && Boolean(authorId)}
        profileId={authorId}
        profileSeed={authorId ? {
          id: authorId,
          displayName: post.author?.displayName || 'Unknown',
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
        } : null}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
}
