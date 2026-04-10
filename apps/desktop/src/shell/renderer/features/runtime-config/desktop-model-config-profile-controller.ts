import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { applyAIProfileToConfig, type AIScopeRef } from '@nimiplatform/sdk/mod';
import type { ModelConfigProfileController, ModelConfigProfileCopy } from '@nimiplatform/nimi-kit/features/model-config';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { loadUserProfiles } from './runtime-config-profile-storage';

type DesktopModelConfigProfileControllerInput = {
  scopeRef: AIScopeRef;
  currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  copy: ModelConfigProfileCopy;
  onManage?: () => void;
};

export function useDesktopModelConfigProfileController(
  input: DesktopModelConfigProfileControllerInput,
): ModelConfigProfileController {
  const surface = useMemo(() => getDesktopAIConfigService(), []);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['desktop-model-config-profile-catalog', input.scopeRef.kind, input.scopeRef.ownerId, input.scopeRef.surfaceId || ''],
    queryFn: async () => {
      const runtimeProfiles = await surface.aiProfile.list();
      const userProfiles = loadUserProfiles();
      return [...runtimeProfiles, ...userProfiles];
    },
    staleTime: 30_000,
  });

  const profiles = useMemo(
    () => (profilesQuery.data || []).map((profile) => ({
      profileId: profile.profileId,
      title: profile.title || profile.profileId,
      description: profile.description || '',
    })),
    [profilesQuery.data],
  );

  const handleApply = useCallback((profileId: string) => {
    if (!profileId) {
      return;
    }
    setApplying(true);
    setApplyError(null);
    void surface.aiProfile.apply(input.scopeRef, profileId)
      .then((result) => {
        if (result.success) {
          return;
        }
        const userProfile = loadUserProfiles().find((profile) => profile.profileId === profileId);
        if (!userProfile) {
          setApplyError(result.failureReason || input.copy.emptyLabel);
          return;
        }
        const currentConfig = surface.aiConfig.get(input.scopeRef);
        const nextConfig = applyAIProfileToConfig(currentConfig, userProfile);
        surface.aiConfig.update(input.scopeRef, nextConfig);
      })
      .catch((error: unknown) => {
        setApplyError(error instanceof Error ? error.message : String(error || 'Failed to apply profile.'));
      })
      .finally(() => {
        setApplying(false);
      });
  }, [input.copy.emptyLabel, input.scopeRef, surface]);

  return {
    currentOrigin: input.currentOrigin,
    profiles,
    selectedProfileId,
    isLoading: profilesQuery.isPending,
    isReloading: profilesQuery.isFetching && !profilesQuery.isPending,
    error: applyError || (profilesQuery.error instanceof Error ? profilesQuery.error.message : null),
    applying,
    copy: input.copy,
    onSelectedProfileChange: setSelectedProfileId,
    onApply: handleApply,
    onManage: input.onManage,
    onReload: () => {
      void profilesQuery.refetch();
    },
  };
}
