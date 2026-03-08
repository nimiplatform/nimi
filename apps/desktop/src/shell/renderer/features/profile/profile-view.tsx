import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ProfileData, ProfileTab } from './profile-model';
import { formatProfileDate } from './profile-model';
import { PostsTab } from './posts-tab';
import { CollectionsTab } from './collections-tab';
import { LikesTab } from './likes-tab';
import { GiftsTab } from './gifts-tab';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

type ProfileViewProps = {
  profile: ProfileData;
  isOwnProfile: boolean;
  loading: boolean;
  error: boolean;
  onBack: () => void;
  onMessage: () => void;
  onAddFriend: () => void;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  showMessageButton?: boolean;
  sidebarStyleVariant?: 'default' | 'agent';
};

const TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

export function ProfileView(props: ProfileViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [showMenu, setShowMenu] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    
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

  const handleBlock = () => {
    setShowMenu(false);
    setShowBlockModal(true);
  };

  const confirmBlock = async () => {
    setIsBlocking(true);
    try {
      await dataSync.blockUser({
        id: props.profile.id,
        displayName: props.profile.displayName,
        handle: props.profile.handle,
        avatarUrl: props.profile.avatarUrl,
      });
      
      // Optimistically update the contacts cache to show the blocked user immediately
      queryClient.setQueriesData({ queryKey: ['contacts'], exact: false }, (oldData: unknown) => {
        if (!oldData || typeof oldData !== 'object') return oldData;
        const data = oldData as Record<string, unknown>;
        const currentBlocked = Array.isArray(data.blocked) ? data.blocked : [];
        
        // Check if user is already in blocked list
        const alreadyBlocked = currentBlocked.some((u: Record<string, unknown>) => u.id === props.profile.id);
        if (alreadyBlocked) return oldData;
        
        // Add the blocked user to the list
        return {
          ...data,
          blocked: [
            ...currentBlocked,
            {
              id: props.profile.id,
              displayName: props.profile.displayName,
              handle: props.profile.handle,
              avatarUrl: props.profile.avatarUrl,
              isAgent: false,
            },
          ],
        };
      });
      
      // Also refetch to ensure data is in sync with backend
      await queryClient.refetchQueries({ queryKey: ['contacts'], exact: false, type: 'all' });
      
      setShowBlockModal(false);
      // Navigate back after blocking
      props.onBack();
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'profile',
        message: 'action:block-user:failed',
        details: { userId: props.profile.id, error: String(error) },
      });
    } finally {
      setIsBlocking(false);
    }
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    setShowMenu(false);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await dataSync.removeFriend(props.profile.id);
      await queryClient.refetchQueries({ queryKey: ['contacts'], exact: false, type: 'all' });
      setShowDeleteModal(false);
      props.onBack();
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'profile',
        message: 'action:delete-friend:failed',
        details: { userId: props.profile.id, error: String(error) },
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#4ECCA3]" />
          {t('ProfileView.loading')}
        </div>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertIcon className="h-6 w-6" />
        </div>
        <p className="text-sm text-red-600">{t('ProfileView.error')}</p>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-2xl bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 backdrop-blur-sm transition hover:bg-white"
        >
          {t('Common.back')}
        </button>
      </div>
    );
  }

  const { profile } = props;
  const friendCount = profile.stats?.friendsCount ?? 0;
  const postCount = profile.stats?.postsCount ?? 0;
  const likesCount = profile.stats?.likesCount ?? 0;
  const isFeedStyleTab = (
    activeTab === 'Posts'
    || activeTab === 'Collections'
    || activeTab === 'Likes'
    || activeTab === 'Gifts'
  );
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
    : profile.city || profile.countryCode?.toUpperCase() || 'Unknown region';
  const languageLabel = profile.languages.length > 0 ? profile.languages.join(', ') : 'No language set';
  const relationshipLabel = profile.isAgent ? 'AI Agent Profile' : 'Contact Profile';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <div className="overflow-hidden rounded-[28px] border border-[#dbe3ea] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
            <div className="relative h-[190px] w-full overflow-hidden" style={agentHeaderStyle}>
              <div className="absolute inset-0 bg-gradient-to-r from-[#191f2d]/16 via-transparent to-[#ffffff]/10" />
              <div className="absolute inset-x-0 top-0 h-px bg-white/70" />

              <button
                type="button"
                onClick={props.onBack}
                className="absolute left-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/16 text-white backdrop-blur-md transition hover:bg-white/24"
                title="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              {!props.isOwnProfile ? (
                <div className="absolute right-5 top-5 z-10">
                  <button
                    ref={menuButtonRef}
                    type="button"
                    onClick={() => setShowMenu(!showMenu)}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/16 text-white backdrop-blur-md transition hover:bg-white/24"
                    title="More options"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="6" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="18" r="2" />
                    </svg>
                  </button>
                  {showMenu && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-2 w-44 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]"
                    >
                      <button
                        type="button"
                        onClick={handleBlock}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                      >
                        <AlertIcon className="h-4 w-4 text-gray-400" />
                        Block
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Delete Friend
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
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
                      {profile.bio || 'No profile description has been added yet.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      <ProfileChip icon={<CalendarIcon className="h-3.5 w-3.5" />}>
                        {formatProfileDate(profile.createdAt) || 'Unknown joined date'}
                      </ProfileChip>
                      <ProfileChip icon={<LocationIcon className="h-3.5 w-3.5" />}>
                        {locationLabel}
                      </ProfileChip>
                      <ProfileChip icon={<LanguageIcon className="h-3.5 w-3.5" />}>
                        {languageLabel}
                      </ProfileChip>
                      <ProfileChip icon={<UserIcon className="h-3.5 w-3.5" />}>
                        {profile.isAgent ? 'Agent' : 'Human'}
                      </ProfileChip>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-3">
                  <div className="flex flex-wrap gap-3">
                    <StatBadge value={friendCount} label="Friends" />
                    <StatBadge value={postCount} label="Posts" />
                    <StatBadge value={likesCount} label="Likes" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 w-full">
                    {props.showMessageButton !== false ? (
                      <ActionButton
                        label="Message"
                        icon={<MessageIcon className="h-4 w-4" />}
                        onClick={props.onMessage}
                        variant="primary"
                      />
                    ) : null}
                    {!props.isOwnProfile ? (
                      <ActionButton
                        label="Send Gift"
                        icon={<GiftIcon className="h-4 w-4" />}
                        onClick={props.onSendGift}
                        variant="secondary"
                      />
                    ) : null}
                  </div>
                  {props.addFriendHint ? (
                    <p className="text-xs text-amber-600">{props.addFriendHint}</p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Tabs Navigation */}
            <div className="border-b border-[#edf2f6] bg-white px-6">
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`relative px-4 py-3 text-sm font-medium transition-all ${
                        activeTab === tab
                          ? 'text-[#111827]'
                          : 'text-[#6b7280] hover:text-[#374151]'
                      }`}
                    >
                      {tab}
                      {activeTab === tab ? (
                        <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-[#4ECCA3]" />
                      ) : null}
                    </button>
                  ))}
                </div>
                {/* Tab Title & Count */}
                <div className="text-xs text-gray-500">
                  {activeTab === 'Posts' && (profile.stats?.postsCount ?? 0) > 0 && `${profile.stats?.postsCount} posts`}
                  {activeTab === 'Collections' && 'Saved items'}
                  {activeTab === 'Likes' && 'Liked posts'}
                  {activeTab === 'Gifts' && (profile.giftStats ? Object.values(profile.giftStats).reduce((a, b) => a + b, 0) : 0) > 0 && `${Object.values(profile.giftStats).reduce((a, b) => a + b, 0)} gifts`}
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
                  {activeTab === 'Collections' && <CollectionsTab profileId={profile.id} canManageSavedPosts={props.isOwnProfile} />}
                  {activeTab === 'Likes' && <LikesTab profileId={profile.id} />}
                  {activeTab === 'Gifts' && <GiftsTab />}
                </section>
              ) : (
                <div className="grid gap-6 xl:grid-cols-[300px,minmax(0,1fr)]">
                  <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                    <section className="rounded-[24px] border border-[#e7edf3] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                      <h3 className="text-sm font-semibold text-[#111827]">Profile Details</h3>
                      <p className="mt-1 text-xs leading-5 text-[#8a94a6]">
                        Reference details and profile attributes for this contact.
                      </p>
                      <div className="mt-5 space-y-3.5">
                        <InfoTile icon={<CalendarIcon className="h-4 w-4" />} label="Joined" value={formatProfileDate(profile.createdAt) || 'Unknown'} />
                        <InfoTile icon={<LocationIcon className="h-4 w-4" />} label="Location" value={locationLabel} />
                        <InfoTile icon={<UserIcon className="h-4 w-4" />} label="Gender" value={profile.gender || 'Not set'} />
                        <InfoTile icon={<LanguageIcon className="h-4 w-4" />} label="Languages" value={languageLabel} />
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-[#e7edf3] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                      <h3 className="text-sm font-semibold text-[#111827]">Status</h3>
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
          </div>
        </div>
      </div>

      {/* Delete Friend Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Remove Friend</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to remove <span className="font-medium text-gray-900">{props.profile.displayName}</span> from your friends?
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Confirmation Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Block User</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to block <span className="font-medium text-gray-900">{props.profile.displayName}</span>? They will be moved to your Blocked list and won't be able to contact you.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                disabled={isBlocking}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBlock}
                disabled={isBlocking}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isBlocking ? 'Blocking...' : 'Block'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
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
  icon: React.ReactNode;
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

function InfoTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
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

function StatusPill({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
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

// Icons
function AlertIcon({ className = '' }: { className?: string }) {
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
