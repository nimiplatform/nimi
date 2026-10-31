import { type RefObject, useEffect, useRef, useState } from 'react';
import type { HumanProfileData } from '../profile/profile-model';

export type ProfileDetailViewProps = {
  profile: HumanProfileData;
  loading: boolean;
  error: boolean;
  isBlockedProfile?: boolean;
  isRestrictedProfile?: boolean;
  onClose: () => void;
  onMessage: () => void;
  onAddFriend?: () => void;
  onAcceptRequest?: () => void;
  onRejectRequest?: () => void;
  onCancelRequest?: () => void;
  actionsPending?: boolean;
  addFriendLabel?: string;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onBlock?: () => void;
  onUnblock?: () => void;
  onRemove?: () => void;
  onReport?: () => void;
  showMessageButton?: boolean;
  fullBleed?: boolean;
  isOwnProfile?: boolean;
  hideBackButton?: boolean;
  externalScrollContainerRef?: RefObject<HTMLDivElement | null>;
  onEditProfile?: () => void;
  onOpenFriends?: () => void;
  onOpenPrivacy?: () => void;
};

export function useProfileDetailViewController(props: ProfileDetailViewProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const internalScrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = props.externalScrollContainerRef ?? internalScrollContainerRef;
  useEffect(() => { setShowMenu(false); }, [props.profile.id]);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => setShowScrollTop(container.scrollTop > 420);
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollContainerRef]);
  return { showMenu, setShowMenu, showScrollTop, scrollContainerRef,
    usesExternalScrollContainer: Boolean(props.externalScrollContainerRef),
    scrollToTop: () => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' }),
  };
}

export type ProfileDetailViewController = ReturnType<typeof useProfileDetailViewController>;
