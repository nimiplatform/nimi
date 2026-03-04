import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { StatusBanner } from '@renderer/app-shell/providers/store-types';

type SetStatusBanner = (banner: StatusBanner | null) => void;

export type UsePostCardUiInput = {
  authorId: string;
  initialLiked?: boolean;
  setStatusBanner: SetStatusBanner;
};

export type UsePostCardUiResult = {
  isLiked: boolean;
  isSendGiftOpen: boolean;
  isFriend: boolean;
  showAddFriendModal: boolean;
  showPostMenu: boolean;
  showBlockConfirm: boolean;
  showReportModal: boolean;
  showDeleteConfirm: boolean;
  isBlocking: boolean;
  isDeleting: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  setIsFriend: (next: boolean) => void;
  setIsSendGiftOpen: (next: boolean) => void;
  setShowAddFriendModal: (next: boolean) => void;
  setShowBlockConfirm: (next: boolean) => void;
  setShowReportModal: (next: boolean) => void;
  setShowDeleteConfirm: (next: boolean) => void;
  setIsBlocking: (next: boolean) => void;
  setIsDeleting: (next: boolean) => void;
  toggleLike: () => void;
  togglePostMenu: () => void;
  openAddFriendModal: () => boolean;
  openGiftModal: () => boolean;
  openEditPost: () => void;
  openDeleteConfirm: () => void;
  openBlockConfirm: () => void;
  openReportModal: () => void;
};

export function usePostCardUi(input: UsePostCardUiInput): UsePostCardUiResult {
  const { authorId, initialLiked, setStatusBanner } = input;

  const [isLiked, setIsLiked] = useState(Boolean(initialLiked));
  const [isSendGiftOpen, setIsSendGiftOpen] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showPostMenu) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuButtonRef.current?.contains(event.target as Node)) {
        setShowPostMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showPostMenu]);

  const toggleLike = useCallback(() => {
    setIsLiked((prev) => !prev);
  }, []);

  const togglePostMenu = useCallback(() => {
    setShowPostMenu((prev) => !prev);
  }, []);

  const openAddFriendModal = useCallback(() => {
    if (!authorId) {
      setStatusBanner({
        kind: 'error',
        message: 'Cannot add friend: user ID not found',
      });
      return false;
    }
    setShowAddFriendModal(true);
    return true;
  }, [authorId, setStatusBanner]);

  const openGiftModal = useCallback(() => {
    if (!authorId) {
      setStatusBanner({
        kind: 'error',
        message: 'Cannot send gift: user ID not found',
      });
      return false;
    }
    setIsSendGiftOpen(true);
    return true;
  }, [authorId, setStatusBanner]);

  const openEditPost = useCallback(() => {
    setShowPostMenu(false);
    setTimeout(() => {
      setStatusBanner({
        kind: 'info',
        message: 'Edit post feature coming soon',
      });
    }, 0);
  }, [setStatusBanner]);

  const openDeleteConfirm = useCallback(() => {
    setShowPostMenu(false);
    setTimeout(() => {
      setShowDeleteConfirm(true);
    }, 0);
  }, []);

  const openBlockConfirm = useCallback(() => {
    setShowPostMenu(false);
    setTimeout(() => {
      setShowBlockConfirm(true);
    }, 0);
  }, []);

  const openReportModal = useCallback(() => {
    setShowPostMenu(false);
    setTimeout(() => {
      setShowReportModal(true);
    }, 0);
  }, []);

  return {
    isLiked,
    isSendGiftOpen,
    isFriend,
    showAddFriendModal,
    showPostMenu,
    showBlockConfirm,
    showReportModal,
    showDeleteConfirm,
    isBlocking,
    isDeleting,
    menuButtonRef,
    setIsFriend,
    setIsSendGiftOpen,
    setShowAddFriendModal,
    setShowBlockConfirm,
    setShowReportModal,
    setShowDeleteConfirm,
    setIsBlocking,
    setIsDeleting,
    toggleLike,
    togglePostMenu,
    openAddFriendModal,
    openGiftModal,
    openEditPost,
    openDeleteConfirm,
    openBlockConfirm,
    openReportModal,
  };
}
