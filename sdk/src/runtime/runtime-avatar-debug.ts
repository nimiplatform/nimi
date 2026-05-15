import type { ScopedRuntimeBindingAttachment } from './generated/runtime/v1/common.js';
import {
  AvatarDebugProbeKind,
} from './generated/runtime/v1/agent_service.js';
import type {
  AvatarDebugRequestedBy,
  GetAvatarDebugReplayResponse,
  GetAvatarDebugSnapshotResponse,
  ListAvatarDebugProbeResultsResponse,
  RequestAvatarDebugProbeResponse,
} from './generated/runtime/v1/agent_service.js';
import type { RuntimeCallOptions } from './types.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type { RuntimeAgentLocalIdentity, RuntimeScopedBindingAttachment } from './types-runtime-agent.js';

const AVATAR_DEBUG_READ_SCOPE = 'runtime.agent.avatar_debug.read';
const AVATAR_DEBUG_WRITE_SCOPE = 'runtime.agent.avatar_debug.write';

type ProtectedScopeHelper = {
  getCallOptions(scopes: readonly string[], baseOptions?: RuntimeCallOptions): Promise<RuntimeCallOptions>;
};

export type RuntimeAvatarDebugSnapshotRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId: string;
  subjectUserId?: string;
  scopedBinding?: RuntimeScopedBindingAttachment;
};

export type RuntimeAvatarDebugRequestProbeRequest = RuntimeAvatarDebugSnapshotRequest & {
  probeKind: AvatarDebugProbeKind;
  requestedBy: AvatarDebugRequestedBy;
  probeId?: string;
  turnId?: string;
  streamId?: string;
  avatarInstanceId?: string;
  replayRequested?: boolean;
};

export type RuntimeAvatarDebugListProbeResultsRequest = RuntimeAvatarDebugSnapshotRequest & {
  probeKind?: AvatarDebugProbeKind;
};

export type RuntimeAvatarDebugReplayRequest = RuntimeAvatarDebugSnapshotRequest & {
  probeId: string;
};

