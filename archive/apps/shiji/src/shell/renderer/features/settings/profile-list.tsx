/**
 * profile-list.tsx — Profile list with active indicator and switcher (SJ-SHELL-006)
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LearnerProfile } from '@renderer/app-shell/app-store.js';

type ProfileListProps = {
  profiles: LearnerProfile[];
  activeProfileId: string | null;
  onEdit: (profile: LearnerProfile) => void;
  onSwitch: (profileId: string) => Promise<void>;
};

export function ProfileList({ profiles, activeProfileId, onEdit, onSwitch }: ProfileListProps) {
  const { t } = useTranslation();
  const [switching, setSwitching] = useState<string | null>(null);

  async function handleSwitch(id: string) {
    setSwitching(id);
    try {
      await onSwitch(id);
    } finally {
      setSwitching(null);
    }
  }

  if (profiles.length === 0) {
    return (
      <p className="text-sm text-neutral-400 py-2">{t('settings.parentMode.noProfiles')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {profiles.map((profile) => {
        const isActive = profile.id === activeProfileId;
        return (
          <div
            key={profile.id}
            className={[
              'flex items-center justify-between rounded-xl px-4 py-3 border transition-colors',
              isActive
                ? 'border-amber-300 bg-amber-50'
                : 'border-neutral-200 bg-white',
            ].join(' ')}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-neutral-800 truncate">
                  {profile.displayName}
                </span>
                {isActive && (
                  <span className="text-xs bg-amber-200 text-amber-800 rounded-full px-2 py-0.5 font-medium shrink-0">
                    {t('settings.parentMode.activeProfile')}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">{t('settings.parentMode.ageLabel', { age: profile.age })}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              {!isActive && (
                <button
                  onClick={() => void handleSwitch(profile.id)}
                  disabled={switching === profile.id}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50 transition-colors"
                >
                  {switching === profile.id ? '…' : t('settings.parentMode.switchProfile')}
                </button>
              )}
              <button
                onClick={() => onEdit(profile)}
                className="text-xs text-neutral-500 hover:text-neutral-700 font-medium transition-colors"
              >
                {t('settings.parentMode.editProfile')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
