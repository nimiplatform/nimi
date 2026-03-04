import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal';
import { dataSync } from '@runtime/data-sync';
import { AddFriendModal } from './add-friend-modal';
import { PostCardArticle } from './article';
import { BlockUserConfirmModal, DeletePostConfirmModal } from './confirm-modals';
import { ReportModal } from './report-modal';
import { usePostCardUi } from './use-post-card-ui';
import { normalizeMediaType, resolveMediaUrl, resolveVideoPlaybackSource } from './utils';

export function PostCard({ post, onDelete }: { post: PostDto; onDelete?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const currentUserId = useAppStore((state) => state.auth.user?.id);

  const authorId = String(post.author?.id || (post.author as unknown as { _id?: string })?._id || '').trim();
  const hasMedia = post.media && post.media.length > 0;
  const isOwnPost = Boolean(currentUserId && post.author?.id && post.author.id === currentUserId);

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

  const authorRecord = (
    post.author && typeof post.author === 'object'
  )
    ? (post.author as Record<string, unknown>)
    : null;
  const isAuthorFriend = authorRecord?.isFriend === true;

  useEffect(() => {
    ui.setIsFriend(isAuthorFriend);
  }, [isAuthorFriend, ui.setIsFriend]);

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

  const handleReportPost = useCallback(async (reason: string) => {
    try {
      await (dataSync as unknown as { createReport: (params: { targetType: string; targetId: string; reason: string }) => Promise<void> }).createReport({
        targetType: 'POST',
        targetId: post.id,
        reason,
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
      navigate(`/profile/${authorId}`);
    }
  }, [authorId, navigate]);

  return (
    <>
      <PostCardArticle
        post={post}
        authorId={authorId}
        isFriend={ui.isFriend}
        isOwnPost={isOwnPost}
        isLiked={ui.isLiked}
        showPostMenu={ui.showPostMenu}
        menuButtonRef={ui.menuButtonRef}
        firstMediaType={firstMediaType}
        firstMediaUrl={firstMediaUrl}
        firstMediaThumbnail={firstMedia?.thumbnail}
        videoSource={videoSource}
        onOpenAuthorProfile={openAuthorProfile}
        onOpenAddFriendModal={ui.openAddFriendModal}
        onTogglePostMenu={ui.togglePostMenu}
        onOpenEditPost={ui.openEditPost}
        onOpenDeleteConfirm={ui.openDeleteConfirm}
        onOpenBlockConfirm={ui.openBlockConfirm}
        onOpenReportModal={ui.openReportModal}
        onToggleLike={ui.toggleLike}
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

      <DeletePostConfirmModal
        isOpen={ui.showDeleteConfirm}
        pending={ui.isDeleting}
        onClose={() => ui.setShowDeleteConfirm(false)}
        onConfirm={() => {
          void handleDeletePost();
        }}
      />
    </>
  );
}
