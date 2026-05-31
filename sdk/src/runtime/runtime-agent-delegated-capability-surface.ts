import {
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedProviderProfile,
  type DelegatedReplayTrace,
  type SubmitDelegatedApprovalDecisionResponse,
} from './generated/runtime/v1/delegated_control.js';
import { buildRuntimeAgentRequestContext } from './local-agent-identity.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import type { RuntimeCallOptions, RuntimeTransportConfig } from './types.js';
import type {
  RuntimeAgentClient,
  RuntimeAppAuthClient,
  RuntimeAuthClient,
} from './types-client-interfaces.js';

type Awaitable<T> = T | Promise<T>;

const READ_SCOPE = 'runtime.agent.delegation.read';
const WRITE_SCOPE = 'runtime.agent.delegation.write';
const USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_user';

export type RuntimeAgentDelegatedProviderProfileDraft = {
  agentId: string;
  providerProfileId: string;
  displayName: string;
  transportRef: string;
  credentialRef: string;
  command: string;
  args: string;
  toolName: string;
  inputSchemaDigest: string;
};

export type RuntimeAgentDelegatedControlSurfaceQuery = {
  agentId: string;
  conversationAnchorId?: string;
};

export type RuntimeAgentDelegatedCapabilitySurface = {
  loadSnapshot(query: RuntimeAgentDelegatedControlSurfaceQuery): Promise<DelegatedControlSurfaceSnapshot | undefined>;
  loadReplayTrace(
    agentId: string,
    decisionId: string,
    conversationAnchorId?: string,
    turnId?: string,
  ): Promise<DelegatedReplayTrace | undefined>;
  upsertProviderProfile(
    draft: RuntimeAgentDelegatedProviderProfileDraft,
  ): Promise<DelegatedProviderProfile | undefined>;
  setProviderEnabled(
    agentId: string,
    providerProfileId: string,
    enabled: boolean,
  ): Promise<DelegatedProviderProfile | undefined>;
  submitApprovalDecision(
    agentId: string,
    approvalRequestId: string,
    decision: 'approve' | 'reject',
    decisionReason?: string,
  ): Promise<SubmitDelegatedApprovalDecisionResponse>;
};

export type HostRuntimeAgentDelegatedCapabilityClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly agent: Pick<
    RuntimeAgentClient,
    | 'getDelegatedControlSurfaceSnapshot'
    | 'upsertDelegatedProviderProfile'
    | 'setDelegatedProviderState'
    | 'submitDelegatedApprovalDecision'
    | 'getDelegatedReplayTrace'
  >;
};

export type HostRuntimeAgentDelegatedCapabilitySurfaceOptions = {
  getRuntime: () => HostRuntimeAgentDelegatedCapabilityClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
  withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ) => Promise<T>;
  disabledProviderReasonCode?: string;
};

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

export function buildRuntimeAgentDelegatedProviderProfileFromDraft(
  draft: RuntimeAgentDelegatedProviderProfileDraft,
): DelegatedProviderProfile {
  const providerProfileId = requireText(draft.providerProfileId, 'provider_profile_id');
  const transportRef = requireText(draft.transportRef, 'transport_ref');
  const command = requireText(draft.command, 'command');
  const toolName = requireText(draft.toolName, 'tool_name');
  return {
    providerProfileId,
    displayName: normalizeText(draft.displayName) || providerProfileId,
    providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
    transportKind: DelegatedTransportKind.STDIO_COMMAND,
    state: DelegatedProviderState.READY,
    allowedTools: [{
      toolName,
      inputSchemaDigest: normalizeText(draft.inputSchemaDigest),
    }],
    credentialRef: normalizeText(draft.credentialRef),
    transportRef,
    trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
    lifecycleReasonCode: '',
    command,
    args: normalizeText(draft.args).split(/\s+/).filter(Boolean),
  };
}

