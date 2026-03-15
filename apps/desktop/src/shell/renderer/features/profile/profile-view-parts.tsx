import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type { ProfileData, ProfileTab } from './profile-model';
import { formatProfileDate } from './profile-model';
import { PostsTab } from './posts-tab';
import { CollectionsTab } from './collections-tab';
import { LikesTab } from './likes-tab';
import { GiftsTab } from './gifts-tab';

const TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

function ProfileSkeletonBlock(props: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200/75 ${props.className}`} />;
}

export function ProfileLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      <ScrollShell className="flex-1" contentClassName="mx-auto max-w-7xl px-5 py-5">
        <div className="overflow-hidden rounded-[28px] border border-[#dbe3ea] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <div className="relative h-[190px] w-full overflow-hidden bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200">
            <div className="absolute left-5 top-5">
              <ProfileSkeletonBlock className="h-10 w-10" />
            </div>
            <div className="absolute right-5 top-5">
              <ProfileSkeletonBlock className="h-10 w-10" />
            </div>
          </div>

          <div className="relative border-b border-[#edf2f6] bg-white px-7 pb-6 pt-0">
            <div className="-mt-14 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex min-w-0 flex-1 gap-5">
                <div className="relative shrink-0">
                  <div className="rounded-[26px] border border-white/80 bg-white p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.16)]">
                    <ProfileSkeletonBlock className="h-24 w-24 rounded-[22px]" />
                  </div>
                </div>

                <div className="min-w-0 flex-1 pt-14 xl:pt-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProfileSkeletonBlock className="h-9 w-48 rounded-lg" />
                    <ProfileSkeletonBlock className="h-8 w-28 rounded-full" />
                  </div>
                  <ProfileSkeletonBlock className="mt-3 h-5 w-32 rounded-md" />
                  <ProfileSkeletonBlock className="mt-4 h-4 w-full rounded-md" />
                  <ProfileSkeletonBlock className="mt-2 h-4 w-4/5 rounded-md" />
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <ProfileSkeletonBlock className="h-9 w-36 rounded-full" />
                    <ProfileSkeletonBlock className="h-9 w-40 rounded-full" />
                    <ProfileSkeletonBlock className="h-9 w-32 rounded-full" />
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-3">
                <div className="flex flex-wrap gap-3">
                  <ProfileSkeletonBlock className="h-[74px] w-[92px] rounded-[18px]" />
                  <ProfileSkeletonBlock className="h-[74px] w-[92px] rounded-[18px]" />
                  <ProfileSkeletonBlock className="h-[74px] w-[92px] rounded-[18px]" />
                </div>
                <div className="flex w-full flex-wrap justify-end gap-2">
                  <ProfileSkeletonBlock className="h-11 w-28 rounded-full" />
                  <ProfileSkeletonBlock className="h-11 w-28 rounded-full" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-[#edf2f6] bg-white px-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-3 py-3">
                <ProfileSkeletonBlock className="h-6 w-16 rounded-md" />
                <ProfileSkeletonBlock className="h-6 w-24 rounded-md" />
                <ProfileSkeletonBlock className="h-6 w-16 rounded-md" />
                <ProfileSkeletonBlock className="h-6 w-16 rounded-md" />
              </div>
              <ProfileSkeletonBlock className="h-4 w-20 rounded-md" />
            </div>
          </div>

          <div className="bg-[#f7f9fc] px-6 py-6">
            <div className="mb-6 flex items-center justify-between gap-4">
              <ProfileSkeletonBlock className="h-5 w-28 rounded-md" />
              <div className="h-px flex-1 bg-gradient-to-r from-[#d8e1e8] to-transparent opacity-80" />
              <ProfileSkeletonBlock className="h-4 w-16 rounded-md" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`profile-post-skeleton-${index}`} className="rounded-[24px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                  <div className="flex items-center gap-3">
                    <ProfileSkeletonBlock className="h-11 w-11 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <ProfileSkeletonBlock className="h-4 w-28 rounded-md" />
                      <ProfileSkeletonBlock className="h-3 w-20 rounded-md" />
                    </div>
                  </div>
                  <ProfileSkeletonBlock className="mt-4 h-4 w-full rounded-md" />
                  <ProfileSkeletonBlock className="mt-2 h-4 w-5/6 rounded-md" />
                  <ProfileSkeletonBlock className="mt-4 h-40 w-full rounded-[18px]" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollShell>
    </div>
  );
}

export function getProfileTabLabel(t: TFunction, tab: ProfileTab): string {
  switch (tab) {
    case 'Posts':
      return t('Profile.tabPosts', { defaultValue: 'Posts' });
    case 'Collections':
      return t('Profile.tabCollections', { defaultValue: 'Collections' });
    case 'Likes':
      return t('Profile.tabLikes', { defaultValue: 'Likes' });
    case 'Gifts':
      return t('Profile.tabGifts', { defaultValue: 'Gifts' });
  }
}

type ProfileHeroSectionProps = {
  profile: ProfileData;
  isOwnProfile: boolean;
  onBack: () => void;
  onMessage: () => void;
  onSendGift: () => void;
  addFriendHint?: string | null;
  showMessageButton?: boolean;
  menuSlot?: ReactNode;
  t: TFunction;
};

export function ProfileHeroSection({
  profile,
  isOwnProfile,
  onBack,
  onMessage,
  onSendGift,
  addFriendHint,
  showMessageButton,
  menuSlot,
  t,
}: ProfileHeroSectionProps) {
  const friendCount = profile.stats?.friendsCount ?? 0;
  const postCount = profile.stats?.postsCount ?? 0;
  const likesCount = profile.stats?.likesCount ?? 0;
  const agentPalette = getSemanticAgentPalette({
    category: profile.agentCategory,
    origin: profile.agentOrigin,
    description: profile.bio,
    tags: profile.tags,
  });
  const agentHeaderStyle = profile.worldBannerUrl
    ? {
        backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.18)), url(${profile.worldBannerUrl})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : { background: agentPalette.ring };
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || t('Profile.unknownRegion', { defaultValue: 'Unknown region' });
  const languageLabel = profile.languages.length > 0 ? profile.languages.join(', ') : t('Profile.noLanguageSet', { defaultValue: 'No language set' });
  const relationshipLabel = profile.isAgent
    ? t('Profile.aiAgentProfile', { defaultValue: 'AI Agent Profile' })
    : t('Profile.contactProfile', { defaultValue: 'Contact Profile' });

  return (
    <>
      <div className="relative h-[190px] w-full overflow-hidden" style={agentHeaderStyle}>
        <div className="absolute inset-0 bg-gradient-to-r from-[#191f2d]/16 via-transparent to-[#ffffff]/10" />
        <div className="absolute inset-x-0 top-0 h-px bg-white/70" />

        <button
          type="button"
          onClick={onBack}
          className="absolute left-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/16 text-white backdrop-blur-md transition hover:bg-white/24"
          title={t('Common.close', { defaultValue: 'Close' })}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {!isOwnProfile ? <div className="absolute right-5 top-5 z-10">{menuSlot}</div> : null}
      </div>

      <div className="relative border-b border-[#edf2f6] bg-white px-7 pb-6 pt-0">
        <div className="-mt-14 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 flex-1 gap-5">
            <div className="relative shrink-0">
              <div className="rounded-[26px] border border-white/80 bg-white p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.16)]">
                <EntityAvatar
                  imageUrl={profile.avatarUrl}
                  name={profile.displayName}
                  kind={profile.isAgent ? 'agent' : 'human'}
                  sizeClassName="h-24 w-24"
                  textClassName="text-3xl font-bold"
                  fallbackClassName={profile.isAgent ? undefined : 'bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-[#4ECCA3]'}
                />
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-14 xl:pt-10">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[#1f2937]">
                  {profile.displayName}
                </h1>
                <span className="inline-flex items-center rounded-full border border-[#d9e3ec] bg-[#f8fbfd] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#728094]">
                  {relationshipLabel}
                </span>
              </div>
              <p className="mt-1 text-[15px] font-medium text-[#667085]">{profile.handle}</p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#5f6b7a]">
                {profile.bio || t('Profile.noDescription', { defaultValue: 'No profile description has been added yet.' })}
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <ProfileChip icon={<CalendarIcon className="h-3.5 w-3.5" />}>
                  {formatProfileDate(profile.createdAt) || t('Profile.unknownJoinedDate', { defaultValue: 'Unknown joined date' })}
                </ProfileChip>
                <ProfileChip icon={<LocationIcon className="h-3.5 w-3.5" />}>
                  {locationLabel}
                </ProfileChip>
                <ProfileChip icon={<LanguageIcon className="h-3.5 w-3.5" />}>
                  {languageLabel}
                </ProfileChip>
                <ProfileChip icon={<UserIcon className="h-3.5 w-3.5" />}>
                  {profile.isAgent
                    ? t('Contacts.agent', { defaultValue: 'Agent' })
                    : t('Contacts.human', { defaultValue: 'Human' })}
                </ProfileChip>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex flex-wrap gap-3">
              <StatBadge value={friendCount} label={t('Profile.friends', { defaultValue: 'Friends' })} />
              <StatBadge value={postCount} label={t('Profile.posts', { defaultValue: 'Posts' })} />
              <StatBadge value={likesCount} label={t('Profile.likes', { defaultValue: 'Likes' })} />
            </div>
            <div className="flex w-full flex-wrap justify-end gap-2">
              {showMessageButton !== false ? (
                <ActionButton
                  label={t('Profile.message', { defaultValue: 'Message' })}
                  icon={<MessageIcon className="h-4 w-4" />}
                  onClick={onMessage}
                  variant="primary"
                />
              ) : null}
              {!isOwnProfile ? (
                <ActionButton
                  label={t('Profile.sendGift', { defaultValue: 'Send Gift' })}
                  icon={<GiftIcon className="h-4 w-4" />}
                  onClick={onSendGift}
                  variant="secondary"
                />
              ) : null}
            </div>
            {addFriendHint ? (
              <p className="text-xs text-amber-600">{addFriendHint}</p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

type ProfileTabPanelProps = {
  profile: ProfileData;
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  isOwnProfile: boolean;
  t: TFunction;
};

export function ProfileTabPanel({ profile, activeTab, onTabChange, isOwnProfile, t }: ProfileTabPanelProps) {
  const giftCount = profile.giftStats ? Object.values(profile.giftStats).reduce((sum, value) => sum + value, 0) : 0;
  const isFeedStyleTab = activeTab === 'Posts' || activeTab === 'Collections' || activeTab === 'Likes' || activeTab === 'Gifts';
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || t('Profile.unknownRegion', { defaultValue: 'Unknown region' });
  const languageLabel = profile.languages.length > 0 ? profile.languages.join(', ') : t('Profile.noLanguageSet', { defaultValue: 'No language set' });

  return (
    <>
      <div className="border-b border-[#edf2f6] bg-white px-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={`relative px-4 py-3 text-sm font-medium transition-all ${
                  activeTab === tab ? 'text-[#111827]' : 'text-[#6b7280] hover:text-[#374151]'
                }`}
              >
                {getProfileTabLabel(t, tab)}
                {activeTab === tab ? (
                  <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-[#4ECCA3]" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            {activeTab === 'Posts' && (profile.stats?.postsCount ?? 0) > 0 && `${profile.stats?.postsCount} posts`}
            {activeTab === 'Collections' && 'Saved items'}
            {activeTab === 'Likes' && 'Liked posts'}
            {activeTab === 'Gifts' && giftCount > 0 && `${giftCount} gifts`}
          </div>
        </div>
      </div>

      <div className="bg-[#f7f9fc] px-6 py-6">
        {isFeedStyleTab ? (
          <section className="min-w-0">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h3 className="text-[15px] font-semibold uppercase tracking-[0.16em] text-[#111827]">
                {activeTab === 'Posts' && 'Dynamic Feed'}
                {activeTab === 'Collections' && 'Saved Feed'}
                {activeTab === 'Likes' && 'Liked Feed'}
                {activeTab === 'Gifts' && 'Gift Collection'}
              </h3>
              <div className="h-px flex-1 bg-gradient-to-r from-[#d8e1e8] to-transparent opacity-80" />
              <span className="shrink-0 text-xs text-[#8a94a6]">
                {activeTab === 'Posts' && (profile.stats?.postsCount ?? 0) > 0 && `${profile.stats?.postsCount} posts`}
                {activeTab === 'Collections' && 'Saved items'}
                {activeTab === 'Likes' && 'Liked posts'}
                {activeTab === 'Gifts' && '5,840 Gems received'}
              </span>
            </div>
            {activeTab === 'Posts' && <PostsTab profileId={profile.id} />}
            {activeTab === 'Collections' && <CollectionsTab profileId={profile.id} canManageSavedPosts={isOwnProfile} />}
            {activeTab === 'Likes' && <LikesTab profileId={profile.id} />}
            {activeTab === 'Gifts' && <GiftsTab />}
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[300px,minmax(0,1fr)]">
            <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <section className="rounded-[24px] border border-[#e7edf3] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                <h3 className="text-sm font-semibold text-[#111827]">
                  {t('Profile.detailsTitle', { defaultValue: 'Profile Details' })}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[#8a94a6]">
                  Reference details and profile attributes for this contact.
                </p>
                <div className="mt-5 space-y-3.5">
                  <InfoTile icon={<CalendarIcon className="h-4 w-4" />} label={t('Profile.joined', { defaultValue: 'Joined' })} value={formatProfileDate(profile.createdAt) || t('Common.unknown', { defaultValue: 'Unknown' })} />
                  <InfoTile icon={<LocationIcon className="h-4 w-4" />} label={t('Profile.location', { defaultValue: 'Location' })} value={locationLabel} />
                  <InfoTile icon={<UserIcon className="h-4 w-4" />} label={t('Profile.gender', { defaultValue: 'Gender' })} value={profile.gender || t('Common.notSet', { defaultValue: 'Not set' })} />
                  <InfoTile icon={<LanguageIcon className="h-4 w-4" />} label={t('Profile.languages', { defaultValue: 'Languages' })} value={languageLabel} />
                </div>
              </section>

              <section className="rounded-[24px] border border-[#e7edf3] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                <h3 className="text-sm font-semibold text-[#111827]">
                  {t('Profile.status', { defaultValue: 'Status' })}
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill active={profile.isOnline}>{profile.isOnline ? 'Online now' : 'Offline'}</StatusPill>
                  <StatusPill>{profile.isAgent ? 'Agent identity' : 'Human account'}</StatusPill>
                  {profile.agentTier ? <StatusPill>{profile.agentTier}</StatusPill> : null}
                  {profile.agentState ? <StatusPill>{profile.agentState}</StatusPill> : null}
                </div>
                {profile.tags.length > 0 ? (
                  <>
                    <div className="mt-5 h-px bg-[#edf2f6]" />
                    <div className="mt-4 flex flex-wrap gap-2">
                      {profile.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-[#d8efe8] bg-[#eefaf6] px-3 py-1 text-xs font-medium text-[#2f7d6b]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            </aside>

            <section className="min-w-0">
              <GiftsTab />
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function ProfileChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#dbe6ee] bg-[#fbfdff] px-3.5 py-2 text-xs font-medium text-[#526071]">
      <span className="text-[#8091a7]">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

function StatBadge({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[92px] rounded-[18px] border border-[#dce6ee] bg-[#fbfdff] px-4 py-3 text-center">
      <div className="text-xl font-semibold tracking-[-0.02em] text-[#111827]">{value}</div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#8a94a6]">{label}</div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  variant,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  variant: 'primary' | 'secondary';
}) {
  const classes = variant === 'primary'
    ? 'bg-[#4ECCA3] text-white shadow-md hover:bg-[#3DBB94] hover:shadow-lg active:scale-95'
    : 'bg-[#4ECCA3]/10 text-[#3DBB94] shadow-sm hover:bg-[#4ECCA3] hover:text-white hover:shadow-md active:scale-95';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border-0 px-4 py-2.5 text-sm font-semibold transition-all ${classes}`}
    >
      {icon}
      {label}
    </button>
  );
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[18px] bg-[#f8fbfd] px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-[#4ECCA3] shadow-[0_2px_8px_rgba(78,204,163,0.12)]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#94a3b8]">{label}</div>
        <div className="mt-1 text-sm leading-5 text-[#334155]">{value}</div>
      </div>
    </div>
  );
}

function StatusPill({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${
        active ? 'bg-[#e8f8f2] text-[#1f8f69]' : 'bg-[#f3f6fa] text-[#607086]'
      }`}
    >
      {children}
    </span>
  );
}

export function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
