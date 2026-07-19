import { useEffect, useState } from 'react';
import { ScrollArea, Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { formatProfileDate } from '@renderer/features/profile/profile-model';
import {
  ArrowUpIcon,
  CalendarIcon,
  EditableField,
  EyeIcon,
  InlineMeta,
  LocationIcon,
  OriginIcon,
  PencilIcon,
  SpinnerIcon,
  WorldMetaLink,
} from './profile-detail-view-parts.js';
import {
  ACCEPTED_AVATAR_TYPES,
  type ProfileDetailViewController,
  type ProfileDetailViewProps,
} from './profile-detail-view-controller.js';
import {
  ProfileDetailDesktopStatsActions,
  ProfileDetailSaveActions,
  ProfileDetailStatsActionsBlock,
} from './profile-detail-view-content-shell.js';
import { ProfileDetailTabs } from './profile-detail-view-tabs.js';

const SHOW_AVATAR_ONLINE_INDICATOR = false;
const TOPBAR_TOOLTIP_CLASS = 'rounded-full bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]';

function formatEntityFact(fact: Record<string, unknown>): string {
  const key = typeof fact.key === 'string'
    ? fact.key
    : typeof fact.name === 'string'
      ? fact.name
      : '';
  const value = typeof fact.value === 'string'
    ? fact.value
    : typeof fact.summary === 'string'
      ? fact.summary
      : '';
  return [key, value].filter(Boolean).join(': ');
}

export function ProfileDetailViewContent(input: {
  controller: ProfileDetailViewController;
  onVisitWorld: (worldId: string) => void;
} & ProfileDetailViewProps) {
  const { t } = useTranslation();
  const [isWideLayout, setIsWideLayout] = useState(() => window.innerWidth >= 1180);
  const {
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
    usesExternalScrollContainer,
    visitedTabs,
  } = input.controller;
  const { profile } = input;
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
    : profile.city || profile.countryCode?.toUpperCase() || t('Profile.unknownRegion', { defaultValue: 'Unknown region' });
  const originLabel = profile.sourceOrigin || t('Profile.unknownOrigin', { defaultValue: 'Unknown origin' });
  const joinedLabel = formatProfileDate(profile.createdAt) || t('Profile.unknownJoinedDate', { defaultValue: 'Unknown joined date' });
  const worldLabel = profile.worldName || t('Profile.unknownWorld', { defaultValue: 'Unknown world' });
  const worldNavigationId = profile.sourceWorldId || '';
  const canVisitWorld = Boolean(worldNavigationId);
  const isRestrictedProfile = (input.isRestrictedProfile === true || profile.accessState === 'restricted') && !input.isOwnProfile;
  const headline = isRestrictedProfile
    ? t('Profile.privateProfileDescription', { defaultValue: 'This profile is private. Only basic contact information is available.' })
    : profile.bio || (profile.isSource
    ? t('Profile.sourceNoSummary', { defaultValue: 'This source has no public profile summary yet.' })
    : t('Profile.noDescription', { defaultValue: 'No profile summary has been added yet.' }));
  const contentRestricted = (input.isBlockedProfile === true || isRestrictedProfile) && !input.isOwnProfile;
  const showGiftButton = !input.isOwnProfile && !contentRestricted;
  const showAddFriendButton = !contentRestricted && !input.isOwnProfile && !profile.isFriend && !profile.isPendingFriendRequest && Boolean(input.onAddFriend);
  const showMessageButton = input.showMessageButton !== false && !contentRestricted;

  useEffect(() => {
    const syncLayoutMode = () => {
      setIsWideLayout(window.innerWidth >= 1180);
    };

    syncLayoutMode();
    window.addEventListener('resize', syncLayoutMode);
    return () => window.removeEventListener('resize', syncLayoutMode);
  }, []);

  const contentClassName = input.fullBleed ? 'flex min-h-full w-full flex-col' : 'flex min-h-full w-full flex-col pb-6';
  const profileDetailBody = (
          <section className="relative">
            <div className="relative h-[168px] overflow-hidden px-8 py-5 [mask-image:linear-gradient(180deg,#000_0%,#000_58%,rgba(0,0,0,0.45)_78%,transparent_96%)] [-webkit-mask-image:linear-gradient(180deg,#000_0%,#000_58%,rgba(0,0,0,0.45)_78%,transparent_96%)]" style={headerStyle}>
              {canVisitWorld ? (
                <button
                  type="button"
                  onClick={() => input.onVisitWorld(worldNavigationId)}
                  className="absolute inset-x-0 top-0 z-10 h-[110px] cursor-pointer"
                  aria-label={t('Profile.visitWorld', { worldName: worldLabel, defaultValue: 'Visit {{worldName}}' })}
                />
              ) : null}
              {!input.isOwnProfile && !input.hideBackButton ? (
                <button
                  type="button"
                  onClick={input.onClose}
                  aria-label={t('Common.back', { defaultValue: 'Back' })}
                  title={t('Common.back', { defaultValue: 'Back' })}
                  className="absolute left-5 top-5 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-white/85 text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.12)] nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)] transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-white hover:text-[var(--nimi-action-primary-bg)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5" />
                    <path d="m12 5-7 7 7 7" />
                  </svg>
                </button>
              ) : null}
              {!profile.worldBannerUrl ? (
                <>
                  <div className="pointer-events-none absolute -left-6 top-4 h-40 w-44 rounded-full bg-[#73e0bc]/24 blur-[44px]" />
                  <div className="pointer-events-none absolute left-[34%] top-[-2%] h-36 w-40 rounded-full bg-[#a98fff]/20 blur-[48px]" />
                  <div className="pointer-events-none absolute right-[10%] top-[-1%] h-36 w-42 rounded-full bg-[#edf369]/22 blur-[52px]" />
                  <div className="pointer-events-none absolute left-[14%] top-[46%] h-52 w-44 rounded-full bg-[#3db6ea]/18 blur-[54px]" />
                  <div className="pointer-events-none absolute right-[18%] bottom-[-10%] h-48 w-44 rounded-full bg-[#57d7c2]/22 blur-[52px]" />
                </>
              ) : null}

              <div className="relative z-10 flex items-start justify-end gap-4">
                {input.isOwnProfile ? (
                  <Tooltip
                    content={isEditing
                      ? t('Profile.previewProfile', { defaultValue: 'Preview' })
                      : t('Layout.editProfile', { defaultValue: 'Edit Profile' })}
                    placement="bottom"
                    contentClassName={TOPBAR_TOOLTIP_CLASS}
                  >
                    <button
                      type="button"
                      onClick={toggleEditing}
                      className="inline-flex h-11 w-auto cursor-pointer items-center gap-2 rounded-full border border-[var(--nimi-border-subtle)] bg-white/92 px-4 text-[var(--nimi-action-primary-bg)] shadow-[0_10px_26px_rgba(31,143,105,0.12)] transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-white"
                    >
                      {isEditing ? <EyeIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
                      <span className="text-sm font-semibold">
                        {isEditing
                          ? t('Profile.previewProfile', { defaultValue: 'Preview' })
                          : t('Layout.editProfile', { defaultValue: 'Edit Profile' })}
                      </span>
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            </div>

            <div className="relative px-8 pb-6">
              <div className="-mt-14 grid gap-6 xl:grid-cols-[minmax(0,1fr),320px]">
                <div className="min-w-0">
                  <div className="relative isolate rounded-[24px] nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border-[var(--nimi-material-glass-thick-border)] px-6 py-5 [box-shadow:0_24px_60px_rgba(15,23,42,0.10),inset_0_1px_0_0_rgba(255,255,255,0.6)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0)_30%,rgba(255,255,255,0.55)_62%,rgba(255,255,255,0.92)_85%,rgba(255,255,255,1)_100%)] xl:px-7">
                    <div className="grid gap-5 lg:grid-cols-[140px_minmax(0,1fr)] lg:gap-6">
                      <div className="flex shrink-0 flex-col items-center gap-3 lg:pt-[2px]">
                          <div className="group relative cursor-pointer">
                            <div className="relative">
                              <EntityAvatar
                                imageUrl={isEditing ? draft.avatarUrl || null : profile.avatarUrl}
                                name={isEditing ? draft.displayName || profile.displayName : profile.displayName}
                                kind={profile.isSource ? 'source' : 'human'}
                                sizeClassName="h-24 w-24"
                                textClassName="text-3xl font-bold"
                                fallbackClassName={profile.isSource ? undefined : 'bg-gradient-to-br from-[var(--nimi-action-primary-bg)]/20 to-[var(--nimi-action-primary-bg)]/5 text-[var(--nimi-action-primary-bg-hover)]'}
                                className={profile.isSource ? '' : 'rounded-full border border-white/85 shadow-[0_14px_34px_rgba(15,23,42,0.12)]'}
                              />

                              {SHOW_AVATAR_ONLINE_INDICATOR && profile.isOnline ? (
                                <span className="absolute bottom-2 right-2 h-5 w-5 rounded-full border-[3px] border-white bg-[#28c189] shadow-md" />
                              ) : null}

                              {isEditing && input.isOwnProfile ? (
                                <>
                                  <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept={ACCEPTED_AVATAR_TYPES.join(',')}
                                    className="hidden"
                                    onChange={(event) => {
                                      void handleAvatarSelect(event);
                                    }}
                                  />
                                  <div
                                    onClick={() => !isUploadingAvatar && avatarInputRef.current?.click()}
                                    className={`absolute inset-0 flex items-center justify-center ${profile.isSource ? 'rounded-[12px]' : 'rounded-full'} transition-all ${
                                      isUploadingAvatar
                                        ? 'bg-black/50'
                                        : 'cursor-pointer bg-black/0 group-hover:bg-black/40'
                                    }`}
                                  >
                                    {isUploadingAvatar ? (
                                      <div className="flex flex-col items-center gap-2 text-white">
                                        <SpinnerIcon className="h-7 w-7 border-white/30 border-t-white" />
                                        <span className="text-xs font-medium">{t('Profile.avatarUploading', { defaultValue: 'Uploading avatar...' })}</span>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col items-center gap-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="17 8 12 3 7 8" />
                                            <line x1="12" y1="3" x2="12" y2="15" />
                                          </svg>
                                        </div>
                                        <span className="text-xs font-medium">
                                          {t('Relationship.changePhoto', { defaultValue: 'Change Photo' })}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </div>

                          {isEditing && input.isOwnProfile ? (
                            <p className="text-[11px] text-slate-400">
                              {t('Profile.uploadLimit', { defaultValue: 'JPG or PNG, max 5MB' })}
                            </p>
                          ) : null}
                        </div>

                      <div className="min-w-0">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2" />
                            {isEditing ? (
                              <div className="mt-3 space-y-4">
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {t('Relationship.displayName', { defaultValue: 'Display name' })}
                                  </span>
                                  <input
                                    type="text"
                                    value={draft.displayName}
                                    onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[28px] font-semibold leading-[1.05] tracking-[0.02em] text-[#1A1A1B] outline-none transition focus:border-[var(--nimi-action-primary-bg)] focus:ring-4 focus:ring-[var(--nimi-action-primary-bg)]/10"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {t('Relationship.handle', { defaultValue: 'Handle' })}
                                  </span>
                                  <input
                                    type="text"
                                    value={profile.handle}
                                    disabled
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {t('Relationship.bio', { defaultValue: 'Bio' })}
                                  </span>
                                  <textarea
                                    value={draft.bio}
                                    onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                                    rows={4}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[14px] leading-[1.7] text-[#424245] outline-none transition focus:border-[var(--nimi-action-primary-bg)] focus:ring-4 focus:ring-[var(--nimi-action-primary-bg)]/10"
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className={isWideLayout ? 'flex items-start justify-between gap-6' : 'block'}>
                                <div className="min-w-0 flex-1">
                                  <h1 className="text-[24px] font-semibold leading-[1.1] tracking-[0.02em] text-[#1A1A1B] lg:text-[26px]">
                                    {profile.displayName}
                                  </h1>
                                  <p className="mt-1 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]">
                                    {profile.handle}
                                  </p>
                                  <p className="mt-3 max-w-[420px] text-[14px] leading-[1.6] text-[#424245]">
                                    {headline}
                                  </p>
                                  {isRestrictedProfile ? (
                                    <div
                                      data-testid="profile-private-state"
                                      className="mt-3 inline-flex max-w-[420px] items-center rounded-2xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] font-medium text-amber-800"
                                    >
                                      {t('Profile.privateProfileState', { defaultValue: 'Private profile' })}
                                    </div>
                                  ) : null}
                                  <div className="mt-4">
                                    <div className="grid max-w-[460px] grid-cols-2 gap-x-10 gap-y-2 text-sm text-slate-600">
                                      <InlineMeta value={joinedLabel} icon={<CalendarIcon className="h-3.5 w-3.5" />} />
                                      <InlineMeta value={locationLabel} icon={<LocationIcon className="h-3.5 w-3.5" />} />
                                      <WorldMetaLink
                                        value={worldLabel}
                                        canVisit={canVisitWorld}
                                        onClick={canVisitWorld ? () => input.onVisitWorld(worldNavigationId) : undefined}
                                      />
                                      <InlineMeta value={originLabel} icon={<OriginIcon className="h-3.5 w-3.5" />} />
                                    </div>
                                    {profile.tags.length > 0 ? (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {profile.tags.map((tag) => (
                                          <span
                                            key={tag}
                                            className="rounded-full bg-[rgba(15,23,42,0.05)] px-3 py-1.5 text-[12px] font-medium transition hover:bg-[rgba(15,23,42,0.08)] hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
                                            style={{ color: 'var(--nimi-action-primary-bg-hover)' }}
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    {profile.entity ? (
                                      <div className="mt-4 max-w-[460px] rounded-2xl border border-slate-200/80 bg-white/68 px-4 py-3 text-[12px] text-slate-600">
                                        <p className="text-[13px] font-semibold text-slate-800">{profile.entity.name}</p>
                                        {profile.entity.summary ? (
                                          <p className="mt-1 leading-relaxed">{profile.entity.summary}</p>
                                        ) : null}
                                        {profile.entity.tags.length > 0 ? (
                                          <p className="mt-2 text-[11px] font-medium text-[var(--nimi-action-primary-bg-hover)]">
                                            {profile.entity.tags.slice(0, 4).join(' / ')}
                                          </p>
                                        ) : null}
                                        {profile.entity.facts.length > 0 ? (
                                          <p className="mt-2 leading-relaxed text-slate-500">
                                            {profile.entity.facts.slice(0, 2).map(formatEntityFact).filter(Boolean).join(' · ')}
                                          </p>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                {isWideLayout ? (
                                  <ProfileDetailDesktopStatsActions
                                    friendCount={friendCount}
                                    postCount={postCount}
                                    likesCount={likesCount}
                                    onMessage={input.onMessage}
                                    onAddFriend={input.onAddFriend}
                                    showAddFriendButton={showAddFriendButton}
                                    addFriendLabel={input.addFriendLabel}
                                    canAddFriend={input.canAddFriend}
                                    addFriendHint={input.addFriendHint}
                                    onSendGift={input.onSendGift}
                                    showGiftButton={showGiftButton}
                                    showMessageButton={showMessageButton}
                                    showMoreButton={Boolean(input.onBlock || input.onRemove)}
                                    showMenu={showMenu}
                                    menuButtonRef={menuButtonRef}
                                    menuRef={menuRef}
                                    onToggleMenu={() => setShowMenu((value) => !value)}
                                    onBlock={input.onBlock ? () => {
                                      setShowMenu(false);
                                      input.onBlock?.();
                                    } : undefined}
                                    onRemove={input.onRemove ? () => {
                                      setShowMenu(false);
                                      input.onRemove?.();
                                    } : undefined}
                                  />
                                ) : null}
                              </div>
                            )}
                            {isEditing ? (
                              <div className="mt-7 rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)_0%,rgba(255,255,255,0.95)_100%)] p-5 shadow-[0_14px_34px_color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]">
                                <div className="mb-4 flex items-center gap-2">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)]/12 text-[var(--nimi-action-primary-bg-hover)]">
                                    <PencilIcon className="h-4 w-4" />
                                  </span>
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {t('Relationship.editMode', { defaultValue: 'Edit mode' })}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {t('Relationship.editModeDescription', {
                                        defaultValue: 'Update your public profile details shown across Moments, relationships, and chat.',
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <EditableField
                                    label={t('Relationship.city', { defaultValue: 'City' })}
                                    value={draft.city}
                                    onChange={(value) => setDraft((current) => ({ ...current, city: value }))}
                                  />
                                  <EditableField
                                    label={t('Relationship.countryCode', { defaultValue: 'Country code' })}
                                    value={draft.countryCode}
                                    onChange={(value) => setDraft((current) => ({ ...current, countryCode: value.toUpperCase() }))}
                                  />
                                  <EditableField
                                    label={t('Relationship.gender', { defaultValue: 'Gender' })}
                                    value={draft.gender}
                                    onChange={(value) => setDraft((current) => ({ ...current, gender: value }))}
                                  />
                                  <EditableField
                                    label={t('Relationship.languages', { defaultValue: 'Languages' })}
                                    value={draft.languages}
                                    onChange={(value) => setDraft((current) => ({ ...current, languages: value }))}
                                    placeholder={t('Relationship.languagesPlaceholder', { defaultValue: 'English, Chinese' })}
                                  />
                                  <div className="md:col-span-2">
                                    <EditableField
                                      label={t('Relationship.tags', { defaultValue: 'Tags' })}
                                      value={draft.tags}
                                      onChange={(value) => setDraft((current) => ({ ...current, tags: value }))}
                                      placeholder={t('Relationship.tagsPlaceholder', { defaultValue: 'creator, traveler, world-native' })}
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : null}
                            {isEditing && isWideLayout && input.isOwnProfile ? (
                              <div className="mt-5">
                                <ProfileDetailSaveActions
                                  draftDisplayName={draft.displayName}
                                  isSaving={isSaving}
                                  isUploadingAvatar={isUploadingAvatar}
                                  onCancel={cancelEditing}
                                  onSave={() => { void handleSaveProfile(); }}
                                  saveError={saveError}
                                  stacked={false}
                                />
                              </div>
                            ) : null}
                          </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <section className="min-w-0 space-y-4">
                      <div className="bg-transparent">
                        {!isWideLayout ? (
                          <div className="px-1">
                            <ProfileDetailStatsActionsBlock
                              friendCount={friendCount}
                              postCount={postCount}
                              likesCount={likesCount}
                              isEditing={isEditing}
                              isOwnProfile={input.isOwnProfile}
                              draftDisplayName={draft.displayName}
                              isSaving={isSaving}
                              isUploadingAvatar={isUploadingAvatar}
                              onCancel={cancelEditing}
                              onSave={() => {
                                void handleSaveProfile();
                              }}
                              saveError={saveError}
                              onMessage={input.onMessage}
                              onAddFriend={input.onAddFriend}
                              showAddFriendButton={showAddFriendButton}
                              addFriendLabel={input.addFriendLabel}
                              canAddFriend={input.canAddFriend}
                              addFriendHint={input.addFriendHint}
                              onSendGift={input.onSendGift}
                              showGiftButton={showGiftButton}
                              showMessageButton={showMessageButton}
                              showMoreButton={Boolean(input.onBlock || input.onRemove)}
                              showMenu={showMenu}
                              menuButtonRef={menuButtonRef}
                              menuRef={menuRef}
                              onToggleMenu={() => setShowMenu((value) => !value)}
                              onBlock={input.onBlock ? () => {
                                setShowMenu(false);
                                input.onBlock?.();
                              } : undefined}
                              onRemove={input.onRemove ? () => {
                                setShowMenu(false);
                                input.onRemove?.();
                              } : undefined}
                            />
                          </div>
                        ) : null}

                      </div>
                    </section>
                  </div>
                </div>

                <aside className="hidden xl:block" />
              </div>

              <div className="mt-4 rounded-[24px] nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border-[var(--nimi-material-glass-regular-border)] px-5 py-4 shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] xl:px-6">
                <ProfileDetailTabs
                  activeTab={activeTab}
                  isBlockedProfile={input.isBlockedProfile || isRestrictedProfile}
                  isOwnProfile={input.isOwnProfile}
                  onSetActiveTab={setActiveTab}
                  profileId={profile.id}
                  tabButtonRefs={tabButtonRefs}
                  tabIndicator={tabIndicator}
                  tabListRef={tabListRef}
                  visitedTabs={visitedTabs}
                />
              </div>
            </div>
          </section>
  );

  return (
    <div
      data-testid={E2E_IDS.profileDetailSurface}
      className={usesExternalScrollContainer ? 'flex min-h-full flex-1 flex-col' : 'flex h-full min-h-0 flex-1 flex-col'}
    >
      {usesExternalScrollContainer ? (
        <div className={contentClassName}>{profileDetailBody}</div>
      ) : (
        <ScrollArea
          className="flex-1"
          contentClassName={contentClassName}
          viewportRef={scrollContainerRef}
        >
          {profileDetailBody}
        </ScrollArea>
      )}
      {input.isOwnProfile && showScrollTop ? (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t('Common.backToTop', { defaultValue: 'Back to top' })}
          className="fixed bottom-8 right-8 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--nimi-action-primary-bg)]/35 bg-white/92 text-[var(--nimi-action-primary-bg-hover)] shadow-[0_18px_40px_color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] transition-[border-color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-action-primary-bg)]/60 hover:shadow-[0_22px_46px_color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] active:scale-[var(--nimi-motion-pressed-scale)]"
        >
          <ArrowUpIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