export function createHostRuntimeAgentDelegatedCapabilitySurface(
  options: HostRuntimeAgentDelegatedCapabilitySurfaceOptions,
): RuntimeAgentDelegatedCapabilitySurface {
  let protectedScopes: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await options.getSubjectUserId());
    if (!subjectUserId) {
      throw new Error('RUNTIME_AGENT_DELEGATED_CAPABILITY_SUBJECT_REQUIRED');
    }
    return subjectUserId;
  };

  const getProtectedScopes = () => {
    if (protectedScopes) {
      return protectedScopes;
    }
    protectedScopes = createRuntimeProtectedScopeHelper({
      runtime: options.getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedScopes;
  };

  const withDelegatedScopes = <T>(
    scopes: readonly string[],
    operation: (callOptions: RuntimeCallOptions) => Promise<T>,
  ) => (
    options.withScopes
      ? options.withScopes(scopes, operation)
      : getProtectedScopes().withScopes(scopes, operation)
  );

  const buildContext = async (agentIdInput: string) => {
    const runtime = options.getRuntime();
    const agentId = requireText(agentIdInput, 'agent_id');
    return {
      runtime,
      agentId,
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: await resolveSubjectUserId(),
        localAgentRef: agentId,
      }),
    };
  };

  return {
    async loadSnapshot(query) {
      const { runtime, agentId, context } = await buildContext(query.agentId);
      const response = await withDelegatedScopes([READ_SCOPE], (callOptions) => (
        runtime.agent.getDelegatedControlSurfaceSnapshot({
          context,
          agentId,
          conversationAnchorId: normalizeText(query.conversationAnchorId),
        }, callOptions)
      ));
      return response.snapshot;
    },

    async upsertProviderProfile(draft) {
      const { runtime, agentId, context } = await buildContext(draft.agentId);
      const response = await withDelegatedScopes([WRITE_SCOPE], (callOptions) => (
        runtime.agent.upsertDelegatedProviderProfile({
          context,
          agentId,
          providerProfile: buildRuntimeAgentDelegatedProviderProfileFromDraft(draft),
        }, callOptions)
      ));
      return response.providerProfile;
    },

    async setProviderEnabled(agentIdInput, providerProfileIdInput, enabled) {
      const providerProfileId = requireText(providerProfileIdInput, 'provider_profile_id');
      const { runtime, agentId, context } = await buildContext(agentIdInput);
      const response = await withDelegatedScopes([WRITE_SCOPE], (callOptions) => (
        runtime.agent.setDelegatedProviderState({
          context,
          agentId,
          providerProfileId,
          state: enabled ? DelegatedProviderState.READY : DelegatedProviderState.DISABLED,
          lifecycleReasonCode: enabled
            ? ''
            : normalizeText(options.disabledProviderReasonCode) || USER_DISABLED_PROVIDER_REASON,
        }, callOptions)
      ));
      return response.providerProfile;
    },

    async submitApprovalDecision(agentIdInput, approvalRequestIdInput, decision, decisionReason = '') {
      const approvalRequestId = requireText(approvalRequestIdInput, 'approval_request_id');
      const { runtime, agentId, context } = await buildContext(agentIdInput);
      return withDelegatedScopes([WRITE_SCOPE], (callOptions) => runtime.agent.submitDelegatedApprovalDecision({
        context,
        agentId,
        approvalRequestId,
        decision: decision === 'approve'
          ? DelegatedApprovalDecision.APPROVE
          : DelegatedApprovalDecision.REJECT,
        decisionReason: normalizeText(decisionReason),
      }, callOptions));
    },

    async loadReplayTrace(agentIdInput, decisionIdInput, conversationAnchorIdInput = '', turnIdInput = '') {
      const decisionId = requireText(decisionIdInput, 'decision_id');
      const { runtime, agentId, context } = await buildContext(agentIdInput);
      const response = await withDelegatedScopes([READ_SCOPE], (callOptions) => (
        runtime.agent.getDelegatedReplayTrace({
          context,
          agentId,
          decisionId,
          conversationAnchorId: normalizeText(conversationAnchorIdInput),
          turnId: normalizeText(turnIdInput),
        }, callOptions)
      ));
      return response.trace;
    },
  };
}
