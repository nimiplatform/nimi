import {
  DelegatedApprovalDecision,
  type DelegatedControlSurfaceSnapshot,
  type DelegatedReplayTrace,
  type GetDelegatedControlSurfaceSnapshotRequest,
  type GetDelegatedControlSurfaceSnapshotResponse,
  type GetDelegatedReplayTraceRequest,
  type GetDelegatedReplayTraceResponse,
  type RuntimeTypedCallOptions,
  type SubmitDelegatedApprovalDecisionRequest,
  type SubmitDelegatedApprovalDecisionResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

const READ_SCOPE = 'runtime.agent.delegation.read';
const WRITE_SCOPE = 'runtime.agent.delegation.write';

export interface NimiRuntimeAgentDelegatedControlSurfaceQuery extends RuntimeLocalAgentIdentityInput {
  readonly conversationAnchorId?: string;
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

export interface NimiRuntimeAgentDelegatedControlSurface {
  loadSnapshot(query: NimiRuntimeAgentDelegatedControlSurfaceQuery): Promise<DelegatedControlSurfaceSnapshot | undefined>;
  loadReplayTrace(input: RuntimeLocalAgentIdentityInput & {
    readonly decisionId: string;
    readonly conversationAnchorId?: string;
    readonly turnId?: string;
  }): Promise<DelegatedReplayTrace | undefined>;
  submitApprovalDecision(input: RuntimeLocalAgentIdentityInput & {
    readonly approvalRequestId: string;
    readonly decision: 'approve' | 'reject';
    readonly decisionReason?: string;
  }): Promise<SubmitDelegatedApprovalDecisionResponse>;
}

export interface NimiHostRuntimeAgentDelegatedControlClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: {
    getDelegatedControlSurfaceSnapshot(
      request: GetDelegatedControlSurfaceSnapshotRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetDelegatedControlSurfaceSnapshotResponse>;
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

export interface NimiHostRuntimeAgentDelegatedControlSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentDelegatedControlClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function delegatedControlError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_DELEGATED_INPUT_INVALID',
    actionHint,
    source: 'sdk',
  });
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    delegatedControlError(`Runtime Agent delegated control requires ${field}.`, `provide_${field}`);
  }
  return normalized;
}

// @nimi-authority: definition.nimi.sdks.feature-clients.delegation-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r070
export function createNimiHostRuntimeAgentDelegatedControlSurface(
  options: NimiHostRuntimeAgentDelegatedControlSurfaceOptions,
): NimiRuntimeAgentDelegatedControlSurface {
  async function buildContext(identityInput: RuntimeLocalAgentIdentityInput) {
    const runtime = options.getRuntime();
    const identity = projectRuntimeLocalAgentIdentity(identityInput);
    const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent delegated control requires authenticated subject user id.',
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
