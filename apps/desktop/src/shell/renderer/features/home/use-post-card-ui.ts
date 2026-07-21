import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import type { StatusBanner } from '../../app-shell/providers/store-types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type SetFeedback = (banner: StatusBanner | null) => void;

export type UsePostCardUiInput = {
  authorId: string;
  initialLiked?: boolean;
  setFeedback: SetFeedback;
};

export type UsePostCardUiResult = {
  isLiked: boolean;
  isSendGiftOpen: boolean;
  isFriend: boolean;
  showAddFriendModal: boolean;
  showPostMenu: boolean;
  showBlockConfirm: boolean;
  showReportModal: boolean;
  showEditVisibilityModal: boolean;
  showDeleteConfirm: boolean;
  isBlocking: boolean;
  isDeleting: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  setIsLiked: (next: boolean) => void;
  setIsFriend: (next: boolean) => void;
  setIsSendGiftOpen: (next: boolean) => void;
  setShowAddFriendModal: (next: boolean) => void;
  setShowBlockConfirm: (next: boolean) => void;
  setShowReportModal: (next: boolean) => void;
  setShowEditVisibilityModal: (next: boolean) => void;
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
  const i18n = useDesktopI18nResource().instance;
  const bindings = useDesktopRendererBindings();
  const { authorId, initialLiked, setFeedback } = input;

  const [isLiked, setIsLiked] = useState(Boolean(initialLiked));
  const [isSendGiftOpen, setIsSendGiftOpen] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showEditVisibilityModal, setShowEditVisibilityModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [deferredActions] = useState(() => new Set<{ cancel: (() => void) | null }>());

  useEffect(() => () => {
    for (const action of deferredActions) action.cancel?.();
    deferredActions.clear();
  }, [deferredActions]);

  const deferAction = useCallback((action: () => void) => {
    const pending = { cancel: null as (() => void) | null };
    deferredActions.add(pending);
    pending.cancel = bindings.clock.schedule(0, (result) => {
      deferredActions.delete(pending);
      if (result.ok) {
        action();
        return;
      }
      setFeedback({ kind: 'error', message: result.error });
    });
  }, [bindings.clock, deferredActions, setFeedback]);

  useEffect(() => {
    if (!showPostMenu) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuButtonRef.current?.contains(event.target as Node)) {
        setShowPostMenu(false);
      }
    };
    return bindings.app.events.subscribeDocumentClick(handleClickOutside);
  }, [bindings.app.events, showPostMenu]);

  const toggleLike = useCallback(() => {
    setIsLiked((prev) => !prev);
  }, []);

  const togglePostMenu = useCallback(() => {
    setShowPostMenu((prev) => !prev);
  }, []);

  const openAddFriendModal = useCallback(() => {
    if (!authorId) {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.missingAuthorForFriendRequest', { defaultValue: 'Cannot add friend: user ID not found' }),
      });
      return false;
    }
    setShowAddFriendModal(true);
    return true;
  }, [authorId, setFeedback]);

  const openGiftModal = useCallback(() => {
    if (!authorId) {
      setFeedback({
        kind: 'error',
        message: i18n.t('Home.missingAuthorForGift', { defaultValue: 'Cannot send gift: user ID not found' }),
      });
      return false;
    }
    setIsSendGiftOpen(true);
    return true;
  }, [authorId, setFeedback]);

  const openEditPost = useCallback(() => {
    setShowPostMenu(false);
    deferAction(() => setShowEditVisibilityModal(true));
  }, [deferAction]);

  const openDeleteConfirm = useCallback(() => {
    setShowPostMenu(false);
    deferAction(() => setShowDeleteConfirm(true));
  }, [deferAction]);

  const openBlockConfirm = useCallback(() => {
    setShowPostMenu(false);
    deferAction(() => setShowBlockConfirm(true));
  }, [deferAction]);

  const openReportModal = useCallback(() => {
    setShowPostMenu(false);
    deferAction(() => setShowReportModal(true));
  }, [deferAction]);

  return {
    isLiked,
    isSendGiftOpen,
    isFriend,
    showAddFriendModal,
    showPostMenu,
    showBlockConfirm,
    showReportModal,
    showEditVisibilityModal,
    showDeleteConfirm,
    isBlocking,
    isDeleting,
    menuButtonRef,
    setIsLiked,
    setIsFriend,
    setIsSendGiftOpen,
    setShowAddFriendModal,
    setShowBlockConfirm,
    setShowReportModal,
    setShowEditVisibilityModal,
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
