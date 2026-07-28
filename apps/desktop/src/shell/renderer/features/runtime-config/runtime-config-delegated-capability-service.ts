import {
  createNimiHostRuntimeAgentDelegatedControlSurface,
  type NimiHostRuntimeAgentDelegatedControlClient,
  type NimiHostRuntimeAgentDelegatedControlSurfaceOptions,
  type NimiRuntimeAgentDelegatedControlSurfaceQuery,
} from '@nimiplatform/sdk/runtime';
type DelegatedCapabilityServiceDeps = {
  getRuntime: () => NimiHostRuntimeAgentDelegatedControlClient;
  getSubjectUserId: NimiHostRuntimeAgentDelegatedControlSurfaceOptions['getSubjectUserId'];
  withScopes: NonNullable<NimiHostRuntimeAgentDelegatedControlSurfaceOptions['withScopes']>;
};

export type DelegatedControlSurfaceQuery = NimiRuntimeAgentDelegatedControlSurfaceQuery;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDesktopDelegatedControlService(deps: DelegatedCapabilityServiceDeps) {
  const surface = createNimiHostRuntimeAgentDelegatedControlSurface({
    getRuntime: deps.getRuntime,
    getSubjectUserId: async () => {
      const subjectUserId = normalizeText(await deps.getSubjectUserId());
      if (!subjectUserId) {
        throw new Error('DESKTOP_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
      }
      return subjectUserId;
    },
    withScopes: deps.withScopes,
  });

  return {
    loadSnapshot: surface.loadSnapshot,
    loadReplayTrace: surface.loadReplayTrace,
    submitApprovalDecision: surface.submitApprovalDecision,
  };
}
