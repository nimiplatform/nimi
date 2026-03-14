import type { ProfileData } from './profile-model';
import { useTranslation } from 'react-i18next';
import { formatProfileDate } from './profile-model';

type ProfileInfoProps = {
  profile: ProfileData;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

export function ProfileInfo({ profile }: ProfileInfoProps) {
  const { t } = useTranslation();
  const hasBasicInfo = profile.createdAt || profile.city || profile.countryCode || profile.gender || profile.languages.length > 0;
  const hasAgentInfo = profile.isAgent && (profile.agentState || profile.agentCategory || profile.agentOrigin || profile.agentWakeStrategy || profile.agentAccountVisibility !== null);

  if (!hasBasicInfo && !hasAgentInfo && profile.tags.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* Tags */}
      {profile.tags.length > 0 ? (
        <div>
          <div className="flex items-center gap-2">
            <TagIcon className="h-4 w-4 text-mint-500" />
            <h3 className="text-sm font-semibold text-gray-900">{t('Profile.info.tags', { defaultValue: 'Tags' })}</h3>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {profile.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-mint-50 px-3 py-1.5 text-xs font-medium text-mint-700"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Basic Info */}
      {hasBasicInfo ? (
        <div>
          <div className="flex items-center gap-2">
            <InfoIcon className="h-4 w-4 text-mint-500" />
            <h3 className="text-sm font-semibold text-gray-900">{t('Profile.info.info', { defaultValue: 'Info' })}</h3>
          </div>
          <div className="mt-2 divide-y divide-gray-100">
            {profile.createdAt ? <InfoRow label={t('Profile.info.joined', { defaultValue: 'Joined' })} value={formatProfileDate(profile.createdAt)} /> : null}
            {profile.city ? <InfoRow label={t('Profile.info.city', { defaultValue: 'City' })} value={profile.city} /> : null}
            {profile.countryCode ? <InfoRow label={t('Profile.info.country', { defaultValue: 'Country' })} value={profile.countryCode} /> : null}
            {profile.gender ? <InfoRow label={t('Profile.info.gender', { defaultValue: 'Gender' })} value={profile.gender} /> : null}
            {profile.languages.length > 0 ? <InfoRow label={t('Profile.info.languages', { defaultValue: 'Languages' })} value={profile.languages.join(', ')} /> : null}
          </div>
        </div>
      ) : null}

      {/* Agent Info */}
      {hasAgentInfo ? (
        <div>
          <div className="flex items-center gap-2">
            <BotIcon className="h-4 w-4 text-mint-500" />
            <h3 className="text-sm font-semibold text-gray-900">{t('Profile.info.agentDetails', { defaultValue: 'Agent Details' })}</h3>
          </div>
          <div className="mt-2 divide-y divide-gray-100">
            {profile.agentState ? <InfoRow label={t('Profile.info.state', { defaultValue: 'State' })} value={profile.agentState} /> : null}
            {profile.agentCategory ? <InfoRow label={t('Profile.info.category', { defaultValue: 'Category' })} value={profile.agentCategory} /> : null}
            {profile.agentOrigin ? <InfoRow label={t('Profile.info.origin', { defaultValue: 'Origin' })} value={profile.agentOrigin} /> : null}
            {profile.agentWakeStrategy ? <InfoRow label={t('Profile.info.wakeStrategy', { defaultValue: 'Wake Strategy' })} value={profile.agentWakeStrategy} /> : null}
            {profile.agentAccountVisibility !== null ? (
              <InfoRow
                label={t('Profile.info.visibility', { defaultValue: 'Visibility' })}
                value={profile.agentAccountVisibility === 'PUBLIC'
                  ? t('Profile.info.public', { defaultValue: 'Public' })
                  : t('Profile.info.private', { defaultValue: 'Private' })}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Icons
function TagIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <circle cx="7" cy="7" r="1" />
    </svg>
  );
}

function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function BotIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
