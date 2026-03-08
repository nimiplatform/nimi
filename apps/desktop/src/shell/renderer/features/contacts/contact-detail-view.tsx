import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@renderer/components/tooltip.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { CollectionsTab } from '@renderer/features/profile/collections-tab';
import { GiftsTab } from '@renderer/features/profile/gifts-tab';
import { LikesTab } from '@renderer/features/profile/likes-tab';
import { PostsTab } from '@renderer/features/profile/posts-tab';
import { formatProfileDate, type ProfileData, type ProfileTab } from '@renderer/features/profile/profile-model';
import {
  AlertIcon,
  ArrowUpIcon,
  buildEditableDraft,
  CalendarIcon,
  CheckIcon,
  DotsIcon,
  EditableField,
  EyeIcon,
  GiftIcon,
  IconButton,
  type EditableProfileDraft,
  InlineMeta,
  LocationIcon,
  MessageIcon,
  OriginIcon,
  PencilIcon,
  SpinnerIcon,
  StatDivider,
  StatTile,
  TrashIcon,
  WorldMetaLink,
} from './contact-detail-view-parts.js';

const SHOW_AVATAR_ONLINE_INDICATOR = false;

type ContactDetailViewProps = {
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

const CONTACT_DETAIL_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

export type { EditableProfileDraft } from './contact-detail-view-parts.js';

export function ContactDetailView(props: ContactDetailViewProps) {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [draft, setDraft] = useState<EditableProfileDraft>(() => buildEditableDraft(props.profile));
  const [tabIndicator, setTabIndicator] = useState<TabIndicator>({ left: 0, width: 24 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
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
  }, [props.profile]);

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

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f3f6f8]">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-[#1f8f69]" />
          {t('ProfileView.loading')}
        </div>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f3f6f8]">
        <div className="rounded-[28px] border border-red-100 bg-white px-8 py-10 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertIcon className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-red-600">{t('ProfileView.error')}</p>
          <button
            type="button"
            onClick={props.onClose}
            className="mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {t('Common.back')}
          </button>
        </div>
      </div>
    );
  }

  const { profile } = props;
  const friendCount = profile.stats?.friendsCount ?? 0;
  const postCount = profile.stats?.postsCount ?? 0;
  const likesCount = profile.stats?.likesCount ?? 0;
  const headerStyle = profile.worldBannerUrl
    ? {
        backgroundImage: `linear-gradient(120deg, rgba(7, 20, 17, 0.58), rgba(7, 20, 17, 0.18)), url(${profile.worldBannerUrl})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : {
        backgroundImage: [
          'radial-gradient(44% 56% at 18% 18%, rgba(102, 221, 183, 0.74) 0%, rgba(102, 221, 183, 0.36) 38%, rgba(102, 221, 183, 0.08) 62%, rgba(102, 221, 183, 0) 78%)',
          'radial-gradient(40% 48% at 50% 10%, rgba(170, 146, 255, 0.50) 0%, rgba(170, 146, 255, 0.23) 38%, rgba(170, 146, 255, 0.07) 62%, rgba(170, 146, 255, 0.01) 74%, rgba(170, 146, 255, 0) 84%)',
          'radial-gradient(34% 40% at 78% 11%, rgba(236, 244, 112, 0.54) 0%, rgba(236, 244, 112, 0.23) 36%, rgba(236, 244, 112, 0.07) 60%, rgba(236, 244, 112, 0.01) 72%, rgba(236, 244, 112, 0) 82%)',
          'radial-gradient(32% 28% at 64% 12%, rgba(222, 233, 204, 0.30) 0%, rgba(222, 233, 204, 0.15) 36%, rgba(222, 233, 204, 0.05) 60%, rgba(222, 233, 204, 0) 80%)',
          'radial-gradient(56% 70% at 26% 62%, rgba(49, 182, 234, 0.36) 0%, rgba(49, 182, 234, 0.14) 34%, rgba(49, 182, 234, 0.03) 56%, rgba(49, 182, 234, 0) 78%)',
          'radial-gradient(52% 68% at 72% 58%, rgba(167, 203, 255, 0.30) 0%, rgba(167, 203, 255, 0.10) 34%, rgba(167, 203, 255, 0.02) 58%, rgba(167, 203, 255, 0) 80%)',
          'radial-gradient(60% 84% at 54% 110%, rgba(74, 213, 192, 0.60) 0%, rgba(74, 213, 192, 0.26) 40%, rgba(74, 213, 192, 0.05) 64%, rgba(74, 213, 192, 0) 82%)',
          'linear-gradient(135deg, #d9f1ea 0%, #e0f7ef 28%, #e8f8f5 52%, #edf9f9 76%, #f4fbfb 100%)',
        ].join(', '),
        backgroundBlendMode: 'screen, screen, screen, screen, screen, screen, screen, normal',
      };
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || 'Unknown region';
  const originLabel = profile.agentOrigin || 'Unknown origin';
  const joinedLabel = formatProfileDate(profile.createdAt) || 'Unknown joined date';
  const worldLabel = profile.worldName || 'Unknown world';
  const worldNavigationId = profile.agentOwnerWorldId || profile.agentWorldId || '';
  const canVisitWorld = Boolean(worldNavigationId);
  const headline = profile.bio || (profile.isAgent
    ? 'This contact has no public profile summary yet.'
    : 'No profile summary has been added yet.');
  const showGiftButton = !props.isOwnProfile;

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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#eef3f4_0%,#f7fafb_48%,#fcfefd_100%)]">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className={`${props.fullBleed ? 'flex min-h-full w-full flex-col' : 'mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6'}`}>
          <section className="relative overflow-hidden rounded-[34px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
            <div className="relative h-[220px] px-8 py-7" style={headerStyle}>
              {canVisitWorld ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfileId(profile.id);
                    setSelectedProfileIsAgent(profile.isAgent);
                    navigateToWorld(worldNavigationId);
                  }}
                  className="absolute inset-x-0 top-0 z-10 h-[140px] cursor-pointer"
                  aria-label={`Visit ${worldLabel}`}
                />
              ) : null}
              {!profile.worldBannerUrl ? (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.34),transparent_36%)]" />
                  <div className="pointer-events-none absolute -left-6 top-4 h-40 w-44 rounded-full bg-[#73e0bc]/24 blur-[44px]" />
                  <div className="pointer-events-none absolute left-[34%] top-[-2%] h-36 w-40 rounded-full bg-[#a98fff]/20 blur-[48px]" />
                  <div className="pointer-events-none absolute right-[10%] top-[-1%] h-36 w-42 rounded-full bg-[#edf369]/22 blur-[52px]" />
                  <div className="pointer-events-none absolute left-[55%] top-[3%] h-24 w-34 rounded-full bg-white/22 blur-[42px]" />
                  <div className="pointer-events-none absolute left-[14%] top-[46%] h-52 w-44 rounded-full bg-[#3db6ea]/18 blur-[54px]" />
                  <div className="pointer-events-none absolute right-[18%] bottom-[-10%] h-48 w-44 rounded-full bg-[#57d7c2]/22 blur-[52px]" />
                  <div className="pointer-events-none absolute right-[0%] top-[24%] h-56 w-24 rounded-full bg-white/20 blur-[46px]" />
                </>
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_32%)]" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/82 to-transparent" />

              <div className="relative z-10 flex items-start justify-between gap-4">
                <span />
                {props.isOwnProfile ? (
                  <Tooltip content={isEditing ? 'Exit edit mode' : 'Edit profile'} placement="bottom">
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          setDraft(buildEditableDraft(profile));
                          setIsEditing(false);
                          return;
                        }
                        setIsEditing(true);
                      }}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-[#9fe3cd] bg-white/92 px-4 text-[#1f8f69] shadow-[0_10px_26px_rgba(31,143,105,0.12)] backdrop-blur-md transition hover:border-[#4ECCA3] hover:bg-white"
                    >
                      {isEditing ? <EyeIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
                      <span className="text-sm font-semibold">{isEditing ? 'Preview' : 'Edit profile'}</span>
                    </button>
                  </Tooltip>
                ) : (props.onBlock || props.onRemove) ? (
                  <div className="relative">
                    <Tooltip content="More options" placement="bottom">
                      <button
                        ref={menuButtonRef}
                        type="button"
                        onClick={() => setShowMenu((value) => !value)}
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-white/15 text-white backdrop-blur-md transition hover:bg-white/22"
                      >
                        <DotsIcon className="h-4 w-4" />
                      </button>
                    </Tooltip>
                    {showMenu ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-slate-100 bg-white py-1.5 shadow-[0_22px_64px_rgba(15,23,42,0.18)]"
                      >
                        {props.onBlock ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMenu(false);
                              props.onBlock?.();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            <AlertIcon className="h-4 w-4 text-slate-400" />
                            Block
                          </button>
                        ) : null}
                        {props.onRemove ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMenu(false);
                              props.onRemove?.();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                          >
                            <TrashIcon className="h-4 w-4 text-red-500" />
                            Remove Friend
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative px-8 pb-8">
              <div className="-mt-20 grid gap-6 xl:grid-cols-[minmax(0,1fr),320px]">
                <div className="min-w-0">
                  <div className="rounded-[30px] border border-white/38 bg-white/40 px-6 py-7 shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-[18px] supports-[backdrop-filter]:bg-white/30 xl:px-7">
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                      <div className="flex shrink-0 flex-col items-start gap-3 xl:pt-[6px]">
                        <div className="relative">
                          <EntityAvatar
                            imageUrl={profile.avatarUrl}
                            name={profile.displayName}
                            kind={profile.isAgent ? 'agent' : 'human'}
                            sizeClassName="h-24 w-24"
                            textClassName="text-3xl font-bold"
                            fallbackClassName={profile.isAgent ? undefined : 'bg-gradient-to-br from-[#dff8ef] to-[#f2fbff] text-[#1f8f69]'}
                          />
                          {SHOW_AVATAR_ONLINE_INDICATOR && profile.isOnline ? (
                            <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-[#28c189] shadow-sm" />
                          ) : null}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2" />
                            {isEditing ? (
                              <div className="mt-3 max-w-[540px] space-y-4">
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Display name</span>
                                  <input
                                    type="text"
                                    value={draft.displayName}
                                    onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[28px] font-semibold leading-[1.05] tracking-[0.02em] text-[#1A1A1B] outline-none transition focus:border-[#4ECCA3] focus:ring-4 focus:ring-[#4ECCA3]/10"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Handle</span>
                                  <input
                                    type="text"
                                    value={profile.handle}
                                    disabled
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Bio</span>
                                  <textarea
                                    value={draft.bio}
                                    onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                                    rows={4}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[14px] leading-[1.7] text-[#424245] outline-none transition focus:border-[#4ECCA3] focus:ring-4 focus:ring-[#4ECCA3]/10"
                                  />
                                </label>
                              </div>
                            ) : (
                              <>
                                <h1 className="mt-1 text-[30px] font-semibold leading-[1.05] tracking-[0.05em] text-[#1A1A1B] xl:text-[32px]">
                                  {profile.displayName}
                                </h1>
                                <p className="mt-2 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]">
                                  {profile.handle}
                                </p>
                                <p className="mt-5 max-w-[420px] text-[14px] leading-[1.7] text-[#424245]">
                                  {headline}
                                </p>
                              </>
                            )}
                            <div className="mt-4 xl:hidden">
                              <div className="grid max-w-[228px] grid-cols-3 gap-2">
                                <StatTile label="Friends" value={friendCount} />
                                <StatTile label="Posts" value={postCount} />
                                <StatTile label="Likes" value={likesCount} />
                              </div>
                              {isEditing && props.isOwnProfile ? (
                                <div className="mt-4 flex flex-col gap-3">
                                  {saveError ? (
                                    <p className="text-sm text-red-500">{saveError}</p>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleSaveProfile();
                                    }}
                                    disabled={isSaving || !draft.displayName.trim()}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#4ECCA3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#41b992] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isSaving ? <SpinnerIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
                                    {isSaving ? 'Saving...' : 'Save profile'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDraft(buildEditableDraft(profile));
                                      setSaveError(null);
                                      setIsEditing(false);
                                    }}
                                    disabled={isSaving}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="mt-3 flex items-center gap-2">
                                  {props.showMessageButton !== false ? (
                                    <IconButton
                                      icon={<MessageIcon className="h-4 w-4" />}
                                      label="Message"
                                      onClick={props.onMessage}
                                    />
                                  ) : null}
                                  {showGiftButton ? (
                                    <IconButton
                                      icon={<GiftIcon className="h-4 w-4" />}
                                      label="Send Gift"
                                      onClick={props.onSendGift}
                                    />
                                  ) : null}
                                </div>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="mt-7 max-w-[640px] rounded-[24px] border border-[#dbe7e3] bg-[linear-gradient(180deg,rgba(78,204,163,0.08)_0%,rgba(255,255,255,0.95)_100%)] p-5 shadow-[0_14px_34px_rgba(78,204,163,0.08)]">
                                <div className="mb-4 flex items-center gap-2">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#4ECCA3]/12 text-[#1f8f69]">
                                    <PencilIcon className="h-4 w-4" />
                                  </span>
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">Edit mode</div>
                                    <div className="text-xs text-slate-500">Update your public profile details shown across Moments, Contacts, and chat.</div>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <EditableField
                                  label="City"
                                  value={draft.city}
                                  onChange={(value) => setDraft((current) => ({ ...current, city: value }))}
                                />
                                <EditableField
                                  label="Country code"
                                  value={draft.countryCode}
                                  onChange={(value) => setDraft((current) => ({ ...current, countryCode: value.toUpperCase() }))}
                                />
                                <EditableField
                                  label="Gender"
                                  value={draft.gender}
                                  onChange={(value) => setDraft((current) => ({ ...current, gender: value }))}
                                />
                                <EditableField
                                  label="Languages"
                                  value={draft.languages}
                                  onChange={(value) => setDraft((current) => ({ ...current, languages: value }))}
                                  placeholder="English, Chinese"
                                />
                                <div className="md:col-span-2">
                                  <EditableField
                                    label="Tags"
                                    value={draft.tags}
                                    onChange={(value) => setDraft((current) => ({ ...current, tags: value }))}
                                    placeholder="creator, traveler, world-native"
                                  />
                                </div>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="mt-7 grid max-w-[460px] grid-cols-2 gap-x-12 gap-y-3.5 text-sm text-slate-600">
                                  <InlineMeta value={joinedLabel} icon={<CalendarIcon className="h-3.5 w-3.5" />} />
                                  <InlineMeta value={locationLabel} icon={<LocationIcon className="h-3.5 w-3.5" />} />
                                  <WorldMetaLink
                                    value={worldLabel}
                                    canVisit={canVisitWorld}
                                    onClick={canVisitWorld ? () => navigateToWorld(worldNavigationId) : undefined}
                                  />
                                  <InlineMeta value={originLabel} icon={<OriginIcon className="h-3.5 w-3.5" />} />
                                </div>
                                {profile.tags.length > 0 ? (
                                  <div className="mt-7 flex flex-wrap gap-2.5">
                                    {profile.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        className="rounded-full bg-[rgba(15,23,42,0.05)] px-3 py-1.5 text-[12px] font-medium backdrop-blur-sm transition hover:bg-[rgba(15,23,42,0.08)] hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
                                        style={{
                                          color: '#1f8f69',
                                        }}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>

                          <div className="hidden shrink-0 xl:ml-auto xl:flex xl:w-[344px] xl:flex-col xl:items-end xl:border-l xl:border-white/35 xl:pl-10">
                            <div className="mt-[6px] flex w-full items-center justify-end gap-3">
                                {props.showMessageButton !== false ? (
                                  <IconButton
                                    icon={<MessageIcon className="h-4 w-4" />}
                                    label="Message"
                                    onClick={props.onMessage}
                                  />
                                ) : null}
                                {showGiftButton ? (
                                  <IconButton
                                    icon={<GiftIcon className="h-4 w-4" />}
                                    label="Send Gift"
                                    onClick={props.onSendGift}
                                  />
                                ) : null}
                            </div>
                            <div className="mt-[62px] grid w-[260px] grid-cols-[1fr_18px_1fr_18px_1fr] items-start gap-x-0">
                              <StatTile label="Friends" value={friendCount} />
                              <StatDivider />
                              <StatTile label="Posts" value={postCount} />
                              <StatDivider />
                              <StatTile label="Likes" value={likesCount} />
                            </div>
                            {props.isOwnProfile && isEditing ? (
                              <div className="mt-8 flex w-full flex-col gap-3">
                                {saveError ? (
                                  <p className="text-sm text-red-500">{saveError}</p>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleSaveProfile();
                                  }}
                                  disabled={isSaving || !draft.displayName.trim()}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#4ECCA3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#41b992] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isSaving ? <SpinnerIcon className="h-4 w-4" /> : <CheckIcon className="h-4 w-4" />}
                                  {isSaving ? 'Saving...' : 'Save profile'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraft(buildEditableDraft(profile));
                                    setSaveError(null);
                                    setIsEditing(false);
                                  }}
                                  disabled={isSaving}
                                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <section className="min-w-0 space-y-6">
                      <div className="bg-transparent">
                        <div className="px-4">
                          <div
                            ref={tabListRef}
                            className="relative flex flex-wrap gap-6 border-b border-slate-200/70 pb-3"
                          >
                            {CONTACT_DETAIL_TABS.map((tab) => (
                              <button
                                key={tab}
                                ref={(node) => {
                                  tabButtonRefs.current[tab] = node;
                                }}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className="relative px-0 py-2 transition-all duration-300"
                              >
                                <span className="invisible block text-[15px] font-semibold">
                                  {tab}
                                </span>
                                <span
                                  className={`absolute inset-0 flex items-center justify-center text-sm transition-all duration-300 ${
                                    activeTab === tab
                                      ? 'text-[15px] font-semibold text-slate-950'
                                      : 'font-normal text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {tab}
                                </span>
                              </button>
                            ))}
                            <span
                              aria-hidden
                              className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-[linear-gradient(90deg,#49c9a5_0%,#1f9bab_100%)] shadow-[0_1px_8px_rgba(73,201,165,0.24)] transition-[left,width] duration-300 ease-out"
                              style={{ left: `${tabIndicator.left}px`, width: `${tabIndicator.width}px` }}
                            />
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          <div className={activeTab === 'Posts' ? 'block' : 'hidden'}>
                            <PostsTab profileId={profile.id} />
                          </div>
                          <div className={activeTab === 'Collections' ? 'block' : 'hidden'}>
                            <CollectionsTab profileId={profile.id} canManageSavedPosts={Boolean(props.isOwnProfile)} />
                          </div>
                          <div className={activeTab === 'Likes' ? 'block' : 'hidden'}>
                            <LikesTab profileId={profile.id} />
                          </div>
                          <div className={activeTab === 'Gifts' ? 'block' : 'hidden'}>
                            <GiftsTab />
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                <aside className="hidden xl:block" />
              </div>
            </div>
          </section>
        </div>
      </div>
      {props.isOwnProfile && showScrollTop ? (
        <button
          type="button"
          onClick={() => {
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          aria-label="Back to top"
          className="fixed bottom-8 right-8 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#4ECCA3]/35 bg-white/92 text-[#1f8f69] shadow-[0_18px_40px_rgba(31,143,105,0.18)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#4ECCA3]/60 hover:shadow-[0_22px_46px_rgba(31,143,105,0.24)]"
        >
          <ArrowUpIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
