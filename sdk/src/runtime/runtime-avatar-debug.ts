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
import type { RuntimeScopedBindingAttachment } from './types-runtime-modules.js';

const AVATAR_DEBUG_READ_SCOPE = 'runtime.agent.avatar_debug.read';
const AVATAR_DEBUG_WRITE_SCOPE = 'runtime.agent.avatar_debug.write';

type ProtectedScopeHelper = {
  getCallOptions(scopes: readonly string[], baseOptions?: RuntimeCallOptions): Promise<RuntimeCallOptions>;
};

export type RuntimeAvatarDebugSnapshotRequest = {
  agentId: string;
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
    agentId?: string;
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
    agentId: optionalString(input?.agentId) || optionalString(defaults.agentId) || '',
    conversationAnchorId: optionalString(input?.conversationAnchorId) || optionalString(defaults.conversationAnchorId) || '',
    worldId: optionalString(input?.worldId) || '',
  };
}

async function contextForAvatarDebug(input: {
  appId: string;
  request: RuntimeAvatarDebugSnapshotRequest;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): Promise<{
  appId: string;
  subjectUserId: string;
  scopedBinding?: ScopedRuntimeBindingAttachment;
}> {
  const scopedBinding = toScopedBindingAttachment(input.request.scopedBinding, {
    runtimeAppId: input.appId,
    agentId: input.request.agentId,
    conversationAnchorId: input.request.conversationAnchorId,
  });
  if (scopedBinding) {
    return {
      appId: input.appId,
      subjectUserId: '',
      scopedBinding,
    };
  }
  return {
    appId: input.appId,
    subjectUserId: await input.resolveSubjectUserId(input.request.subjectUserId),
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
        agentId: request.agentId,
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
        agentId: request.agentId,
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
        agentId: request.agentId,
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
        agentId: request.agentId,
        conversationAnchorId: request.conversationAnchorId,
        probeId: request.probeId,
      }, callOptions);
    },
  };
}
