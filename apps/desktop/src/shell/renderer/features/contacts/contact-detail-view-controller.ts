import { type ChangeEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dataSync } from '@runtime/data-sync';
import type { ProfileData, ProfileTab } from '@renderer/features/profile/profile-model';
import { buildEditableDraft, type EditableProfileDraft } from './contact-detail-view-parts.js';

export type ContactDetailViewProps = {
  profile: ProfileData;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  onMessage: () => void;
  onSendGift: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
  showMessageButton?: boolean;
  fullBleed?: boolean;
  isOwnProfile?: boolean;
  onSaveProfile?: (draft: EditableProfileDraft) => Promise<void>;
};

type TabIndicator = {
  left: number;
  width: number;
};

export const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const DEFAULT_TAB: ProfileTab = 'Posts';
const MAX_AVATAR_FILE_SIZE = 10 * 1024 * 1024;

export function useContactDetailViewController(props: ContactDetailViewProps, realmBaseUrl: string) {
  const [activeTab, setActiveTab] = useState<ProfileTab>(DEFAULT_TAB);
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<ProfileTab[]>([DEFAULT_TAB]);
  const [draft, setDraft] = useState<EditableProfileDraft>(() => buildEditableDraft(props.profile));
  const [tabIndicator, setTabIndicator] = useState<TabIndicator>({ left: 0, width: 24 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current
        && !menuRef.current.contains(event.target as Node)
        && menuButtonRef.current
        && !menuButtonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  useEffect(() => {
    setDraft(buildEditableDraft(props.profile));
    setIsEditing(false);
    setIsSaving(false);
    setSaveError(null);
    setActiveTab(DEFAULT_TAB);
    setVisitedTabs([DEFAULT_TAB]);
  }, [props.profile]);

  useEffect(() => {
    setVisitedTabs((current) => (current.includes(activeTab) ? current : [...current, activeTab]));
  }, [activeTab]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const activeButton = tabButtonRefs.current[activeTab];
      const tabList = tabListRef.current;
      if (!activeButton || !tabList) {
        return;
      }

      const compactWidth = Math.min(28, Math.max(20, activeButton.offsetWidth - 22));
      const left = activeButton.offsetLeft + ((activeButton.offsetWidth - compactWidth) / 2);
      setTabIndicator({ left, width: compactWidth });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !props.isOwnProfile) {
      setShowScrollTop(false);
      return;
    }

    const handleScroll = () => {
      setShowScrollTop(container.scrollTop > 420);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [props.isOwnProfile]);

  const cancelEditing = () => {
    setDraft(buildEditableDraft(props.profile));
    setSaveError(null);
    setIsEditing(false);
  };

  const toggleEditing = () => {
    if (isEditing) {
      cancelEditing();
      return;
    }
    setIsEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!props.onSaveProfile) {
      return;
    }
    if (!draft.displayName.trim()) {
      setSaveError('Display name is required');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await props.onSaveProfile(draft);
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setSaveError('Unsupported avatar format. Use PNG, JPEG, GIF, or WebP.');
      return;
    }
    if (file.size > MAX_AVATAR_FILE_SIZE) {
      setSaveError('Avatar must be smaller than 10MB.');
      return;
    }
    if (!realmBaseUrl) {
      setSaveError('Image upload is unavailable right now. Please try again.');
      return;
    }

    setIsUploadingAvatar(true);
    setSaveError(null);
    try {
      const upload = await dataSync.createImageDirectUpload();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(upload.uploadUrl, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error('Failed to upload avatar');
      }
      const avatarUrl = `${realmBaseUrl}/api/media/images/${encodeURIComponent(upload.imageId)}`;
      setDraft((current) => ({ ...current, avatarUrl }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to upload avatar');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return {
    activeTab,
    avatarInputRef,
    cancelEditing,
    draft,
    handleAvatarSelect,
    handleSaveProfile,
    isEditing,
    isSaving,
    isUploadingAvatar,
    menuButtonRef,
    menuRef,
    saveError,
    scrollContainerRef,
    scrollToTop,
    setActiveTab,
    setDraft,
    setShowMenu,
    showMenu,
    showScrollTop,
    tabButtonRefs,
    tabIndicator,
    tabListRef,
    toggleEditing,
    visitedTabs,
  };
}

export type ContactDetailViewController = ReturnType<typeof useContactDetailViewController>;
