import {
  DelegatedApprovalDecision,
  DelegatedApprovalRequestState,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  SensitivityClass,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedProviderProfile,
  type DelegatedReplayTrace,
  type ExecuteDelegatedCapabilityRequest,
  type ExecuteDelegatedCapabilityResponse,
  type GetDelegatedControlSurfaceSnapshotRequest,
  type GetDelegatedControlSurfaceSnapshotResponse,
  type GetDelegatedReplayTraceRequest,
  type GetDelegatedReplayTraceResponse,
  type ResumeDelegatedCapabilityRequest,
  type ResumeDelegatedCapabilityResponse,
  type RuntimeTypedCallOptions,
  type SetDelegatedProviderStateRequest,
  type SetDelegatedProviderStateResponse,
  type SubmitDelegatedApprovalDecisionRequest,
  type SubmitDelegatedApprovalDecisionResponse,
  type UpsertDelegatedProviderProfileRequest,
  type UpsertDelegatedProviderProfileResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { buildRuntimeAgentRequestContext, projectRuntimeLocalAgentIdentity, type RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { fromNimiRuntimeProtoStruct, normalizeNimiRuntimeAgentText, toNimiRuntimeProtoStruct } from './runtime-agent-values';
import type { NimiJsonObject } from '../core/contracts';

const READ_SCOPE = 'runtime.agent.delegation.read';
const WRITE_SCOPE = 'runtime.agent.delegation.write';
const USER_DISABLED_PROVIDER_REASON = 'provider_disabled_by_user';

export interface NimiRuntimeAgentDelegatedProviderProfileDraft extends RuntimeLocalAgentIdentityInput {
  readonly providerProfileId: string;
  readonly displayName: string;
  readonly transportRef: string;
  readonly credentialRef: string;
  readonly command: string;
  readonly args: string;
  readonly toolName: string;
  readonly inputSchemaDigest: string;
  // K-DELEG-006 capability descriptor: effect_class is required; an undeclared
  // effect fails closed at Runtime upsert rather than passing as UNSPECIFIED.
  readonly effectClass: EffectClass;
  // K-DELEG-068 expected output sensitivity (optional; UNSPECIFIED derives
  // conservatively as UNKNOWN_SENSITIVE for approval-requirement purposes).
  readonly expectedSensitivityClass?: SensitivityClass;
}

export interface NimiRuntimeAgentDelegatedControlSurfaceQuery extends RuntimeLocalAgentIdentityInput {
  readonly conversationAnchorId?: string;
}

export interface NimiRuntimeAgentDelegatedCapabilityExecutionInput extends RuntimeLocalAgentIdentityInput {
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId?: string;
  readonly requestId?: string;
  readonly providerProfileId: string;
  readonly capabilityId: string;
  readonly toolName: string;
  readonly arguments?: NimiJsonObject;
  readonly descriptorHash: string;
  readonly protocolRevision?: string;
  readonly outputKind?: string;
  readonly requiresApproval?: boolean;
}

export interface NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection {
  readonly diagnosticId?: string;
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly turnId?: string;
  readonly providerProfileId?: string;
  readonly capabilityId?: string;
  readonly toolName?: string;
  readonly gatewayEvidenceId?: string;
  readonly firewallInputId?: string;
  readonly firewallVerdict?: string;
  readonly runtimeDecision?: string;
  readonly reasonCode?: string;
}

export interface NimiRuntimeAgentDelegatedApprovalRequestProjection {
  readonly approvalRequestId: string;
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly turnId?: string;
  readonly providerProfileId?: string;
  readonly capabilityId?: string;
  readonly toolName?: string;
  readonly firewallVerdict?: string;
  readonly reasonCode?: string;
  readonly state?: string;
  readonly delegationRequestId?: string;
  readonly effectClass?: string;
  readonly sensitivityClass?: string;
  readonly summaryRef?: string;
  readonly policySnapshotId?: string;
}

export interface NimiRuntimeAgentDelegatedCapabilityResult {
  readonly diagnostic?: NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection;
  readonly approvalRequest?: NimiRuntimeAgentDelegatedApprovalRequestProjection;
  readonly output?: NimiJsonObject;
}

export interface NimiRuntimeAgentDelegatedCapabilitySurface {
  loadSnapshot(query: NimiRuntimeAgentDelegatedControlSurfaceQuery): Promise<DelegatedControlSurfaceSnapshot | undefined>;
  loadReplayTrace(input: RuntimeLocalAgentIdentityInput & {
    readonly decisionId: string;
    readonly conversationAnchorId?: string;
    readonly turnId?: string;
  }): Promise<DelegatedReplayTrace | undefined>;
  upsertProviderProfile(
    draft: NimiRuntimeAgentDelegatedProviderProfileDraft,
  ): Promise<DelegatedProviderProfile | undefined>;
  setProviderEnabled(input: RuntimeLocalAgentIdentityInput & {
    readonly providerProfileId: string;
    readonly enabled: boolean;
  }): Promise<DelegatedProviderProfile | undefined>;
  submitApprovalDecision(input: RuntimeLocalAgentIdentityInput & {
    readonly approvalRequestId: string;
    readonly decision: 'approve' | 'reject';
    readonly decisionReason?: string;
  }): Promise<SubmitDelegatedApprovalDecisionResponse>;
  executeCapability(
    input: NimiRuntimeAgentDelegatedCapabilityExecutionInput,
  ): Promise<NimiRuntimeAgentDelegatedCapabilityResult>;
  resumeApprovedCapability(input: RuntimeLocalAgentIdentityInput & {
    readonly approvalRequestId: string;
  }): Promise<NimiRuntimeAgentDelegatedCapabilityResult>;
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
    resumeDelegatedCapability?(
      request: ResumeDelegatedCapabilityRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ResumeDelegatedCapabilityResponse>;
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

function projectNimiRuntimeAgentDelegatedCapabilityResult(
  response: ExecuteDelegatedCapabilityResponse | ResumeDelegatedCapabilityResponse,
): NimiRuntimeAgentDelegatedCapabilityResult {
  return {
    diagnostic: projectNimiRuntimeAgentDelegatedDiagnostic(response.diagnostic),
    approvalRequest: projectNimiRuntimeAgentDelegatedApprovalRequest(response.approvalRequest),
    output: response.modelOutput
      ? fromNimiRuntimeProtoStruct(response.modelOutput) as NimiJsonObject
      : undefined,
  };
}

function projectNimiRuntimeAgentDelegatedDiagnostic(
  diagnostic: ExecuteDelegatedCapabilityResponse['diagnostic'],
): NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection | undefined {
  if (!diagnostic) {
    return undefined;
  }
  return {
    diagnosticId: normalizeNimiRuntimeAgentText(diagnostic.diagnosticId) || undefined,
    agentId: normalizeNimiRuntimeAgentText(diagnostic.agentId) || undefined,
    conversationAnchorId: normalizeNimiRuntimeAgentText(diagnostic.conversationAnchorId) || undefined,
    turnId: normalizeNimiRuntimeAgentText(diagnostic.turnId) || undefined,
    providerProfileId: normalizeNimiRuntimeAgentText(diagnostic.providerProfileId) || undefined,
    capabilityId: normalizeNimiRuntimeAgentText(diagnostic.capabilityId) || undefined,
    toolName: normalizeNimiRuntimeAgentText(diagnostic.toolName) || undefined,
    gatewayEvidenceId: normalizeNimiRuntimeAgentText(diagnostic.gatewayEvidenceId) || undefined,
    firewallInputId: normalizeNimiRuntimeAgentText(diagnostic.firewallInputId) || undefined,
    firewallVerdict: normalizeNimiRuntimeAgentText(diagnostic.firewallVerdict) || undefined,
    runtimeDecision: normalizeNimiRuntimeAgentText(diagnostic.runtimeDecision) || undefined,
    reasonCode: normalizeNimiRuntimeAgentText(diagnostic.reasonCode) || undefined,
  };
}

function projectNimiRuntimeAgentDelegatedApprovalRequest(
  approvalRequest: ExecuteDelegatedCapabilityResponse['approvalRequest'],
): NimiRuntimeAgentDelegatedApprovalRequestProjection | undefined {
  const approvalRequestId = normalizeNimiRuntimeAgentText(approvalRequest?.approvalRequestId);
  if (!approvalRequest || !approvalRequestId) {
    return undefined;
  }
  return {
    approvalRequestId,
    agentId: normalizeNimiRuntimeAgentText(approvalRequest.agentId) || undefined,
    conversationAnchorId: normalizeNimiRuntimeAgentText(approvalRequest.conversationAnchorId) || undefined,
    turnId: normalizeNimiRuntimeAgentText(approvalRequest.turnId) || undefined,
    providerProfileId: normalizeNimiRuntimeAgentText(approvalRequest.providerProfileId) || undefined,
    capabilityId: normalizeNimiRuntimeAgentText(approvalRequest.capabilityId) || undefined,
    toolName: normalizeNimiRuntimeAgentText(approvalRequest.toolName) || undefined,
    firewallVerdict: normalizeNimiRuntimeAgentText(approvalRequest.firewallVerdict) || undefined,
    reasonCode: normalizeNimiRuntimeAgentText(approvalRequest.reasonCode) || undefined,
    state: enumProjectionLabel(DelegatedApprovalRequestState, approvalRequest.state),
    delegationRequestId: normalizeNimiRuntimeAgentText(approvalRequest.delegationRequestId) || undefined,
    effectClass: enumProjectionLabel(EffectClass, approvalRequest.effectClass),
    sensitivityClass: enumProjectionLabel(SensitivityClass, approvalRequest.sensitivityClass),
    summaryRef: normalizeNimiRuntimeAgentText(approvalRequest.summaryRef) || undefined,
    policySnapshotId: normalizeNimiRuntimeAgentText(approvalRequest.policySnapshotId) || undefined,
  };
}

function enumProjectionLabel(enumObject: Readonly<Record<string, string | number>>, value: unknown): string | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  const label = enumObject[value];
  return typeof label === 'string' ? label.toLowerCase() : undefined;
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

function requireRuntimeMethod<T extends (...args: never[]) => unknown>(
  method: T | undefined,
  methodName: string,
): T {
  if (!method) {
    delegatedError(
      `Runtime Agent delegated capability requires ${methodName}.`,
      'SDK_RUNTIME_AGENT_DELEGATED_RUNTIME_METHOD_UNAVAILABLE',
      `enable_${methodName}`,
    );
  }
  return method;
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
      effectClass: draft.effectClass ?? EffectClass.UNSPECIFIED,
      expectedSensitivityClass: draft.expectedSensitivityClass ?? SensitivityClass.UNSPECIFIED,
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
  async function buildContext(identityInput: RuntimeLocalAgentIdentityInput) {
    const runtime = options.getRuntime();
    const identity = projectRuntimeLocalAgentIdentity(identityInput);
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent delegated capability requires authenticated subject user id.',
    );
    return {
      runtime,
      subjectUserId,
      agentId: identity.localAgentRef,
      context: buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId,
        ...identity,
      }),
    };
  }

  return {
    async loadSnapshot(query) {
      const { runtime, subjectUserId, agentId, context } = await buildContext(query);
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
      const { runtime, subjectUserId, agentId, context } = await buildContext(draft);
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
    async setProviderEnabled(input) {
      const providerProfileId = requireText(input.providerProfileId, 'provider_profile_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(input);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => runtime.agent.setDelegatedProviderState({
        context,
        agentId,
        providerProfileId,
        state: input.enabled ? DelegatedProviderState.READY : DelegatedProviderState.DISABLED,
        lifecycleReasonCode: input.enabled
          ? ''
          : normalizeNimiRuntimeAgentText(options.disabledProviderReasonCode) || USER_DISABLED_PROVIDER_REASON,
      }, callOptions));
      return response.providerProfile;
    },
    async submitApprovalDecision(input) {
      const approvalRequestId = requireText(input.approvalRequestId, 'approval_request_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(input);
      return withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => runtime.agent.submitDelegatedApprovalDecision({
        context,
        agentId,
        approvalRequestId,
        decision: input.decision === 'approve'
          ? DelegatedApprovalDecision.APPROVED_ONCE
          : DelegatedApprovalDecision.REJECTED,
        decisionReason: normalizeNimiRuntimeAgentText(input.decisionReason),
      }, callOptions));
    },
    async executeCapability(input) {
      const conversationAnchorId = requireText(input.conversationAnchorId, 'conversation_anchor_id');
      const turnId = requireText(input.turnId, 'turn_id');
      const providerProfileId = requireText(input.providerProfileId, 'provider_profile_id');
      const capabilityId = requireText(input.capabilityId, 'capability_id');
      const toolName = requireText(input.toolName, 'tool_name');
      const descriptorHash = requireText(input.descriptorHash, 'descriptor_hash');
      const { runtime, subjectUserId, agentId, context } = await buildContext(input);
      const executeDelegatedCapability = requireRuntimeMethod(
        runtime.agent.executeDelegatedCapability,
        'executeDelegatedCapability',
      );
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => executeDelegatedCapability({
        context,
        agentId,
        conversationAnchorId,
        turnId,
        streamId: normalizeNimiRuntimeAgentText(input.streamId),
        requestId: normalizeNimiRuntimeAgentText(input.requestId),
        providerProfileId,
        capabilityId,
        toolName,
        arguments: input.arguments ? toNimiRuntimeProtoStruct(input.arguments) : undefined,
        descriptorHash,
        protocolRevision: normalizeNimiRuntimeAgentText(input.protocolRevision),
        outputKind: normalizeNimiRuntimeAgentText(input.outputKind),
        requiresApproval: input.requiresApproval === true,
      }, callOptions));
      return projectNimiRuntimeAgentDelegatedCapabilityResult(response);
    },
    async resumeApprovedCapability(input) {
      const approvalRequestId = requireText(input.approvalRequestId, 'approval_request_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(input);
      const resumeDelegatedCapability = requireRuntimeMethod(
        runtime.agent.resumeDelegatedCapability,
        'resumeDelegatedCapability',
      );
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [WRITE_SCOPE], (callOptions) => resumeDelegatedCapability({
        context,
        agentId,
        approvalRequestId,
      }, callOptions));
      return projectNimiRuntimeAgentDelegatedCapabilityResult(response);
    },
    async loadReplayTrace(input) {
      const decisionId = requireText(input.decisionId, 'decision_id');
      const { runtime, subjectUserId, agentId, context } = await buildContext(input);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [READ_SCOPE], (callOptions) => runtime.agent.getDelegatedReplayTrace({
        context,
        agentId,
        decisionId,
        conversationAnchorId: normalizeNimiRuntimeAgentText(input.conversationAnchorId),
        turnId: normalizeNimiRuntimeAgentText(input.turnId),
      }, callOptions));
      return response.trace;
    },
  };
}
