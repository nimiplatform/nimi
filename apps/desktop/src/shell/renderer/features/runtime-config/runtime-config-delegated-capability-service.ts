import {
  createNimiHostRuntimeAgentDelegatedCapabilitySurface,
  type NimiHostRuntimeAgentDelegatedCapabilityClient,
  type NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions,
  type NimiRuntimeAgentDelegatedControlSurfaceQuery,
  type NimiRuntimeAgentDelegatedProviderProfileDraft,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopHostRuntimeAgentClient,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

type DelegatedCapabilityServiceDeps = {
  getRuntime?: () => NimiHostRuntimeAgentDelegatedCapabilityClient;
  getSubjectUserId?: NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions['getSubjectUserId'];
};

export type DelegatedProviderProfileDraft = NimiRuntimeAgentDelegatedProviderProfileDraft;
export type DelegatedControlSurfaceQuery = NimiRuntimeAgentDelegatedControlSurfaceQuery;

const DESKTOP_USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_desktop_user';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDesktopDelegatedCapabilityService(deps: DelegatedCapabilityServiceDeps = {}) {
  const surface = createNimiHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: deps.getRuntime ?? getDesktopHostRuntimeAgentClient,
    getSubjectUserId: async () => {
      const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
      if (!subjectUserId) {
        throw new Error('DESKTOP_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
      }
      return subjectUserId;
    },
    ...(deps.getRuntime ? {} : { withScopes: withDesktopRuntimeProtectedScopes }),
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
