import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@renderer/components/tooltip.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import { formatProfileDate } from '@renderer/features/profile/profile-model';

export type ChatProfileCardProps = {
  profileData: ProfileData;
  onClose: () => void;
  onViewFullProfile: () => void;
  viewFullProfileLabel: string;
  onOpenGift?: () => void;
};

export function ChatProfileCard({
  profileData,
  onClose,
  onViewFullProfile,
  viewFullProfileLabel,
  onOpenGift,
}: ChatProfileCardProps) {
  const { t } = useTranslation();
  const friendCount = profileData.stats?.friendsCount ?? 0;
  const postCount = profileData.stats?.postsCount ?? 0;
  const locationLabel = profileData.city && profileData.countryCode
    ? `${profileData.city}, ${profileData.countryCode.toUpperCase()}`
    : profileData.city || profileData.countryCode?.toUpperCase() || '';
  const aboutRows: Array<{ key: string; icon: ReactNode; label: string }> = [];

  if (profileData.createdAt) {
    aboutRows.push({
      key: 'joined',
      icon: <CalendarIcon className="h-3.5 w-3.5" />,
      label: `Joined ${formatProfileDate(profileData.createdAt)}`,
    });
  }

  if (locationLabel) {
    aboutRows.push({
      key: 'location',
      icon: <LocationIcon className="h-3.5 w-3.5" />,
      label: locationLabel,
    });
  }

  if (profileData.gender) {
    aboutRows.push({
      key: 'gender',
      icon: <UserIcon className="h-3.5 w-3.5" />,
      label: profileData.gender,
    });
  }

  if (profileData.languages.length > 0) {
    aboutRows.push({
      key: 'languages',
      icon: <LanguageIcon className="h-3.5 w-3.5" />,
      label: profileData.languages.join(', '),
    });
  }

  return (
    <div className="relative flex flex-col items-center px-1 pb-3 pt-16">
      <button
        type="button"
        onClick={onClose}
        className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-[#7e8a9f] transition hover:bg-[#f2f6f5] hover:text-[#4ECCA3]"
        aria-label={t('ChatTimeline.closeProfileSidebar')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="flex flex-col items-center">
        <div className="relative">
          <EntityAvatar
            imageUrl={profileData.avatarUrl}
            name={profileData.displayName}
            kind={profileData.isAgent ? 'agent' : 'human'}
            sizeClassName="h-20 w-20"
            className={profileData.isAgent ? undefined : 'ring-2 ring-white/70'}
            fallbackClassName={profileData.isAgent ? undefined : 'bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-[#4ECCA3]'}
            textClassName="text-2xl font-bold"
          />
          {profileData.isOnline ? (
            <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#4ECCA3] shadow-sm" />
          ) : null}
        </div>

        <h2 className="mt-3 text-base font-semibold tracking-tight text-gray-800">
          {profileData.displayName}
        </h2>
        <p className="text-xs text-gray-500">{profileData.handle}</p>

        <span className="mt-2 inline-flex items-center rounded-full bg-[#4ECCA3]/10 px-2.5 py-0.5 text-xs font-medium text-[#2A9D8F]">
          {profileData.isAgent ? t('ChatTimeline.agent') : t('ChatTimeline.human')}
        </span>

        {profileData.bio ? (
          <p className="mt-2 text-center text-xs leading-relaxed text-gray-600 line-clamp-3">{profileData.bio}</p>
        ) : null}

        <div className="mt-3 flex items-center gap-6">
          <div className="text-center">
            <p className="text-base font-bold text-gray-800">{friendCount}</p>
            <p className="text-[11px] text-gray-500">{t('ProfileView.friends')}</p>
          </div>
          <div className="text-center">
            <p className="text-base font-bold text-gray-800">{postCount}</p>
            <p className="text-[11px] text-gray-500">{t('ProfileView.posts')}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          {onOpenGift ? (
            <ProfileActionButton
              label={t('GiftSend.sendGift') || 'Send Gift'}
              onClick={onOpenGift}
              icon={<GiftIcon className="h-[18px] w-[18px]" />}
            />
          ) : null}
          <ProfileActionButton
            label={viewFullProfileLabel}
            onClick={onViewFullProfile}
            icon={<OpenProfileIcon className="h-[18px] w-[18px]" />}
            variant="outline"
          />
        </div>

        {aboutRows.length > 0 ? (
          <div className="mt-4 w-full space-y-2">
            {aboutRows.map((row) => (
              <AboutRow key={row.key} icon={row.icon} label={row.label} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProfileActionButton(input: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  variant?: 'solid' | 'outline';
}) {
  const buttonClassName = input.variant === 'outline'
    ? 'border-2 border-[#4ECCA3] bg-white text-[#4ECCA3] hover:-translate-y-0.5 hover:border-[#3DBA92] hover:text-[#3DBA92]'
    : 'bg-[#4ECCA3] text-white hover:-translate-y-0.5 hover:bg-[#3DBA92]';

  return (
    <Tooltip content={input.label} placement="top">
      <button
        type="button"
        onClick={input.onClick}
        className={`flex h-10 w-10 items-center justify-center rounded-full transition-all active:translate-y-0 ${buttonClassName}`}
        aria-label={input.label}
      >
        {input.icon}
      </button>
    </Tooltip>
  );
}

function AboutRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4ECCA3]/10 text-[#4ECCA3]">
        {icon}
      </span>
      <span className="truncate text-gray-600">{label}</span>
    </div>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function UserIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LanguageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function OpenProfileIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 1 1 0-5c2 0 4.5 2.2 4.5 5" />
      <path d="M16.5 8a2.5 2.5 0 1 0 0-5c-2 0-4.5 2.2-4.5 5" />
    </svg>
  );
}
