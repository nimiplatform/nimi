import { useEffect, useState } from 'react';
import { ScrollArea, Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { formatProfileDate } from '../profile/profile-model';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  ArrowUpIcon,
  CalendarIcon,
  EditableField,
  EyeIcon,
  InlineMeta,
  LocationIcon,
  PencilIcon,
  SpinnerIcon,
  TOPBAR_TOOLTIP_CLASS,
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

export function ProfileDetailViewContent(input: {
  controller: ProfileDetailViewController;
} & ProfileDetailViewProps) {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const [isWideLayout, setIsWideLayout] = useState(() => bindings.app.projection.viewportWidth() >= 1180);
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
    saveError,
    scrollContainerRef,
    scrollToTop,
    setActiveTab,
    setDraft,
    setShowMenu,
    showMenu,
    showScrollTop,
    toggleEditing,
    usesExternalScrollContainer,
    visitedTabs,
  } = input.controller;
  const { profile } = input;
  const friendCount = profile.stats?.friendsCount ?? 0;
  const postCount = profile.stats?.postsCount ?? 0;
  const likesCount = profile.stats?.likesCount ?? 0;
  const headerStyle = profile.coverUrl
    ? {
        backgroundImage: `linear-gradient(120deg, rgba(7, 20, 17, 0.58), rgba(7, 20, 17, 0.18)), url(${profile.coverUrl})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : {
        backgroundImage: [
          'radial-gradient(44% 56% at 18% 18%, var(--nimi-ambient-mesh-color-1) 0%, transparent 78%)',
          'radial-gradient(40% 48% at 50% 10%, var(--nimi-ambient-mesh-color-2) 0%, transparent 84%)',
          'radial-gradient(34% 40% at 78% 11%, var(--nimi-ambient-mesh-color-3) 0%, transparent 82%)',
          'radial-gradient(32% 28% at 64% 12%, var(--nimi-ambient-mesh-color-4) 0%, transparent 80%)',
          'radial-gradient(56% 70% at 26% 62%, var(--nimi-ambient-mesh-color-4) 0%, transparent 78%)',
          'radial-gradient(52% 68% at 72% 58%, var(--nimi-ambient-mesh-color-1) 0%, transparent 80%)',
          'radial-gradient(60% 84% at 54% 110%, var(--nimi-ambient-mesh-color-2) 0%, transparent 82%)',
          'linear-gradient(135deg, var(--nimi-ambient-mesh-base-start) 0%, var(--nimi-ambient-mesh-base-end) 100%)',
        ].join(', '),
      };
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || t('Profile.unknownRegion', { defaultValue: 'Unknown region' });
  const joinedLabel = formatProfileDate(profile.createdAt, i18n.formatDate) || t('Profile.unknownJoinedDate', { defaultValue: 'Unknown joined date' });
  const isRestrictedProfile = (input.isRestrictedProfile === true || profile.accessState === 'restricted') && !input.isOwnProfile;
  const headline = isRestrictedProfile
    ? t('Profile.privateProfileDescription', { defaultValue: 'This profile is private. Only basic contact information is available.' })
    : profile.bio || t('Profile.noDescription', { defaultValue: 'No profile summary has been added yet.' });
  const contentRestricted = (input.isBlockedProfile === true || isRestrictedProfile) && !input.isOwnProfile;
  const showAddFriendButton = !contentRestricted && !input.isOwnProfile && !profile.isFriend && !profile.isPendingFriendRequest && Boolean(input.onAddFriend);
  const showMessageButton = input.showMessageButton !== false && !contentRestricted;

  useEffect(() => {
    const syncLayoutMode = () => {
      setIsWideLayout(bindings.app.projection.viewportWidth() >= 1180);
    };

    syncLayoutMode();
    return bindings.app.events.subscribeWindowResize(syncLayoutMode);
  }, [bindings]);

  const contentClassName = input.fullBleed ? 'flex min-h-full w-full flex-col' : 'flex min-h-full w-full flex-col pb-6';
  const profileDetailBody = (
          <section className="relative">
            <div className="relative h-[168px] overflow-hidden px-8 py-5 [mask-image:linear-gradient(180deg,#000_0%,#000_58%,rgba(0,0,0,0.45)_78%,transparent_96%)] [-webkit-mask-image:linear-gradient(180deg,#000_0%,#000_58%,rgba(0,0,0,0.45)_78%,transparent_96%)]" style={headerStyle}>
              {!input.isOwnProfile && !input.hideBackButton ? (
                <button
                  type="button"
                  onClick={input.onClose}
                  aria-label={t('Common.back', { defaultValue: 'Back' })}
                  title={t('Common.back', { defaultValue: 'Back' })}
                  className="absolute left-5 top-5 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_85%,transparent)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-raised)] nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)] transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-action-primary-bg)]"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5" />
                    <path d="m12 5-7 7 7 7" />
                  </svg>
                </button>
              ) : null}
              {!profile.coverUrl ? (
                <>
                  <div className="pointer-events-none absolute -left-6 top-4 h-40 w-44 rounded-full bg-[var(--nimi-ambient-mesh-color-1)] blur-[44px]" />
                  <div className="pointer-events-none absolute left-[34%] top-[-2%] h-36 w-40 rounded-full bg-[var(--nimi-ambient-mesh-color-2)] blur-[48px]" />
                  <div className="pointer-events-none absolute right-[10%] top-[-1%] h-36 w-42 rounded-full bg-[var(--nimi-ambient-mesh-color-3)] blur-[52px]" />
                  <div className="pointer-events-none absolute left-[14%] top-[46%] h-52 w-44 rounded-full bg-[var(--nimi-ambient-mesh-color-4)] blur-[54px]" />
                  <div className="pointer-events-none absolute right-[18%] bottom-[-10%] h-48 w-44 rounded-full bg-[var(--nimi-ambient-mesh-color-2)] blur-[52px]" />
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
                      className="inline-flex h-11 w-auto cursor-pointer items-center gap-2 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)] px-4 text-[var(--nimi-action-primary-bg)] shadow-[var(--nimi-elevation-raised)] transition hover:border-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-surface-card)]"
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
                  <div className="relative isolate rounded-[24px] nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border-[var(--nimi-material-glass-thick-border)] px-6 py-5 [box-shadow:0_24px_60px_rgba(15,23,42,0.10),inset_0_1px_0_0_color-mix(in_srgb,var(--nimi-text-inverse)_35%,transparent)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-surface-card)_0%,transparent)_0%,color-mix(in_srgb,var(--nimi-surface-card)_0%,transparent)_30%,color-mix(in_srgb,var(--nimi-surface-card)_55%,transparent)_62%,color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)_85%,var(--nimi-surface-card)_100%)] xl:px-7">
                    <div className="grid gap-5 lg:grid-cols-[140px_minmax(0,1fr)] lg:gap-6">
                      <div className="flex shrink-0 flex-col items-center gap-3 lg:pt-[2px]">
                          <div className={isEditing && input.isOwnProfile ? 'group relative cursor-pointer' : 'relative'}>
                            <div className="relative">
                              <EntityAvatar
                                imageUrl={isEditing ? draft.avatarUrl || null : profile.avatarUrl}
                                name={isEditing ? draft.displayName || profile.displayName : profile.displayName}
                                kind="human"
                                sizeClassName="h-24 w-24"
                                textClassName="text-3xl font-bold"
                                fallbackClassName="bg-gradient-to-br from-[var(--nimi-action-primary-bg)]/20 to-[var(--nimi-action-primary-bg)]/5 text-[var(--nimi-action-primary-bg-hover)]"
                                className="rounded-full border border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-raised)]"
                              />

                              {SHOW_AVATAR_ONLINE_INDICATOR && profile.isOnline ? (
                                <span className="absolute bottom-2 right-2 h-5 w-5 rounded-full border-[3px] border-[var(--nimi-surface-card)] bg-[var(--nimi-status-success)] shadow-md" />
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
                                  <button
                                    type="button"
                                    disabled={isUploadingAvatar}
                                    onClick={() => avatarInputRef.current?.click()}
                                    aria-label={t('Relationship.changePhoto', { defaultValue: 'Change Photo' })}
                                    className={`absolute inset-0 flex items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--nimi-focus-ring-color)] ${
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
                                      <div className="flex flex-col items-center gap-2 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>

                          {isEditing && input.isOwnProfile ? (
                            <p className="text-[11px] text-[var(--nimi-text-muted)]">
                              {t('Profile.uploadLimit', { defaultValue: 'PNG, JPEG, GIF or WebP, max 10MB' })}
                            </p>
                          ) : null}
                        </div>

                      <div className="min-w-0">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2" />
                            {isEditing ? (
                              <div className="mt-3 space-y-4">
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                                    {t('Relationship.displayName', { defaultValue: 'Display name' })}
                                  </span>
                                  <input
                                    type="text"
                                    value={draft.displayName}
                                    onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                                    className="mt-1.5 w-full rounded-2xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 py-3 text-[28px] font-semibold leading-[1.05] tracking-[0.02em] text-[var(--nimi-field-text)] outline-none transition focus:border-[var(--nimi-action-primary-bg)] focus:ring-4 focus:ring-[var(--nimi-action-primary-bg)]/10"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                                    {t('Relationship.handle', { defaultValue: 'Handle' })}
                                  </span>
                                  <input
                                    type="text"
                                    value={profile.handle}
                                    disabled
                                    className="mt-1.5 w-full rounded-2xl border border-[var(--nimi-field-border)] bg-[color-mix(in_srgb,var(--nimi-field-bg)_60%,transparent)] px-4 py-3 text-[13px] font-medium tracking-[0.02em] text-[var(--nimi-text-muted)]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                                    {t('Relationship.bio', { defaultValue: 'Bio' })}
                                  </span>
                                  <textarea
                                    value={draft.bio}
                                    onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                                    rows={4}
                                    className="mt-1.5 w-full rounded-2xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-4 py-3 text-[14px] leading-[1.7] text-[var(--nimi-field-text)] outline-none transition focus:border-[var(--nimi-action-primary-bg)] focus:ring-4 focus:ring-[var(--nimi-action-primary-bg)]/10"
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className={isWideLayout ? 'flex items-start justify-between gap-6' : 'block'}>
                                <div className="min-w-0 flex-1">
                                  <h1 className="text-[24px] font-semibold leading-[1.1] tracking-[0.02em] text-[var(--nimi-text-primary)] lg:text-[26px]">
                                    {profile.displayName}
                                  </h1>
                                  <p className="mt-1 text-[13px] font-medium tracking-[0.02em] text-[var(--nimi-text-secondary)]">
                                    {profile.handle}
                                  </p>
                                  <p className="mt-3 max-w-[420px] text-[14px] leading-[1.6] text-[var(--nimi-text-secondary)]">
                                    {headline}
                                  </p>
                                  {isRestrictedProfile ? (
                                    <div
                                      data-testid="profile-private-state"
                                      className="mt-3 inline-flex max-w-[420px] items-center rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-2 text-[12px] font-medium text-[var(--nimi-status-warning)]"
                                    >
                                      {t('Profile.privateProfileState', { defaultValue: 'Private profile' })}
                                    </div>
                                  ) : null}
                                  <div className="mt-4">
                                    <div className="grid max-w-[460px] grid-cols-2 gap-x-10 gap-y-2 text-sm text-[var(--nimi-text-secondary)]">
                                      <InlineMeta value={joinedLabel} icon={<CalendarIcon className="h-3.5 w-3.5" />} />
                                      <InlineMeta value={locationLabel} icon={<LocationIcon className="h-3.5 w-3.5" />} />
                                    </div>
                                    {profile.tags.length > 0 ? (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {profile.tags.map((tag) => (
                                          <span
                                            key={tag}
                                            className="rounded-full bg-[color-mix(in_srgb,var(--nimi-text-primary)_5%,transparent)] px-3 py-1.5 text-[12px] font-medium transition hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] hover:shadow-[var(--nimi-elevation-raised)]"
                                            style={{ color: 'var(--nimi-action-primary-bg-hover)' }}
                                          >
                                            {tag}
                                          </span>
                                        ))}
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
                                    showMessageButton={showMessageButton}
                                    showMoreButton={Boolean(input.onBlock || input.onRemove)}
                                    showMenu={showMenu}
                                    onShowMenuChange={setShowMenu}
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
                              <div className="mt-7 rounded-[var(--nimi-radius-xl)] border border-[var(--nimi-border-subtle)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)_0%,color-mix(in_srgb,var(--nimi-surface-card)_95%,transparent)_100%)] p-5 shadow-[var(--nimi-elevation-raised)]">
                                <div className="mb-4 flex items-center gap-2">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)]/12 text-[var(--nimi-action-primary-bg-hover)]">
                                    <PencilIcon className="h-4 w-4" />
                                  </span>
                                  <div>
                                    <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                                      {t('Relationship.editMode', { defaultValue: 'Edit mode' })}
                                    </div>
                                    <div className="text-xs text-[var(--nimi-text-secondary)]">
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
                              showMessageButton={showMessageButton}
                              showMoreButton={Boolean(input.onBlock || input.onRemove)}
                              showMenu={showMenu}
                              onShowMenuChange={setShowMenu}
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

              <div className="mt-4 rounded-[var(--nimi-radius-xl)] nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border-[var(--nimi-material-glass-regular-border)] px-5 py-4 shadow-[var(--nimi-elevation-raised)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] xl:px-6">
                <ProfileDetailTabs
                  activeTab={activeTab}
                  isBlockedProfile={input.isBlockedProfile || isRestrictedProfile}
                  isOwnProfile={input.isOwnProfile}
                  onSetActiveTab={setActiveTab}
                  profileId={profile.id}
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
          className="fixed bottom-8 right-8 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--nimi-action-primary-bg)]/35 bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,transparent)] text-[var(--nimi-action-primary-bg-hover)] shadow-[var(--nimi-elevation-floating)] transition-[border-color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-action-primary-bg)]/60 hover:shadow-[var(--nimi-elevation-floating)] active:scale-[var(--nimi-motion-pressed-scale)]"
        >
          <ArrowUpIcon className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
