import { createNimiHostRuntimeAgentDelegatedCapabilitySurface } from '@nimiplatform/sdk/runtime';
import { DelegatedApprovalMode, DelegatedProviderKind, DelegatedProviderState, DelegatedProviderTrustTier, DelegatedReplayOutcome, DelegatedTransportKind, EffectClass } from '@nimiplatform/sdk/runtime/generated';

export async function inspectTesterRuntimeAgentDelegatedCapabilitySurface(): Promise<{
  snapshotAgentId: string;
  profileState: number;
  replayOutcome: number;
}> {
  const surface = createNimiHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({ tokenId: 'tester-token', secret: 'tester-secret' }),
      },
      agent: {
        getDelegatedControlSurfaceSnapshot: async (request: { agentId: string }) => ({
          snapshot: {
            agentId: request.agentId,
            conversationAnchorId: 'tester-anchor',
            approvalMode: DelegatedApprovalMode.REQUIRE_USER,
            providerProfiles: [],
            approvalRequests: [],
            diagnostics: [],
          },
        }),
        upsertDelegatedProviderProfile: async (request: { providerProfile?: { providerProfileId: string } }) => ({
          providerProfile: {
            providerProfileId: request.providerProfile?.providerProfileId ?? 'tester-profile',
            displayName: 'Tester Profile',
            providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
            transportKind: DelegatedTransportKind.STDIO_COMMAND,
            state: DelegatedProviderState.READY,
            allowedTools: [],
            credentialRef: '',
            transportRef: 'stdio://tester',
            trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
            lifecycleReasonCode: '',
            command: 'tester-tool',
            args: [],
          },
        }),
        setDelegatedProviderState: async () => ({ providerProfile: undefined }),
        submitDelegatedApprovalDecision: async () => ({ approvalRequest: undefined }),
        getDelegatedReplayTrace: async (request: { agentId: string }) => ({
          trace: {
            replayId: 'tester-replay',
            agentId: request.agentId,
            conversationAnchorId: 'tester-anchor',
            turnId: 'tester-turn',
            providerProfileId: 'tester-profile',
            capabilityId: 'tester-capability',
            toolName: 'tester-tool',
            outcome: DelegatedReplayOutcome.RECONSTRUCTED,
            reasonCode: '',
            stages: [],
            projectionDisposition: 'projected',
            actionDisposition: 'allowed',
            redacted: false,
          },
        }),
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
  });
  const snapshot = await surface.loadSnapshot({ agentId: 'local-agent:tester-user:tester-agent' });
  const profile = await surface.upsertProviderProfile({
    agentId: 'local-agent:tester-user:tester-agent',
    providerProfileId: 'tester-profile',
    displayName: 'Tester Profile',
    transportRef: 'stdio://tester',
    credentialRef: '',
    command: 'tester-tool',
    args: '',
    toolName: 'tester-tool',
    inputSchemaDigest: '',
    effectClass: EffectClass.READ_ONLY,
  });
  const replay = await surface.loadReplayTrace('local-agent:tester-user:tester-agent', 'tester-decision');
  return {
    snapshotAgentId: snapshot?.agentId ?? '',
    profileState: profile?.state ?? 0,
    replayOutcome: replay?.outcome ?? 0,
  };
}
