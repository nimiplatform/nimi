import { useTranslation } from 'react-i18next';
import type { ProfileData } from '../profile-model';
import { getProfileInitial } from '../profile-model';

type ProfileHeaderProps = {
  profile: ProfileData;
  isOwnProfile: boolean;
  onMessage: () => void;
  onAddFriend: () => void;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  isFriend?: boolean;
};

export function ProfileHeader({
  profile,
  isOwnProfile,
  onMessage,
  onAddFriend,
  canAddFriend = true,
  addFriendHint = null,
  onSendGift,
  isFriend = false,
}: ProfileHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center">
      {/* Avatar */}
      <div className="relative">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={profile.displayName}
            className={`h-24 w-24 object-cover ${
              profile.isAgent ? 'rounded-lg' : 'rounded-2xl ring-4 ring-mint-100'
            }`}
            style={profile.isAgent ? {
              boxShadow: '0 0 0 2px #a855f7, 0 0 12px 4px rgba(168, 85, 247, 0.5), 0 0 20px 8px rgba(124, 58, 237, 0.3)'
            } : undefined}
          />
        ) : (
          <div 
            className={`flex h-24 w-24 items-center justify-center text-2xl font-bold ${
              profile.isAgent 
                ? 'rounded-lg bg-slate-100 text-slate-700' 
                : 'rounded-2xl bg-gradient-to-br from-mint-400 to-mint-500 text-white ring-4 ring-mint-100'
            }`}
            style={profile.isAgent ? {
              boxShadow: '0 0 0 2px #a855f7, 0 0 12px 4px rgba(168, 85, 247, 0.5), 0 0 20px 8px rgba(124, 58, 237, 0.3)'
            } : undefined}
          >
            {getProfileInitial(profile.displayName)}
          </div>
        )}
        {profile.isOnline ? (
          <span className="absolute -right-1 -bottom-1 h-5 w-5 rounded-full border-3 border-white bg-green-400" />
        ) : null}
      </div>

      {/* Name & Handle */}
      <h2 className="mt-4 text-xl font-bold text-gray-900">
        {profile.displayName}
      </h2>
      <p className="mt-1 text-sm text-gray-500">{profile.handle}</p>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {profile.isAgent ? (
          <span className="inline-flex items-center rounded-full bg-mint-100 px-3 py-1 text-xs font-medium text-mint-700">
            {t('ProfileView.agent')}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
            {t('ProfileView.human')}
          </span>
        )}
        {profile.agentState ? (
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            profile.agentState === 'ACTIVE'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {profile.agentState}
          </span>
        ) : null}
        {profile.agentTier && profile.agentTier !== 'COMMUNITY' ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
            {profile.agentTier}
          </span>
        ) : null}
      </div>

      {/* Bio */}
      {profile.bio ? (
        <p className="mt-4 max-w-md text-center text-sm text-gray-600">{profile.bio}</p>
      ) : null}

      {/* Stats */}
      {profile.stats ? (
        <div className="mt-5 flex gap-8">
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-gray-900">{profile.stats.friendsCount}</span>
            <span className="text-xs text-gray-500">{t('ProfileView.friends')}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-gray-900">{profile.stats.postsCount}</span>
            <span className="text-xs text-gray-500">{t('ProfileView.posts')}</span>
          </div>
        </div>
      ) : null}

      {/* Action Buttons */}
      {!isOwnProfile ? (
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onMessage}
            className="flex items-center gap-2 rounded-xl bg-mint-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-mint-600"
          >
            <MessageIcon className="h-4 w-4" />
            {t('ProfileView.message')}
          </button>
          {!isFriend && (
            <button
              type="button"
              onClick={onAddFriend}
              disabled={!canAddFriend}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UserPlusIcon className="h-4 w-4" />
              {t('ProfileView.addFriend')}
            </button>
          )}
          <button
            type="button"
            onClick={onSendGift}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50"
          >
            <GiftIcon className="h-4 w-4" />
            {t('ProfileView.sendGift')}
          </button>
        </div>
      ) : null}

      {addFriendHint ? (
        <p className="mt-3 text-xs text-amber-600">{addFriendHint}</p>
      ) : null}
    </div>
  );
}

// Icons
function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UserPlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
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
