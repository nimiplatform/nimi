import {
  createAgentCenterShellAppearanceAdapter,
  type AgentCenterAppearanceAdapter,
  type AgentCenterRuntimeAdapter,
  type AgentCenterRuntimeAIConfigUpsertInput,
  type AgentCenterRuntimeAutonomyConfigInput,
} from '@nimiplatform/kit/features/agent-center';
import type { RuntimeLocalAgentIdentityInput } from '@nimiplatform/kit/core/sdk-contract';
import {
  createAgentCenterShellBridge,
  hasElectronRuntime,
} from '@nimiplatform/kit/shell/renderer/bridge';

import type { ZhiyuEvidence } from '../shell/app/evidence.js';
import {
  createZhiyuAgentInspectSurface,
  createZhiyuAgentPresentationProfileSurface,
  getZhiyuAgentAIConfig,
  getZhiyuAgentAIConfigReadiness,
  subscribeZhiyuAgentAIConfigReadiness,
  upsertZhiyuAgentAIConfig,
  type ZhiyuAgentAIConfigCallInput,
  type ZhiyuAgentRuntimeScopedBindingIdentity,
} from '../shell/agent-chat/agent-ai-config.js';
import { getZhiyuRouteModelPickerProvider } from '../shell/agent-chat/zhiyu-route-model-picker-provider.js';
import {
  zhiyuAgentAIConfigIdentityFromRouteInput,
  zhiyuAgentAIConfigRouteInputFromEvidence,
} from '../shell/app/agent-ai-config-route-input.js';

export function createZhiyuProductionAgentCenterAdapters(evidence: ZhiyuEvidence): {
  readonly appearance: AgentCenterAppearanceAdapter;
  readonly runtime: AgentCenterRuntimeAdapter | null;
} {
  return {
    appearance: appearanceAdapter(evidence),
    runtime: runtimeAdapter(evidence),
  };
}

function appearanceAdapter(evidence: ZhiyuEvidence): AgentCenterAppearanceAdapter {
  const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(evidence);
  const subjectUserId = routeInput.subjectUserId.trim();
  const identity = zhiyuAgentAIConfigIdentityFromRouteInput(routeInput);
  if (!subjectUserId || !identity) {
    return unavailableAppearance(
      evidence,
      !subjectUserId
        ? 'zhiyu-agent-center-runtime-subject-required'
        : 'zhiyu-agent-center-runtime-identity-required',
    );
  }
  if (!hasElectronRuntime()) {
    return unavailableAppearance(evidence, 'zhiyu-agent-center-runtime-bridge-unavailable');
  }
  const scopedBindingIdentity = scopedBindingIdentityFrom(identity, evidence);
  const inspect = createZhiyuAgentInspectSurface(subjectUserId, scopedBindingIdentity);
  return createAgentCenterShellAppearanceAdapter({
    identity,
    accountId: subjectUserId,
    runtimePresentation: createZhiyuAgentPresentationProfileSurface(subjectUserId, scopedBindingIdentity),
    shell: createAgentCenterShellBridge(),
    avatarPreview: null,
    loadSnapshot: async () => ({ inspect: await inspect.getPublicInspect(identity) }),
  });
}

function unavailableAppearance(
  evidence: ZhiyuEvidence,
  reason: string,
): AgentCenterAppearanceAdapter {
  return {
    async load() {
      return {
        status: 'not_configured',
        backendKind: evidence.avatar.backendKind || null,
        avatarAssetRef: null,
        avatarAssetValid: false,
        avatarAssetChecking: false,
        validationStatus: 'selection_missing',
        validationMessage: evidence.avatar.message || null,
        validationIssueRows: [],
        backendCapabilityProfileRef: null,
        backgroundRef: null,
        backgroundValid: false,
        backgroundChecking: false,
        backgroundValidationStatus: 'selection_missing',
        backgroundValidationMessage: null,
        previewState: null,
        previewTier: null,
        previewArtifactRef: null,
        previewImageRef: null,
        previewFailureReason: null,
        previewWarnings: [],
        defaultVoiceReference: null,
        avatarAutoplay: false,
        avatarImportDisabled: true,
        backgroundImportDisabled: true,
        disabledReason: reason,
      };
    },
  };
}

