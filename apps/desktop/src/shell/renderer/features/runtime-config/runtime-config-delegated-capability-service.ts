import {
  createNimiHostRuntimeAgentDelegatedCapabilitySurface,
  type NimiHostRuntimeAgentDelegatedCapabilityClient,
  type NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions,
  type NimiRuntimeAgentDelegatedControlSurfaceQuery,
  type NimiRuntimeAgentDelegatedProviderProfileDraft,
} from '@nimiplatform/sdk/runtime';
type DelegatedCapabilityServiceDeps = {
  getRuntime: () => NimiHostRuntimeAgentDelegatedCapabilityClient;
  getSubjectUserId: NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions['getSubjectUserId'];
  withScopes: NonNullable<NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions['withScopes']>;
};

export type DelegatedProviderProfileDraft = NimiRuntimeAgentDelegatedProviderProfileDraft;
export type DelegatedControlSurfaceQuery = NimiRuntimeAgentDelegatedControlSurfaceQuery;

const DESKTOP_USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_desktop_user';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDesktopDelegatedCapabilityService(deps: DelegatedCapabilityServiceDeps) {
  const surface = createNimiHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: deps.getRuntime,
    getSubjectUserId: async () => {
      const subjectUserId = normalizeText(await deps.getSubjectUserId());
      if (!subjectUserId) {
        throw new Error('DESKTOP_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
      }
      return subjectUserId;
    },
    withScopes: deps.withScopes,
    disabledProviderReasonCode: DESKTOP_USER_DISABLED_PROVIDER_REASON,
  });

  return {
    loadSnapshot: surface.loadSnapshot,
    loadReplayTrace: surface.loadReplayTrace,
    upsertProviderProfile: surface.upsertProviderProfile,
    setProviderEnabled: surface.setProviderEnabled,
    submitApprovalDecision: surface.submitApprovalDecision,
  };
}