export type RuntimeAvatarDebugModule = {
  snapshot(
    request: RuntimeAvatarDebugSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetAvatarDebugSnapshotResponse>;
  requestProbe(
    request: RuntimeAvatarDebugRequestProbeRequest,
    options?: RuntimeCallOptions,
  ): Promise<RequestAvatarDebugProbeResponse>;
  listProbeResults(
    request: RuntimeAvatarDebugListProbeResultsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListAvatarDebugProbeResultsResponse>;
  getReplay(
    request: RuntimeAvatarDebugReplayRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetAvatarDebugReplayResponse>;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toScopedBindingAttachment(
  input: RuntimeScopedBindingAttachment | undefined,
  defaults: {
    runtimeAppId: string;
    localAgentRef?: string;
    conversationAnchorId?: string;
  },
): ScopedRuntimeBindingAttachment | undefined {
  const bindingId = optionalString(input?.bindingId);
  if (!bindingId) {
    return undefined;
  }
  return {
    bindingId,
    bindingHandle: optionalString(input?.bindingHandle) || '',
    runtimeAppId: optionalString(input?.runtimeAppId) || defaults.runtimeAppId,
    appInstanceId: optionalString(input?.appInstanceId) || '',
    windowId: optionalString(input?.windowId) || '',
    avatarInstanceId: optionalString(input?.avatarInstanceId) || '',
    agentId: optionalString(input?.localAgentRef) || optionalString(defaults.localAgentRef) || '',
    conversationAnchorId: optionalString(input?.conversationAnchorId) || optionalString(defaults.conversationAnchorId) || '',
    worldId: optionalString(input?.worldId) || '',
  };
}

function requireLocalAgentIdentity(request: RuntimeAgentLocalIdentity & { agentId?: unknown }): RuntimeAgentLocalIdentity {
  if (optionalString(request.agentId)) {
    throw new Error('runtime avatar debug request must use localAgentRef, not agentId');
  }
  const ownerUserId = optionalString(request.ownerUserId);
  const realmAgentId = optionalString(request.realmAgentId);
  const localAgentRef = optionalString(request.localAgentRef);
  if (!ownerUserId || !realmAgentId || !localAgentRef) {
    throw new Error('runtime avatar debug request requires ownerUserId, realmAgentId, and localAgentRef');
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('runtime avatar debug request localAgentRef is malformed');
  }
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw new Error('runtime avatar debug request localAgentRef must match ownerUserId and realmAgentId');
  }
  return { ownerUserId, realmAgentId, localAgentRef };
}

async function contextForAvatarDebug(input: {
  appId: string;
  request: RuntimeAvatarDebugSnapshotRequest;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): Promise<{
  appId: string;
  subjectUserId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  scopedBinding?: ScopedRuntimeBindingAttachment;
}> {
  const identity = requireLocalAgentIdentity(input.request);
  const scopedBinding = toScopedBindingAttachment(input.request.scopedBinding, {
    runtimeAppId: input.appId,
    localAgentRef: identity.localAgentRef,
    conversationAnchorId: input.request.conversationAnchorId,
  });
  if (scopedBinding) {
    return {
      appId: input.appId,
      subjectUserId: '',
      ownerUserId: identity.ownerUserId,
      realmAgentId: identity.realmAgentId,
      localAgentRef: identity.localAgentRef,
      scopedBinding,
    };
  }
  return {
    appId: input.appId,
    subjectUserId: await input.resolveSubjectUserId(input.request.subjectUserId || identity.ownerUserId),
    ownerUserId: identity.ownerUserId,
    realmAgentId: identity.realmAgentId,
    localAgentRef: identity.localAgentRef,
  };
}

export function createRuntimeAvatarDebugModule(input: {
  appId: string;
  agent: RuntimeAgentClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeAvatarDebugModule {
  return {
    async snapshot(request, options) {
      const context = await contextForAvatarDebug({
        appId: input.appId,
        request,
        resolveSubjectUserId: input.resolveSubjectUserId,
      });
      const callOptions = await input.protectedAccess.getCallOptions([AVATAR_DEBUG_READ_SCOPE], options);
      return input.agent.getAvatarDebugSnapshot({
        context,
        agentId: context.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
      }, callOptions);
    },
    async requestProbe(request, options) {
      const context = await contextForAvatarDebug({
        appId: input.appId,
        request,
        resolveSubjectUserId: input.resolveSubjectUserId,
      });
      const callOptions = await input.protectedAccess.getCallOptions([AVATAR_DEBUG_WRITE_SCOPE], options);
      return input.agent.requestAvatarDebugProbe({
        context,
        agentId: context.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        probeKind: request.probeKind,
        requestedBy: request.requestedBy,
        probeId: optionalString(request.probeId) || '',
        turnId: optionalString(request.turnId) || '',
        streamId: optionalString(request.streamId) || '',
        avatarInstanceId: optionalString(request.avatarInstanceId) || '',
        replayRequested: Boolean(request.replayRequested),
      }, callOptions);
    },
    async listProbeResults(request, options) {
      const context = await contextForAvatarDebug({
        appId: input.appId,
        request,
        resolveSubjectUserId: input.resolveSubjectUserId,
      });
      const callOptions = await input.protectedAccess.getCallOptions([AVATAR_DEBUG_READ_SCOPE], options);
      return input.agent.listAvatarDebugProbeResults({
        context,
        agentId: context.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        probeKind: request.probeKind ?? AvatarDebugProbeKind.UNSPECIFIED,
      }, callOptions);
    },
    async getReplay(request, options) {
      const context = await contextForAvatarDebug({
        appId: input.appId,
        request,
        resolveSubjectUserId: input.resolveSubjectUserId,
      });
      const callOptions = await input.protectedAccess.getCallOptions([AVATAR_DEBUG_READ_SCOPE], options);
      return input.agent.getAvatarDebugReplay({
        context,
        agentId: context.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        probeId: request.probeId,
      }, callOptions);
    },
  };
}
