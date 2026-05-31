import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createHostRuntimeAgentDelegatedCapabilitySurface,
  type HostRuntimeAgentDelegatedCapabilitySurfaceOptions,
  type RuntimeAgentDelegatedControlSurfaceQuery,
  type RuntimeAgentDelegatedProviderProfileDraft,
} from '@nimiplatform/sdk/runtime';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type DelegatedCapabilityServiceDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: HostRuntimeAgentDelegatedCapabilitySurfaceOptions['getSubjectUserId'];
};

export type DelegatedProviderProfileDraft = RuntimeAgentDelegatedProviderProfileDraft;
export type DelegatedControlSurfaceQuery = RuntimeAgentDelegatedControlSurfaceQuery;

const DESKTOP_USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_desktop_user';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDesktopDelegatedCapabilityService(deps: DelegatedCapabilityServiceDeps = {}) {
  const surface = createHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: deps.getRuntime ?? (() => getPlatformClient().runtime),
    getSubjectUserId: async () => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('DESKTOP_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
    }
    return subjectUserId;
    },
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
