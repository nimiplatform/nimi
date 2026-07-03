import type { TFunction } from 'i18next';
import {
  getNimiRuntimeRouteCapabilityProjectionIssueKind,
  isNimiRuntimeRouteCapabilityProjectionReady,
  isNimiRuntimeRouteCapabilityProjectionSelectionRequired,
} from '@nimiplatform/sdk/runtime';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapabilityProjection,
} from './conversation-capability';
import {
  buildAgentEffectiveCapabilityResolution,
} from './conversation-capability';
import {
  refreshAgentEffectiveCapabilityResolution,
  refreshConversationCapabilityProjections,
} from './conversation-capability-projection';

type EnsureAiConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections: typeof refreshConversationCapabilityProjections;
  getTextCapabilityProjection: () => ConversationCapabilityProjection | null;
};

type EnsureAgentConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections: typeof refreshConversationCapabilityProjections;
  refreshAgentEffectiveCapabilityResolution: typeof refreshAgentEffectiveCapabilityResolution;
  getTextCapabilityProjection: () => ConversationCapabilityProjection | null;
  getAgentResolution: () => AgentEffectiveCapabilityResolution | null;
};

type AgentSubmitRouteUnavailableDetails = {
  message: string;
  reasonCode: (typeof ReasonCode)[keyof typeof ReasonCode];
  actionHint: string;
};

function resolveAiSubmitRouteUnavailableMessage(
  t: TFunction,
  projection: ConversationCapabilityProjection | null,
): string {
  if (isNimiRuntimeRouteCapabilityProjectionSelectionRequired(projection)) {
    return t('Chat.nimiSubmitRouteUnavailable', {
      defaultValue: 'Select a Nimi route before sending a message.',
    });
  }
  return t('Chat.nimiSubmitRouteUnavailable', {
    defaultValue: 'Choose a ready Nimi route before sending a message.',
  });
}

const DEFAULT_AI_DEPS: EnsureAiConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections,
  getTextCapabilityProjection: () => (
    useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null
  ),
};

const DEFAULT_AGENT_DEPS: EnsureAgentConversationSubmitRouteReadyDeps = {
  refreshConversationCapabilityProjections,
  refreshAgentEffectiveCapabilityResolution,
  getTextCapabilityProjection: () => (
    useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null
  ),
  getAgentResolution: () => useAppStore.getState().agentEffectiveCapabilityResolution,
};

export function resolveAgentSubmitRouteUnavailableDetails(
  t: TFunction,
  projection: ConversationCapabilityProjection | null | undefined,
): AgentSubmitRouteUnavailableDetails {
  switch (getNimiRuntimeRouteCapabilityProjectionIssueKind(projection)) {
    case 'needs_selection':
      return {
        message: t('Chat.agentSubmitRouteNeedsSelection', {
          defaultValue: 'Choose a local or cloud runtime route before sending a message.',
        }),
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'select_runtime_route_binding',
      };
    case 'binding_unresolved':
      return {
        message: t('Chat.agentSubmitRouteUnresolved', {
          defaultValue: 'The selected runtime route can no longer be resolved. Choose another model route before sending.',
        }),
        reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
        actionHint: 'repair_runtime_route_binding',
      };
    case 'route_not_ready':
      return {
        message: t('Chat.agentSubmitRouteNotReady', {
          defaultValue: 'The selected runtime route is not ready yet. Finish setup or warm the local model before sending.',
        }),
        reasonCode: ReasonCode.AI_MODEL_NOT_READY,
        actionHint: 'warm_runtime_route_binding',
      };
    case 'route_unhealthy':
      return {
        message: t('Chat.agentSubmitRouteUnhealthy', {
          defaultValue: 'The selected runtime route failed its latest health check. Check the model route in Agent Center before sending.',
        }),
        reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
        actionHint: 'repair_runtime_route_binding',
      };
    case 'metadata_missing':
      return {
        message: t('Chat.agentSubmitRouteMetadataUnavailable', {
          defaultValue: 'The selected runtime route is missing describe metadata. Refresh Runtime or choose another route before sending.',
        }),
        reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
        actionHint: 'refresh_runtime_route_metadata',
      };
    case 'capability_unsupported':
      return {
        message: t('Chat.agentSubmitCapabilityUnsupported', {
          defaultValue: 'This Runtime route does not expose text chat for partner conversations.',
        }),
        reasonCode: ReasonCode.AI_ROUTE_UNSUPPORTED,
        actionHint: 'select_runtime_route_binding',
      };
    case 'host_denied':
      return {
        message: t('Chat.agentSubmitCapabilityDenied', {
          defaultValue: 'This device is not allowed to use the selected Runtime route for this conversation.',
        }),
        reasonCode: ReasonCode.ACTION_PERMISSION_DENIED,
        actionHint: 'request_runtime_route_permission',
      };
    case 'unknown':
    default:
      return {
        message: t('Chat.agentSubmitRouteUnavailable', {
          defaultValue: 'A local or cloud runtime route is required before sending a message.',
        }),
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'select_runtime_route_binding',
      };
  }
}

function routeUnavailableError(t: TFunction, projection: ConversationCapabilityProjection | null | undefined): Error {
  const details = resolveAgentSubmitRouteUnavailableDetails(t, projection);
  return createNimiError({
    message: details.message,
    reasonCode: details.reasonCode,
    actionHint: details.actionHint,
    source: 'sdk',
  });
}

export async function ensureAiConversationSubmitRouteReady(input: {
  t: TFunction;
  deps?: Partial<EnsureAiConversationSubmitRouteReadyDeps>;
}): Promise<ConversationCapabilityProjection> {
  const deps = {
    ...DEFAULT_AI_DEPS,
    ...input.deps,
  };
  await deps.refreshConversationCapabilityProjections(['text.generate']);
  const projection = deps.getTextCapabilityProjection();
  if (isNimiRuntimeRouteCapabilityProjectionReady(projection)) {
    return projection;
  }
  throw new Error(resolveAiSubmitRouteUnavailableMessage(input.t, projection));
}

export async function ensureAgentConversationSubmitRouteReady(input: {
  t: TFunction;
  deps?: Partial<EnsureAgentConversationSubmitRouteReadyDeps>;
}): Promise<AgentEffectiveCapabilityResolution> {
  const deps = {
    ...DEFAULT_AGENT_DEPS,
    ...input.deps,
  };
  await deps.refreshConversationCapabilityProjections(['text.generate']);
  deps.refreshAgentEffectiveCapabilityResolution();
  const resolution = deps.getAgentResolution();
  if (resolution?.ready && isNimiRuntimeRouteCapabilityProjectionReady(resolution.textProjection)) {
    return resolution;
  }
  const textProjection = deps.getTextCapabilityProjection();
  if (isNimiRuntimeRouteCapabilityProjectionReady(textProjection)) {
    const rebuilt = buildAgentEffectiveCapabilityResolution({
      textProjection,
      imageProjection: resolution?.imageProjection || null,
      voiceProjection: resolution?.voiceProjection || null,
      voiceWorkflowCloneProjection: resolution?.voiceWorkflowProjections['voice_workflow.voice_clone'] || null,
      voiceWorkflowDesignProjection: resolution?.voiceWorkflowProjections['voice_workflow.voice_design'] || null,
    });
    if (rebuilt.ready) {
      return rebuilt;
    }
  }
  throw routeUnavailableError(input.t, resolution?.textProjection || textProjection);
}
