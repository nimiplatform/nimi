import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { Tooltip } from '@renderer/components/tooltip.js';
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
} from './contact-detail-view-parts.js';
import {
  ACCEPTED_AVATAR_TYPES,
  type ContactDetailViewController,
  type ContactDetailViewProps,
} from './contact-detail-view-controller.js';
import {
  ContactDetailDesktopStatsActions,
  ContactDetailStatsActionsBlock,
} from './contact-detail-view-content-shell.js';
import { ContactDetailTabs } from './contact-detail-view-tabs.js';

const SHOW_AVATAR_ONLINE_INDICATOR = false;
const TOPBAR_TOOLTIP_CLASS = 'rounded-full bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.25)]';

export function ContactDetailViewContent(input: {
  controller: ContactDetailViewController;
  onVisitWorld: (worldId: string) => void;
} & ContactDetailViewProps) {
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
  const originLabel = profile.agentOrigin || t('Profile.unknownOrigin', { defaultValue: 'Unknown origin' });
  const joinedLabel = formatProfileDate(profile.createdAt) || t('Profile.unknownJoinedDate', { defaultValue: 'Unknown joined date' });
  const worldLabel = profile.worldName || t('Profile.unknownWorld', { defaultValue: 'Unknown world' });
  const worldNavigationId = profile.agentOwnerWorldId || profile.agentWorldId || '';
  const canVisitWorld = Boolean(worldNavigationId);
  const headline = profile.bio || (profile.isAgent
    ? t('Profile.agentNoSummary', { defaultValue: 'This contact has no public profile summary yet.' })
    : t('Profile.noDescription', { defaultValue: 'No profile summary has been added yet.' }));
  const showGiftButton = !input.isOwnProfile;
  const showAddFriendButton = !input.isOwnProfile && !profile.isFriend && Boolean(input.onAddFriend);
  const showMessageButton = input.showMessageButton !== false;

  useEffect(() => {
    const syncLayoutMode = () => {
      setIsWideLayout(window.innerWidth >= 1180);
    };

    syncLayoutMode();
    window.addEventListener('resize', syncLayoutMode);
    return () => window.removeEventListener('resize', syncLayoutMode);
  }, []);

  return (
    <div
      data-testid={E2E_IDS.profileDetailSurface}
      className="flex h-full min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#eef3f4_0%,#f7fafb_48%,#fcfefd_100%)]"
    >
      <ScrollShell
        ref={scrollContainerRef}
        className="flex-1"
        contentClassName={input.fullBleed ? 'flex min-h-full w-full flex-col' : 'mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6'}
      >
          <section className="relative overflow-hidden rounded-[34px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
            <div className="relative h-[220px] px-8 py-7" style={headerStyle}>
              {canVisitWorld ? (
                <button
                  type="button"
                  onClick={() => input.onVisitWorld(worldNavigationId)}
                  className="absolute inset-x-0 top-0 z-10 h-[140px] cursor-pointer"
                  aria-label={t('Profile.visitWorld', { worldName: worldLabel, defaultValue: 'Visit {{worldName}}' })}
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
                <button
                  type="button"
                  onClick={input.onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/45 text-[#4ECCA3] backdrop-blur-md transition-all hover:bg-black/65 hover:border-[#4ECCA3]/40"
                  title={t('Common.back', { defaultValue: 'Back' })}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5" /><path d="m12 5-7 7 7 7" />
                  </svg>
                </button>
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
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-[#9fe3cd] bg-white/92 px-4 text-[#1f8f69] shadow-[0_10px_26px_rgba(31,143,105,0.12)] backdrop-blur-md transition hover:border-[#4ECCA3] hover:bg-white"
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

            <div className="relative px-8 pb-8">
              <div className="-mt-20 grid gap-6 xl:grid-cols-[minmax(0,1fr),320px]">
                <div className="min-w-0">
                  <div className="rounded-[30px] border border-white/38 bg-white/40 px-6 py-7 shadow-[0_22px_56px_rgba(15,23,42,0.08)] backdrop-blur-[18px] supports-[backdrop-filter]:bg-white/30 xl:px-7">
                    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
                      <div className="flex shrink-0 flex-col items-center gap-3 lg:pt-[6px]">
                          <div className="group relative cursor-pointer">
                            <div className="relative">
                              <EntityAvatar
                                imageUrl={isEditing ? draft.avatarUrl || null : profile.avatarUrl}
                                name={isEditing ? draft.displayName || profile.displayName : profile.displayName}
                                kind={profile.isAgent ? 'agent' : 'human'}
                                sizeClassName="h-32 w-32"
                                textClassName="text-4xl font-bold"
                                fallbackClassName={profile.isAgent ? undefined : 'bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-[#1f8f69]'}
                                className={profile.isAgent ? '' : 'rounded-full border border-white/85 shadow-[0_14px_34px_rgba(15,23,42,0.12)]'}
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
                                    className={`absolute inset-0 flex items-center justify-center ${profile.isAgent ? 'rounded-[12px]' : 'rounded-full'} transition-all ${
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
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="17 8 12 3 7 8" />
                                            <line x1="12" y1="3" x2="12" y2="15" />
                                          </svg>
                                        </div>
                                        <span className="text-xs font-medium">
                                          {t('Contacts.changePhoto', { defaultValue: 'Change Photo' })}
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
                                    {t('Contacts.displayName', { defaultValue: 'Display name' })}
                                  </span>
                                  <input
                                    type="text"
                                    value={draft.displayName}
                                    onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[28px] font-semibold leading-[1.05] tracking-[0.02em] text-[#1A1A1B] outline-none transition focus:border-[#4ECCA3] focus:ring-4 focus:ring-[#4ECCA3]/10"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    {t('Contacts.handle', { defaultValue: 'Handle' })}
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
                                    {t('Contacts.bio', { defaultValue: 'Bio' })}
                                  </span>
                                  <textarea
                                    value={draft.bio}
                                    onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                                    rows={4}
                                    className="mt-1.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[14px] leading-[1.7] text-[#424245] outline-none transition focus:border-[#4ECCA3] focus:ring-4 focus:ring-[#4ECCA3]/10"
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className={isWideLayout ? 'flex items-start justify-between gap-8' : 'block'}>
                                <div className="min-w-0 flex-1">
                                  <h1 className="mt-1 text-[30px] font-semibold leading-[1.05] tracking-[0.05em] text-[#1A1A1B] lg:text-[32px]">
                                    {profile.displayName}
                                  </h1>
                                  <p className="mt-2 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]">
                                    {profile.handle}
                                  </p>
                                  <p className="mt-5 max-w-[420px] text-[14px] leading-[1.7] text-[#424245]">
                                    {headline}
                                  </p>
                                  <div className="mt-7">
                                    <div className="grid max-w-[460px] grid-cols-2 gap-x-12 gap-y-3.5 text-sm text-slate-600">
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
                                      <div className="mt-7 flex flex-wrap gap-2.5">
                                        {profile.tags.map((tag) => (
                                          <span
                                            key={tag}
                                            className="rounded-full bg-[rgba(15,23,42,0.05)] px-3 py-1.5 text-[12px] font-medium backdrop-blur-sm transition hover:bg-[rgba(15,23,42,0.08)] hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
                                            style={{ color: '#1f8f69' }}
                                          >
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                {isWideLayout ? (
                                  <ContactDetailDesktopStatsActions
                                    friendCount={friendCount}
                                    postCount={postCount}
                                    likesCount={likesCount}
                                    onMessage={input.onMessage}
                                    onAddFriend={input.onAddFriend}
                                    showAddFriendButton={showAddFriendButton}
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
                              <div className="mt-7 rounded-[24px] border border-[#dbe7e3] bg-[linear-gradient(180deg,rgba(78,204,163,0.08)_0%,rgba(255,255,255,0.95)_100%)] p-5 shadow-[0_14px_34px_rgba(78,204,163,0.08)]">
                                <div className="mb-4 flex items-center gap-2">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#4ECCA3]/12 text-[#1f8f69]">
                                    <PencilIcon className="h-4 w-4" />
                                  </span>
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                      {t('Contacts.editMode', { defaultValue: 'Edit mode' })}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {t('Contacts.editModeDescription', {
                                        defaultValue: 'Update your public profile details shown across Moments, Contacts, and chat.',
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                  <EditableField
                                    label={t('Contacts.city', { defaultValue: 'City' })}
                                    value={draft.city}
                                    onChange={(value) => setDraft((current) => ({ ...current, city: value }))}
                                  />
                                  <EditableField
                                    label={t('Contacts.countryCode', { defaultValue: 'Country code' })}
                                    value={draft.countryCode}
                                    onChange={(value) => setDraft((current) => ({ ...current, countryCode: value.toUpperCase() }))}
                                  />
                                  <EditableField
                                    label={t('Contacts.gender', { defaultValue: 'Gender' })}
                                    value={draft.gender}
                                    onChange={(value) => setDraft((current) => ({ ...current, gender: value }))}
                                  />
                                  <EditableField
                                    label={t('Contacts.languages', { defaultValue: 'Languages' })}
                                    value={draft.languages}
                                    onChange={(value) => setDraft((current) => ({ ...current, languages: value }))}
                                    placeholder={t('Contacts.languagesPlaceholder', { defaultValue: 'English, Chinese' })}
                                  />
                                  <div className="md:col-span-2">
                                    <EditableField
                                      label={t('Contacts.tags', { defaultValue: 'Tags' })}
                                      value={draft.tags}
                                      onChange={(value) => setDraft((current) => ({ ...current, tags: value }))}
                                      placeholder={t('Contacts.tagsPlaceholder', { defaultValue: 'creator, traveler, world-native' })}
                                    />
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <section className="min-w-0 space-y-6">
                      <div className="bg-transparent">
                        {!isWideLayout ? (
                          <div className="px-5">
                            <ContactDetailStatsActionsBlock
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

                        <ContactDetailTabs
                          activeTab={activeTab}
                          isOwnProfile={input.isOwnProfile}
                          onSetActiveTab={setActiveTab}
                          profileId={profile.id}
                          tabButtonRefs={tabButtonRefs}
                          tabIndicator={tabIndicator}
                          tabListRef={tabListRef}
                          visitedTabs={visitedTabs}
                        />
                      </div>
                    </section>
                  </div>
                </div>

                <aside className="hidden xl:block" />
              </div>
            </div>
          </section>
      </ScrollShell>
      {input.isOwnProfile && showScrollTop ? (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t('Common.backToTop', { defaultValue: 'Back to top' })}
          className="fixed bottom-8 right-8 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#4ECCA3]/35 bg-white/92 text-[#1f8f69] shadow-[0_18px_40px_rgba(31,143,105,0.18)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#4ECCA3]/60 hover:shadow-[0_22px_46px_rgba(31,143,105,0.24)]"
        >
          <ArrowUpIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
