import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { AIProfile } from '@nimiplatform/sdk/mod';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import { loadUserProfiles } from '@renderer/features/runtime-config/runtime-config-profile-storage.js';

type TesterProfileSelectProps = {
  selectedProfileId: string;
  onSelect: (profile: AIProfile | null) => void;
};

export function TesterProfileSelect(props: TesterProfileSelectProps) {
  const { t } = useTranslation();
  const { selectedProfileId, onSelect } = props;

  const profilesQuery = useQuery({
    queryKey: ['tester-profile-catalog'],
    queryFn: async () => {
      const service = getDesktopAIConfigService();
      const builtIn = await service.aiProfile.list();
      const userProfiles = loadUserProfiles();
      return [...builtIn, ...userProfiles];
    },
    staleTime: 30_000,
  });

  const profiles = profilesQuery.data || [];

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const profileId = event.target.value;
      if (!profileId) {
        onSelect(null);
        return;
      }
      const profile = profiles.find((p) => p.profileId === profileId) || null;
      onSelect(profile);
    },
    [profiles, onSelect],
  );

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 font-medium">{t('ModelConfig.profile.summaryLabel')}</span>
        <select
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
          value={selectedProfileId}
          onChange={handleChange}
        >
          <option value="">{t('ModelConfig.profile.emptySummaryLabel')}</option>
          {profiles.map((profile) => (
            <option key={profile.profileId} value={profile.profileId}>
              {profile.title || profile.profileId}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
        onClick={() => profilesQuery.refetch()}
        disabled={profilesQuery.isFetching}
      >
        {profilesQuery.isFetching ? t('ModelConfig.profile.loadingLabel') : t('ModelConfig.profile.reloadLabel')}
      </button>
    </div>
  );
}
