import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import type { ProfileData, ProfileTab } from './profile-model';
import { formatProfileDate, getProfileInitial } from './profile-model';
import { PostsTab } from './components/posts-tab';
import { MediaTab } from './components/media-tab';
import { CollectionsTab } from './components/collections-tab';
import { GiftsTab } from './components/gifts-tab';
import { MediaLightbox } from './components/media-lightbox';

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
};

type MediaSelection = {
  post: PostDto;
  mediaIndex: number;
};

const TABS: ProfileTab[] = ['Posts', 'Media', 'Collections', 'Gifts'];

export function ProfileView(props: ProfileViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [selectedMedia, setSelectedMedia] = useState<MediaSelection | null>(null);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/50 bg-white/70 px-6 backdrop-blur-xl">
        {!props.isOwnProfile ? (
          <button
            type="button"
            onClick={props.onBack}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-white/60 hover:text-gray-600"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight text-gray-800">{t('ProfileView.title')}</h1>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex gap-6">
            {/* Left Sidebar - Sticky */}
            <div className="w-72 shrink-0">
              <div className="sticky top-6">
                {/* Combined Profile Card - Glassmorphism */}
                <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                  {/* Subtle gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                  
                  <div className="relative flex flex-col items-center">
                    {/* Avatar with glass effect */}
                    <div className="relative">
                      <div className="rounded-3xl bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] p-1">
                        {profile.avatarUrl ? (
                          <img
                            src={profile.avatarUrl}
                            alt={profile.displayName}
                            className="h-24 w-24 rounded-2xl object-cover"
                          />
                        ) : (
                          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-3xl font-bold text-[#4ECCA3]">
                            {getProfileInitial(profile.displayName)}
                          </div>
                        )}
                      </div>
                      {profile.isOnline && (
                        <span className="absolute right-1 bottom-1 h-4 w-4 rounded-full border-2 border-white bg-[#4ECCA3] shadow-sm" />
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
                    <div className="mt-4 flex items-center gap-8">
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
                      <button
                        type="button"
                        onClick={props.onMessage}
                        title="Chat"
                        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#4ECCA3] text-white shadow-[0_4px_14px_rgba(78,204,163,0.35)] transition-all hover:bg-[#3DBA92] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] active:scale-95"
                      >
                        <MessageIcon className="h-5 w-5" />
                      </button>
                      {!props.isOwnProfile && (
                        <button
                          type="button"
                          onClick={props.onSendGift}
                          title="Send Gift"
                          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#4ECCA3]/30 bg-white/60 text-[#2A9D8F] backdrop-blur-sm transition-all hover:bg-[#4ECCA3]/10 active:scale-95"
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
              {/* Tab Bar - Minimal Style */}
              <div className="sticky top-0 z-10 mb-4 flex border-b border-gray-200/60 bg-[#F0F4F8]/80 backdrop-blur-xl">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-6 py-3 text-sm font-medium transition-all ${
                      activeTab === tab
                        ? 'text-[#4ECCA3]'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab}
                    {activeTab === tab && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#4ECCA3]" />
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
function ArrowLeftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

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
