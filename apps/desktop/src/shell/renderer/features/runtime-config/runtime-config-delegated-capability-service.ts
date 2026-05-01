import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createRuntimeProtectedScopeHelper,
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedTransportKind,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedProviderProfile,
  type DelegatedReplayTrace,
} from '@nimiplatform/sdk/runtime';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type DelegatedCapabilityServiceDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

export type DelegatedProviderProfileDraft = {
  agentId: string;
  providerProfileId: string;
  displayName: string;
  transportRef: string;
  credentialRef: string;
  toolName: string;
  inputSchemaDigest: string;
};

export type DelegatedControlSurfaceQuery = {
  agentId: string;
  conversationAnchorId?: string;
};

const READ_SCOPE = 'runtime.agent.delegation.read';
const WRITE_SCOPE = 'runtime.agent.delegation.write';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field.toUpperCase()}_REQUIRED`);
  }
  return normalized;
}

export function createDesktopDelegatedCapabilityService(deps: DelegatedCapabilityServiceDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  let protectedScopes: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('DESKTOP_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
    }
    return subjectUserId;
  };

  const getProtectedScopes = () => {
    if (protectedScopes) return protectedScopes;
    protectedScopes = createRuntimeProtectedScopeHelper({
      runtime: getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedScopes;
  };

  const buildContext = async () => {
    const runtime = getRuntime();
    return {
      runtime,
      context: {
        appId: runtime.appId,
        subjectUserId: await resolveSubjectUserId(),
      },
    };
  };

  const loadSnapshot = async (query: DelegatedControlSurfaceQuery): Promise<DelegatedControlSurfaceSnapshot | undefined> => {
    const agentId = requireText(query.agentId, 'agent_id');
    const { runtime, context } = await buildContext();
    const response = await getProtectedScopes().withScopes([READ_SCOPE], (options) => runtime.agent.getDelegatedControlSurfaceSnapshot({
      context,
      agentId,
      conversationAnchorId: normalizeText(query.conversationAnchorId),
    }, options));
    return response.snapshot;
  };

  const upsertProviderProfile = async (draft: DelegatedProviderProfileDraft): Promise<DelegatedProviderProfile | undefined> => {
    const agentId = requireText(draft.agentId, 'agent_id');
    const providerProfileId = requireText(draft.providerProfileId, 'provider_profile_id');
    const transportRef = requireText(draft.transportRef, 'transport_ref');
    const toolName = requireText(draft.toolName, 'tool_name');
    const { runtime, context } = await buildContext();
    const response = await getProtectedScopes().withScopes([WRITE_SCOPE], (options) => runtime.agent.upsertDelegatedProviderProfile({
      context,
      agentId,
      providerProfile: {
        providerProfileId,
        displayName: normalizeText(draft.displayName) || providerProfileId,
        providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
        transportKind: DelegatedTransportKind.STDIO_COMMAND,
        state: DelegatedProviderState.ACTIVE,
        allowedTools: [{
          toolName,
          inputSchemaDigest: normalizeText(draft.inputSchemaDigest),
        }],
        credentialRef: normalizeText(draft.credentialRef),
        transportRef,
      },
    }, options));
    return response.providerProfile;
  };

  const setProviderEnabled = async (agentIdInput: string, providerProfileIdInput: string, enabled: boolean): Promise<DelegatedProviderProfile | undefined> => {
    const agentId = requireText(agentIdInput, 'agent_id');
    const providerProfileId = requireText(providerProfileIdInput, 'provider_profile_id');
    const { runtime, context } = await buildContext();
    const response = await getProtectedScopes().withScopes([WRITE_SCOPE], (options) => runtime.agent.setDelegatedProviderState({
      context,
      agentId,
      providerProfileId,
      state: enabled
        ? DelegatedProviderState.ACTIVE
        : DelegatedProviderState.DISABLED,
    }, options));
    return response.providerProfile;
  };

  const submitApprovalDecision = async (
    agentIdInput: string,
    approvalRequestIdInput: string,
    decision: 'approve' | 'reject',
    decisionReason = '',
  ) => {
    const agentId = requireText(agentIdInput, 'agent_id');
    const approvalRequestId = requireText(approvalRequestIdInput, 'approval_request_id');
    const { runtime, context } = await buildContext();
    return getProtectedScopes().withScopes([WRITE_SCOPE], (options) => runtime.agent.submitDelegatedApprovalDecision({
      context,
      agentId,
      approvalRequestId,
      decision: decision === 'approve'
        ? DelegatedApprovalDecision.APPROVE
        : DelegatedApprovalDecision.REJECT,
      decisionReason: normalizeText(decisionReason),
    }, options));
  };

  const loadReplayTrace = async (
    agentIdInput: string,
    decisionIdInput: string,
    conversationAnchorIdInput = '',
    turnIdInput = '',
  ): Promise<DelegatedReplayTrace | undefined> => {
    const agentId = requireText(agentIdInput, 'agent_id');
    const decisionId = requireText(decisionIdInput, 'decision_id');
    const { runtime, context } = await buildContext();
    const response = await getProtectedScopes().withScopes([READ_SCOPE], (options) => runtime.agent.getDelegatedReplayTrace({
      context,
      agentId,
      decisionId,
      conversationAnchorId: normalizeText(conversationAnchorIdInput),
      turnId: normalizeText(turnIdInput),
    }, options));
    return response.trace;
  };

  return {
    loadSnapshot,
    loadReplayTrace,
    upsertProviderProfile,
    setProviderEnabled,
    submitApprovalDecision,
  };
}