function runtimeAdapter(evidence: ZhiyuEvidence): AgentCenterRuntimeAdapter | null {
  const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(evidence);
  const subjectUserId = routeInput.subjectUserId.trim();
  const identity = zhiyuAgentAIConfigIdentityFromRouteInput(routeInput);
  if (!subjectUserId || !identity) return null;
  const callInput: ZhiyuAgentAIConfigCallInput = { subjectUserId, ...identity };
  const scopedBindingIdentity = scopedBindingIdentityFrom(identity, evidence);
  const inspect = createZhiyuAgentInspectSurface(subjectUserId, scopedBindingIdentity);
  return {
    inspect,
    agentAIConfig: {
      get(input = callInput) {
        return getZhiyuAgentAIConfig({
          ...resolveCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      readiness(input = callInput) {
        return getZhiyuAgentAIConfigReadiness({
          ...resolveCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      subscribeReadiness(input = callInput) {
        return subscribeZhiyuAgentAIConfigReadiness({
          ...resolveCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      upsert(input) {
        return upsertZhiyuAgentAIConfig({
          ...resolveCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
          expectedRevision: input.expectedRevision,
          intents: input.intents,
        });
      },
    },
    modelConfig: { providerResolver: getZhiyuRouteModelPickerProvider },
    async loadSnapshot() {
      const [agentAIConfig, readiness, publicInspect] = await Promise.all([
        getZhiyuAgentAIConfig(callInput),
        getZhiyuAgentAIConfigReadiness(callInput),
        inspect.getPublicInspect(identity),
      ]);
      return {
        agentAIConfig,
        readiness,
        inspect: publicInspect,
        sourceContextStatus: evidence.source.sourceContextStatus,
        turnContextSummary: evidence.source.turnContextSummary,
      };
    },
    upsertAgentAIConfig(input) {
      return upsertZhiyuAgentAIConfig({
        ...resolveMutationIdentity(callInput, input),
        subjectUserId,
        expectedRevision: input.expectedRevision,
        intents: input.intents,
      });
    },
    async setAutonomyConfig(input) {
      const identityInput = resolveAutonomyIdentity(callInput, input);
      const mode = input.enabled === false ? 'off' : input.mode;
      const snapshot = await inspect.setAutonomyConfig({
        ...identityInput,
        mode,
        dailyTokenBudget: input.dailyTokenBudget,
        maxTokensPerHook: input.maxTokensPerHook,
      });
      if (input.enabled !== true || mode === 'off' || snapshot.enabled === true) return snapshot;
      return inspect.enableAutonomy(identityInput);
    },
  };
}

function scopedBindingIdentityFrom(
  identity: RuntimeLocalAgentIdentityInput,
  evidence: ZhiyuEvidence,
): ZhiyuAgentRuntimeScopedBindingIdentity | null {
  const ownerUserId = typeof identity.ownerUserId === 'string' ? identity.ownerUserId.trim() : '';
  const runtimeSourceRef = typeof identity.runtimeSourceRef === 'string' ? identity.runtimeSourceRef.trim() : '';
  const localAgentRef = typeof identity.localAgentRef === 'string' ? identity.localAgentRef.trim() : '';
  const conversationAnchorId = evidence.conversation.conversationAnchorId?.trim() || '';
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId) return null;
  return { ownerUserId, runtimeSourceRef, localAgentRef, conversationAnchorId };
}

function resolveMutationIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: AgentCenterRuntimeAIConfigUpsertInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    };
  }
  return resolveCallIdentity(base, base);
}

function resolveAutonomyIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: AgentCenterRuntimeAutonomyConfigInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    };
  }
  return resolveCallIdentity(base, base);
}

function resolveCallIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: Partial<RuntimeLocalAgentIdentityInput>,
): RuntimeLocalAgentIdentityInput {
  return {
    ownerUserId: input.ownerUserId || base.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef || base.runtimeSourceRef,
    localAgentRef: input.localAgentRef || base.localAgentRef,
    ...(input.scopedBinding || base.scopedBinding
      ? { scopedBinding: input.scopedBinding || base.scopedBinding }
      : {}),
  };
}
