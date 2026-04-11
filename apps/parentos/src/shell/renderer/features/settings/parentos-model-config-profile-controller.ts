import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AIScopeRef } from '@nimiplatform/sdk/mod';
import type {
  ModelConfigProfileController,
  ModelConfigProfileCopy,
} from '@nimiplatform/nimi-kit/features/model-config';
import { getParentosAIConfigService } from './parentos-ai-config-service.js';

type ParentosModelConfigProfileControllerInput = {
  scopeRef: AIScopeRef;
  currentOrigin: {
    profileId: string;
    title?: string | null;
  } | null;
  copy: ModelConfigProfileCopy;
};

export function useParentosModelConfigProfileController(
  input: ParentosModelConfigProfileControllerInput,
): ModelConfigProfileController {
  const surface = useMemo(() => getParentosAIConfigService(), []);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['parentos-model-config-profile-catalog', input.scopeRef.kind, input.scopeRef.ownerId, input.scopeRef.surfaceId || ''],
    queryFn: () => surface.aiProfile.list(),
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
        if (!result.success) {
          setApplyError(result.failureReason || input.copy.emptyLabel);
        }
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
    onReload: () => {
      void profilesQuery.refetch();
    },
  };
}
