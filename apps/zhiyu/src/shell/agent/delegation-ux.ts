import type {
  ZhiyuDelegationApprovalDecision,
  ZhiyuDelegationUxStatus,
} from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from './conversation-home';
import {
  conversationIdentity,
  delegationUnavailable,
  loadReplayTraceOrNull,
  normalizeDelegationError,
  outputFirewallFromDiagnostic,
  primaryDiagnostic,
  projectDelegationStatus,
  stateFromProjection,
  stringOr,
} from './delegation-ux-projection';
import {
  APP_ID,
  DELEGATION_READ_SCOPE,
  DELEGATION_WRITE_SCOPE,
  type DelegationControlSurface,
  type DelegationDiagnostic,
  type DelegationIdentity,
  type ZhiyuDelegationUxProbeOptions,
} from './delegation-ux-types';

export type {
  ZhiyuDelegationApprovedResumer,
  ZhiyuDelegationApprovalSubmitter,
  ZhiyuDelegationReplayLoader,
  ZhiyuDelegationSnapshotReader,
  ZhiyuDelegationUxProbeOptions,
} from './delegation-ux-types';

export async function probeZhiyuRuntimeDelegationUx(
  conversation: ZhiyuConversationHomeStatus,
  options: ZhiyuDelegationUxProbeOptions = {},
): Promise<ZhiyuDelegationUxStatus> {
  const identity = conversationIdentity(conversation);
  if (!identity) {
    return delegationUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: conversation.source,
      message: 'Zhiyu requires a Runtime-owned conversation anchor before rendering delegated approvals.',
      ownerUserId: conversation.ownerUserId,
      runtimeSourceRef: conversation.runtimeSourceRef,
      localAgentRef: conversation.localAgentRef,
      conversationAnchorId: conversation.conversationAnchorId,
      observedAt: options.observedAt,
    });
  }

  try {
    const surface = await resolveDelegationSurface(options, 'read', identity);
    const snapshot = await surface.loadSnapshot(identity);
    const diagnostic = primaryDiagnostic(snapshot);
    const replayTrace = diagnostic?.diagnosticId
      ? await loadReplayTraceOrNull(surface, identity, diagnostic)
      : null;
    return projectDelegationStatus({
      identity,
      snapshot,
      replayTrace,
      observedAt: options.observedAt,
    });
  } catch (error) {
    return normalizeDelegationError(error, identity, options.observedAt);
  }
}

export async function submitZhiyuRuntimeDelegationApproval(
  input: {
    readonly conversation: ZhiyuConversationHomeStatus;
    readonly approvalRequestId: string;
    readonly decision: ZhiyuDelegationApprovalDecision;
  },
  options: ZhiyuDelegationUxProbeOptions = {},
): Promise<ZhiyuDelegationUxStatus> {
  const identity = conversationIdentity(input.conversation);
  const approvalRequestId = stringOr(input.approvalRequestId, '');
  if (!identity || !approvalRequestId) {
    return delegationUnavailable({
      reasonCode: identity ? 'zhiyu-delegation-approval-request-required' : 'zhiyu-conversation-anchor-required',
      actionHint: identity ? 'select_runtime_delegation_approval' : 'open_runtime_conversation_anchor',
      source: input.conversation.source,
      message: identity
        ? 'Zhiyu requires a Runtime approval request id before submitting a delegated decision.'
        : 'Zhiyu requires a Runtime-owned conversation anchor before submitting delegated approval.',
      ownerUserId: input.conversation.ownerUserId,
      runtimeSourceRef: input.conversation.runtimeSourceRef,
      localAgentRef: input.conversation.localAgentRef,
      conversationAnchorId: input.conversation.conversationAnchorId,
      observedAt: options.observedAt,
      lastDecision: {
        state: 'failed',
        approvalRequestId: approvalRequestId || null,
        reasonCode: 'zhiyu-delegation-approval-input-invalid',
        message: 'Delegated approval input is incomplete.',
      },
    });
  }

  try {
    const surface = await resolveDelegationSurface(options, 'write', identity);
    await surface.submitApprovalDecision({
      ...identity,
      approvalRequestId,
      decision: input.decision,
      decisionReason: 'zhiyu_delegation_review',
    });
    let resumedDiagnostic: DelegationDiagnostic | null = null;
    if (input.decision === 'approve') {
      const resumed = await surface.resumeApprovedCapability({
        ...identity,
        approvalRequestId,
      });
      resumedDiagnostic = resumed?.diagnostic ?? null;
    }
    const status = await probeZhiyuRuntimeDelegationUx(input.conversation, options);
    return {
      ...status,
      ...(resumedDiagnostic && status.outputFirewall.state === 'not_projected'
        ? {
          outputFirewall: outputFirewallFromDiagnostic(resumedDiagnostic),
          state: stateFromProjection(
            status.candidateIntent,
            outputFirewallFromDiagnostic(resumedDiagnostic),
            status.diagnosticCount,
            status.providerCount,
          ),
        }
        : {}),
      lastDecision: {
        state: input.decision === 'approve' ? 'approved' : 'denied',
        approvalRequestId,
        reasonCode: input.decision === 'approve'
          ? 'runtime-delegation-approval-approved'
          : 'runtime-delegation-approval-denied',
        message: input.decision === 'approve'
          ? 'Runtime accepted the delegated approval and resumed the approved request.'
          : 'Runtime recorded a delegated approval rejection.',
      },
    };
  } catch (error) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    return delegationUnavailable({
      reasonCode: stringOr(record.reasonCode, 'zhiyu-delegation-approval-decision-failed'),
      actionHint: stringOr(record.actionHint, 'inspect_runtime_delegation_approval'),
      source: stringOr(record.source, 'sdk'),
      message: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Runtime delegated approval decision failed.',
      ...identity,
      observedAt: options.observedAt,
      lastDecision: {
        state: 'failed',
        approvalRequestId,
        reasonCode: stringOr(record.reasonCode, 'zhiyu-delegation-approval-decision-failed'),
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Runtime delegated approval decision failed.',
      },
    });
  }
}

