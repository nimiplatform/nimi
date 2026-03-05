import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import type { ProfileData, ProfileTab } from './profile-model';
import { formatProfileDate, getProfileInitial } from './profile-model';
import { PostsTab } from './components/posts-tab';
import { MediaTab } from './components/media-tab';
import { CollectionsTab } from './components/collections-tab';
import { GiftsTab } from './components/gifts-tab';
import { MediaLightbox } from './components/media-lightbox';
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

type MediaSelection = {
  post: PostDto;
  mediaIndex: number;
};

const TABS: ProfileTab[] = ['Posts', 'Media', 'Collections', 'Gifts'];

export function ProfileView(props: ProfileViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [selectedMedia, setSelectedMedia] = useState<MediaSelection | null>(null);
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
  const useAgentSidebar = props.sidebarStyleVariant === 'agent';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 bg-white/70 px-6 backdrop-blur-xl">
        <h1 className="text-lg font-medium tracking-tight text-gray-800">{t('ProfileView.title')}</h1>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex gap-6">
            {/* Left Sidebar - Sticky */}
            <div className="w-72 shrink-0">
              <div className="sticky top-6">
                {/* Combined Profile Card */}
                <div
                  className={`relative overflow-hidden ${
                    useAgentSidebar
                      ? 'rounded-[24px] bg-white shadow-lg'
                      : 'rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl'
                  }`}
                >
                  {useAgentSidebar ? (
                    <div className="h-28 w-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-violet-400" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                  )}
                  
                  {/* More Options Menu */}
                  {!props.isOwnProfile && (
                    <div className="absolute top-4 right-4 z-10">
                      <button
                        ref={menuButtonRef}
                        type="button"
                        onClick={() => setShowMenu(!showMenu)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100/50 hover:text-gray-600"
                        title="More options"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="6" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="18" r="2" />
                        </svg>
                      </button>
                      
                      {/* Dropdown Menu */}
                      {showMenu && (
                        <div
                          ref={menuRef}
                          className="absolute right-0 top-full mt-1 w-40 rounded-xl border border-gray-100 bg-white py-1 shadow-[0_8px_32px_rgba(0,0,0,0.15)]"
                        >
                          <button
                            type="button"
                            onClick={handleBlock}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
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
                  )}
                  
                  <div className={`relative flex flex-col items-center ${useAgentSidebar ? '-mt-12 px-6 pb-6' : ''}`}>
                    {/* Avatar with agent glow effect */}
                    <div className="relative">
                      <div className={useAgentSidebar ? 'h-24 w-24 rounded-2xl bg-white p-1 shadow-md' : `${profile.isAgent ? '' : 'rounded-3xl bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] p-1'}`}>
                        {profile.avatarUrl ? (
                          <img
                            src={profile.avatarUrl}
                            alt={profile.displayName}
                            className={`h-24 w-24 object-cover rounded-2xl ${profile.isAgent ? '' : ''}`}
                            style={profile.isAgent ? {
                              boxShadow: '0 0 0 2px #a855f7, 0 0 12px 4px rgba(168, 85, 247, 0.5), 0 0 20px 8px rgba(124, 58, 237, 0.3)'
                            } : undefined}
                          />
                        ) : (
                          <div 
                            className={`flex h-24 w-24 items-center justify-center rounded-2xl text-3xl font-bold ${
                              profile.isAgent 
                                ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                                : 'bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-[#4ECCA3]'
                            }`}
                            style={useAgentSidebar ? {
                              ...(profile.isAgent ? {
                                boxShadow: '0 0 0 2px #a855f7, 0 0 12px 4px rgba(168, 85, 247, 0.5), 0 0 20px 8px rgba(124, 58, 237, 0.3)'
                              } : {})
                            } : (profile.isAgent ? {
                              boxShadow: '0 0 0 2px #a855f7, 0 0 12px 4px rgba(168, 85, 247, 0.5), 0 0 20px 8px rgba(124, 58, 237, 0.3)'
                            } : undefined)}
                          >
                            {getProfileInitial(profile.displayName)}
                          </div>
                        )}
                      </div>
                      {profile.isOnline && (
                        <span className={`absolute h-4 w-4 rounded-full border-2 border-white bg-[#4ECCA3] shadow-sm ${profile.isAgent ? 'right-0 bottom-0' : 'right-1 bottom-1'}`} />
                      )}
                    </div>

                    {/* Name */}
                    <h2 className="mt-4 text-lg font-semibold tracking-tight text-gray-800">
                      {profile.displayName}
                    </h2>
                    <p className="text-sm text-gray-500">{profile.handle}</p>

                    {/* Type Badge */}
                    <span className="mt-2 inline-flex items-center rounded-full bg-[#4ECCA3]/10 px-3 py-1 text-xs font-medium text-[#2A9D8F]">
                      {profile.isAgent ? 'Agent' : 'Human'}
                    </span>

                    {/* Bio */}
                    {profile.bio && (
                      <p className="mt-3 text-center text-sm text-gray-600 leading-relaxed">{profile.bio}</p>
                    )}

                    {/* Stats */}
                    <div className={`mt-4 flex items-center ${useAgentSidebar ? 'w-full justify-around rounded-2xl bg-gray-50 px-4 py-4' : 'gap-8'}`}>
                      <div className="text-center">
                        <p className="text-lg font-bold text-gray-800">{friendCount}</p>
                        <p className="text-xs text-gray-500">Friends</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-gray-800">{postCount}</p>
                        <p className="text-xs text-gray-500">Posts</p>
                      </div>
                    </div>

                    {/* Action Buttons - Icon Only */}
                    <div className="mt-5 flex items-center justify-center gap-3">
                      {props.showMessageButton !== false && (
                        <button
                          type="button"
                          onClick={props.onMessage}
                          title="Chat"
                          className={useAgentSidebar
                            ? 'flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 active:scale-95'
                            : 'flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4ECCA3] text-white shadow-[0_4px_14px_rgba(78,204,163,0.35)] transition-all hover:bg-[#3DBA92] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95'}
                        >
                          <MessageIcon className="h-5 w-5" />
                        </button>
                      )}
                      {!props.isOwnProfile && (
                        <button
                          type="button"
                          onClick={props.onSendGift}
                          title="Send Gift"
                          className={useAgentSidebar
                            ? 'flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 active:scale-95'
                            : 'flex h-11 w-11 items-center justify-center rounded-2xl border border-[#4ECCA3]/30 bg-white/60 text-[#2A9D8F] backdrop-blur-sm transition-all hover:bg-[#4ECCA3]/10 active:scale-95'}
                        >
                          <GiftIcon className="h-5 w-5" />
                        </button>
                      )}
                    </div>

                    {/* Add Friend Hint */}
                    {props.addFriendHint && (
                      <p className="mt-2 text-xs text-amber-600">{props.addFriendHint}</p>
                    )}

                    {/* Divider */}
                    <div className="my-5 w-full border-t border-white/60" />

                    {/* About Section */}
                    <div className="w-full">
                      <h3 className="text-sm font-semibold text-gray-800">About</h3>
                      
                      <div className="mt-4 space-y-3">
                        <AboutRow 
                          icon={<CalendarIcon className="h-4 w-4" />}
                          label={`Joined ${formatProfileDate(profile.createdAt)}`}
                        />
                        <AboutRow 
                          icon={<LocationIcon className="h-4 w-4" />}
                          label={profile.city && profile.countryCode 
                            ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
                            : profile.city || profile.countryCode?.toUpperCase() || '-'
                          }
                        />
                        <AboutRow 
                          icon={<UserIcon className="h-4 w-4" />}
                          label={profile.gender || '-'}
                        />
                        <AboutRow 
                          icon={<LanguageIcon className="h-4 w-4" />}
                          label={profile.languages.join(', ') || '-'}
                        />
                      </div>

                      {/* Tags */}
                      {profile.tags.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-white/60">
                          <h3 className="text-sm font-semibold text-gray-800 mb-3">Tags</h3>
                          <div className="flex flex-wrap gap-2">
                            {profile.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-xl bg-[#4ECCA3]/15 px-3 py-1.5 text-xs font-medium text-[#2A9D8F] backdrop-blur-sm transition hover:bg-[#4ECCA3]/25"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Content */}
            <div className="min-w-0 flex-1">
              {/* Tab Bar - Enhanced Style */}
              <div className="sticky top-0 z-10 mb-6 flex rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100/50 overflow-hidden">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative flex-1 px-4 py-4 text-[15px] font-semibold tracking-wide transition-all duration-200 ${
                      activeTab === tab
                        ? 'text-[#4ECCA3] bg-[#4ECCA3]/5'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {tab}
                    {activeTab === tab && (
                      <span className="absolute bottom-0 left-4 right-4 h-[3px] rounded-full bg-[#4ECCA3]" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab Content - Clean Cards */}
              <div className="space-y-4">
                {activeTab === 'Posts' && <PostsTab profileId={profile.id} />}
                {activeTab === 'Media' && (
                  <MediaTab
                    profileId={profile.id}
                    onMediaClick={(post, idx) => setSelectedMedia({ post, mediaIndex: idx })}
                  />
                )}
                {activeTab === 'Collections' && <CollectionsTab profileId={profile.id} />}
                {activeTab === 'Gifts' && <GiftsTab giftStats={profile.giftStats} />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Media Lightbox */}
      {selectedMedia && (
        <MediaLightbox
          post={selectedMedia.post}
          initialMediaIndex={selectedMedia.mediaIndex}
          onClose={() => setSelectedMedia(null)}
        />
      )}

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

// About Row Component
function AboutRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4ECCA3]/10 text-[#4ECCA3]">
        {icon}
      </span>
      <span className="text-gray-600">{label}</span>
    </div>
  );
}

// Info Row Component
function _InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
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
