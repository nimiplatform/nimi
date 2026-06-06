import {
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedProviderProfile,
  type DelegatedReplayTrace,
  type ExecuteDelegatedCapabilityRequest,
  type ExecuteDelegatedCapabilityResponse,
  type GetDelegatedControlSurfaceSnapshotRequest,
  type GetDelegatedControlSurfaceSnapshotResponse,
  type GetDelegatedReplayTraceRequest,
  type GetDelegatedReplayTraceResponse,
  type RuntimeTypedCallOptions,
  type SetDelegatedProviderStateRequest,
  type SetDelegatedProviderStateResponse,
  type SubmitDelegatedApprovalDecisionRequest,
  type SubmitDelegatedApprovalDecisionResponse,
  type UpsertDelegatedProviderProfileRequest,
  type UpsertDelegatedProviderProfileResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { buildRuntimeAgentRequestContext } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

const READ_SCOPE = 'runtime.agent.delegation.read';
const WRITE_SCOPE = 'runtime.agent.delegation.write';
const USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_user';

export interface NimiRuntimeAgentDelegatedProviderProfileDraft {
  readonly agentId: string;
  readonly providerProfileId: string;
  readonly displayName: string;
  readonly transportRef: string;
  readonly credentialRef: string;
  readonly command: string;
  readonly args: string;
  readonly toolName: string;
  readonly inputSchemaDigest: string;
}

export interface NimiRuntimeAgentDelegatedControlSurfaceQuery {
  readonly agentId: string;
  readonly conversationAnchorId?: string;
}

export interface NimiRuntimeAgentDelegatedCapabilitySurface {
  loadSnapshot(query: NimiRuntimeAgentDelegatedControlSurfaceQuery): Promise<DelegatedControlSurfaceSnapshot | undefined>;
  loadReplayTrace(
    agentId: string,
    decisionId: string,
    conversationAnchorId?: string,
    turnId?: string,
  ): Promise<DelegatedReplayTrace | undefined>;
  upsertProviderProfile(
    draft: NimiRuntimeAgentDelegatedProviderProfileDraft,
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
}

export interface NimiHostRuntimeAgentDelegatedCapabilityClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    executeDelegatedCapability?(
      request: ExecuteDelegatedCapabilityRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ExecuteDelegatedCapabilityResponse>;
    getDelegatedControlSurfaceSnapshot(
      request: GetDelegatedControlSurfaceSnapshotRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetDelegatedControlSurfaceSnapshotResponse>;
    upsertDelegatedProviderProfile(
      request: UpsertDelegatedProviderProfileRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<UpsertDelegatedProviderProfileResponse>;
    setDelegatedProviderState(
      request: SetDelegatedProviderStateRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SetDelegatedProviderStateResponse>;
    submitDelegatedApprovalDecision(
      request: SubmitDelegatedApprovalDecisionRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SubmitDelegatedApprovalDecisionResponse>;
    getDelegatedReplayTrace(
      request: GetDelegatedReplayTraceRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetDelegatedReplayTraceResponse>;
  };
}

export interface NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentDelegatedCapabilityClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
  readonly disabledProviderReasonCode?: string;
}

function delegatedError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    delegatedError(`Runtime Agent delegated capability requires ${field}.`, 'SDK_RUNTIME_AGENT_DELEGATED_INPUT_INVALID', `provide_${field}`);
  }
  return normalized;
}

export function buildNimiRuntimeAgentDelegatedProviderProfileFromDraft(
  draft: NimiRuntimeAgentDelegatedProviderProfileDraft,
): DelegatedProviderProfile {
  const providerProfileId = requireText(draft.providerProfileId, 'provider_profile_id');
  const transportRef = requireText(draft.transportRef, 'transport_ref');
  const command = requireText(draft.command, 'command');
  const toolName = requireText(draft.toolName, 'tool_name');
  return {
    providerProfileId,
    displayName: normalizeNimiRuntimeAgentText(draft.displayName) || providerProfileId,
    providerKind: DelegatedProviderKind.MCP_TOOL_PROVIDER,
    transportKind: DelegatedTransportKind.STDIO_COMMAND,
    state: DelegatedProviderState.READY,
    allowedTools: [{
      toolName,
      inputSchemaDigest: normalizeNimiRuntimeAgentText(draft.inputSchemaDigest),
    }],
    credentialRef: normalizeNimiRuntimeAgentText(draft.credentialRef),
    transportRef,
    trustTier: DelegatedProviderTrustTier.USER_ADDED_REVIEWED,
    lifecycleReasonCode: '',
    command,
    args: normalizeNimiRuntimeAgentText(draft.args).split(/\s+/).filter(Boolean),
  };
}

export function createNimiHostRuntimeAgentDelegatedCapabilitySurface(
  options: NimiHostRuntimeAgentDelegatedCapabilitySurfaceOptions,
): NimiRuntimeAgentDelegatedCapabilitySurface {
  async function buildContext(agentIdInput: string) {
    const runtime = options.getRuntime();
    const agentId = requireText(agentIdInput, 'agent_id');
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent delegated capability requires authenticated subject user id.',
    );
    return {
      runtime,
      subjectUserId,
      agentId,
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId,
        localAgentRef: agentId,
      }),
    };
  }

  return {
    async loadSnapshot(query) {
      const { runtime, subjectUserId, agentId, context } = await buildContext(query.agentId);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [READ_SCOPE], (callOptions) => runtime.agent.getDelegatedControlSurfaceSnapshot({
        context,
        agentId,
        conversationAnchorId: normalizeNimiRuntimeAgentText(query.conversationAnchorId),
      }, callOptions));
      return response.snapshot;
    },
    async upsertProviderProfile(draft) {
      const { runtime, subjectUserId, agentId, context } = await buildContext(draft.agentId);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => runtime.agent.upsertDelegatedProviderProfile({
        context,
        agentId,
        providerProfile: buildNimiRuntimeAgentDelegatedProviderProfileFromDraft(draft),
      }, callOptions));
      return response.providerProfile;
    },
    async setProviderEnabled(agentIdInput, providerProfileIdInput, enabled) {
      const providerProfileId = requireText(providerProfileIdInput, 'provider_profile_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(agentIdInput);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => runtime.agent.setDelegatedProviderState({
        context,
        agentId,
        providerProfileId,
        state: enabled ? DelegatedProviderState.READY : DelegatedProviderState.DISABLED,
        lifecycleReasonCode: enabled
          ? ''
          : normalizeNimiRuntimeAgentText(options.disabledProviderReasonCode) || USER_DISABLED_PROVIDER_REASON,
      }, callOptions));
      return response.providerProfile;
    },
    async submitApprovalDecision(agentIdInput, approvalRequestIdInput, decision, decisionReason = '') {
      const approvalRequestId = requireText(approvalRequestIdInput, 'approval_request_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(agentIdInput);
      return withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => runtime.agent.submitDelegatedApprovalDecision({
        context,
        agentId,
        approvalRequestId,
        decision: decision === 'approve'
          ? DelegatedApprovalDecision.APPROVE
          : DelegatedApprovalDecision.REJECT,
        decisionReason: normalizeNimiRuntimeAgentText(decisionReason),
      }, callOptions));
    },
    async loadReplayTrace(agentIdInput, decisionIdInput, conversationAnchorIdInput = '', turnIdInput = '') {
      const decisionId = requireText(decisionIdInput, 'decision_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(agentIdInput);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [READ_SCOPE], (callOptions) => runtime.agent.getDelegatedReplayTrace({
        context,
        agentId,
        decisionId,
        conversationAnchorId: normalizeNimiRuntimeAgentText(conversationAnchorIdInput),
        turnId: normalizeNimiRuntimeAgentText(turnIdInput),
      }, callOptions));
      return response.trace;
    },
  };
}