async function resolveDelegationSurface(
  options: ZhiyuDelegationUxProbeOptions,
  mode: 'read' | 'write',
  identity: DelegationIdentity,
): Promise<DelegationControlSurface> {
  if (
    options.loadSnapshot
    && (mode === 'read' || (options.submitApprovalDecision && options.resumeApprovedCapability))
  ) {
    return {
      loadSnapshot: options.loadSnapshot,
      submitApprovalDecision: options.submitApprovalDecision ?? missingSubmitter,
      resumeApprovedCapability: options.resumeApprovedCapability ?? missingResumer,
      loadReplayTrace: options.loadReplayTrace ?? missingReplayLoader,
    };
  }

  if (!await runtimeBridgeAvailable(options)) {
    throw Object.assign(new Error('Electron Runtime bridge is not available.'), {
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
    });
  }

  const {
    Runtime,
    createNimiHostRuntimeAgentDelegatedCapabilitySurface,
  } = await import('@nimiplatform/sdk/runtime');
  const {
    createZhiyuRuntimeAgentBindingScopeRunner,
    resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost,
    scopedBindingForRuntimeAgentRequest,
  } = await import('../agent-chat/runtime-agent-binding');
  const requiredScopes = mode === 'read'
    ? [DELEGATION_READ_SCOPE]
    : [DELEGATION_READ_SCOPE, DELEGATION_WRITE_SCOPE];
  const scopedBindingDecision = await resolveZhiyuRuntimeAgentScopedBindingDecisionFromHost({
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
    conversationAnchorId: identity.conversationAnchorId,
    scopes: requiredScopes,
  });
  const scopedBinding = scopedBindingForRuntimeAgentRequest(scopedBindingDecision);
  if (!scopedBinding) {
    throw Object.assign(new Error('Runtime delegation control requires a Runtime-issued scoped binding.'), {
      reasonCode: 'zhiyu-delegation-scoped-binding-required',
      actionHint: 'attach_runtime_scoped_delegation_binding',
      source: 'renderer',
    });
  }
  const runtime = new Runtime({
    appId: APP_ID,
    transport: { type: 'electron-ipc' },
  });
  const sdkSurface = (identity: DelegationIdentity) => createNimiHostRuntimeAgentDelegatedCapabilitySurface({
    getRuntime: () => ({
      appId: APP_ID,
      auth: runtime.auth,
      appAuth: runtime.grants,
      agent: runtime.agents,
    }),
    getSubjectUserId: () => identity.ownerUserId,
    withScopes: createZhiyuRuntimeAgentBindingScopeRunner(() => scopedBindingDecision),
  });

  return {
    loadSnapshot: async (input) => sdkSurface(input).loadSnapshot({ ...input, scopedBinding }),
    submitApprovalDecision: async (input) => sdkSurface(input).submitApprovalDecision({ ...input, scopedBinding }),
    resumeApprovedCapability: async (input) => sdkSurface(input).resumeApprovedCapability({ ...input, scopedBinding }),
    loadReplayTrace: async (input) => sdkSurface(input).loadReplayTrace({ ...input, scopedBinding }),
  };
}

async function runtimeBridgeAvailable(options: ZhiyuDelegationUxProbeOptions): Promise<boolean> {
  if (options.hasRuntimeBridge) {
    return options.hasRuntimeBridge();
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const { hasElectronRuntime } = await import('@nimiplatform/kit/shell/renderer/bridge');
  return hasElectronRuntime();
}

async function missingSubmitter(): Promise<never> {
  throw new Error('Runtime delegation approval submitter is not available.');
}

async function missingResumer(): Promise<never> {
  throw new Error('Runtime delegation approved request resumer is not available.');
}

async function missingReplayLoader(): Promise<null> {
  return null;
}
