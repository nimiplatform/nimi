import type { ScopedRuntimeBindingAttachment } from './generated/runtime/v1/common.js';
import {
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
} from './generated/runtime/v1/agent_service.js';
import type {
  CompanionParticipationProjection as ProtoCompanionParticipationProjection,
} from './generated/runtime/v1/agent_service.js';
import { toIsoFromTimestamp } from './runtime-value-utils.js';
import type { RuntimeCallOptions } from './types.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type { RuntimeAgentLocalIdentity, RuntimeScopedBindingAttachment } from './types-runtime-agent.js';

const COMPANION_PARTICIPATION_READ_SCOPE = 'runtime.agent.companion_participation.read';
const COMPANION_PARTICIPATION_WRITE_SCOPE = 'runtime.agent.companion_participation.write';

type ProtectedScopeHelper = {
  getCallOptions(scopes: readonly string[], baseOptions?: RuntimeCallOptions): Promise<RuntimeCallOptions>;
};

export type RuntimeCompanionParticipationSurfaceKind =
  | 'avatar_companion'
  | 'desktop_companion_panel'
  | 'avatar_debug_workbench';

export type RuntimeCompanionParticipationTriggerSource =
  | 'user_explicit'
  | 'scheduled_proactive'
  | 'domain_event';

export type RuntimeCompanionParticipationStatus =
  | 'idle'
  | 'admission_pending'
  | 'blocked'
  | 'running'
  | 'candidate_ready'
  | 'committed_by_owner'
  | 'failed'
  | 'canceled';

export type RuntimeCompanionParticipationProjection = {
  projectionId: string;
  agentId: string;
  surfaceKind: RuntimeCompanionParticipationSurfaceKind;
  profileRef: string;
  roomOrchestrationRef: string;
  triggerSource: RuntimeCompanionParticipationTriggerSource;
  status: RuntimeCompanionParticipationStatus;
  candidateRef?: string;
  commitRef?: string;
  refusalReason?: string;
  presentationRef?: string;
  auditRef: string;
  observedAt?: string;
  conversationAnchorId: string;
  turnId?: string;
  streamId?: string;
};

export type RuntimeCompanionParticipationBaseRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId: string;
  subjectUserId?: string;
  scopedBinding?: RuntimeScopedBindingAttachment;
  surfaceKind: RuntimeCompanionParticipationSurfaceKind;
  triggerSource: RuntimeCompanionParticipationTriggerSource;
  profileRef?: string;
  roomOrchestrationRef?: string;
  requestId?: string;
};

export type RuntimeCompanionParticipationRequest = RuntimeCompanionParticipationBaseRequest & {
  text: string;
  threadId?: string;
  worldId?: string;
  maxOutputTokens?: number;
};

export type RuntimeCompanionParticipationCancelRequest = RuntimeCompanionParticipationBaseRequest & {
  projectionId?: string;
  turnId?: string;
  reason?: string;
};

export type RuntimeCompanionParticipationReplayRequest = RuntimeCompanionParticipationBaseRequest & {
  projectionId: string;
};

export type RuntimeCompanionParticipationReplay = {
  replayRef: string;
  projection: RuntimeCompanionParticipationProjection;
};

export type RuntimeCompanionParticipationModule = {
  getProjection(
    request: RuntimeCompanionParticipationBaseRequest,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeCompanionParticipationProjection>;
  request(
    request: RuntimeCompanionParticipationRequest,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeCompanionParticipationProjection>;
  cancel(
    request: RuntimeCompanionParticipationCancelRequest,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeCompanionParticipationProjection>;
  openReplay(
    request: RuntimeCompanionParticipationReplayRequest,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeCompanionParticipationReplay>;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, label: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`runtime companion participation projection missing ${label}`);
  }
  return normalized;
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
    throw new Error('runtime companion participation request must use localAgentRef, not agentId');
  }
  const ownerUserId = optionalString(request.ownerUserId);
  const realmAgentId = optionalString(request.realmAgentId);
  const localAgentRef = optionalString(request.localAgentRef);
  if (!ownerUserId || !realmAgentId || !localAgentRef) {
    throw new Error('runtime companion participation request requires ownerUserId, realmAgentId, and localAgentRef');
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('runtime companion participation request localAgentRef is malformed');
  }
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw new Error('runtime companion participation request localAgentRef must match ownerUserId and realmAgentId');
  }
  return { ownerUserId, realmAgentId, localAgentRef };
}

async function contextForCompanionParticipation(input: {
  appId: string;
  request: RuntimeCompanionParticipationBaseRequest;
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

function toProtoSurfaceKind(value: RuntimeCompanionParticipationSurfaceKind): CompanionParticipationSurfaceKind {
  switch (value) {
    case 'avatar_companion':
      return CompanionParticipationSurfaceKind.AVATAR_COMPANION;
    case 'desktop_companion_panel':
      return CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL;
    case 'avatar_debug_workbench':
      return CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH;
    default:
      throw new Error(`unknown companion participation surface kind: ${String(value)}`);
  }
}

function fromProtoSurfaceKind(value: CompanionParticipationSurfaceKind): RuntimeCompanionParticipationSurfaceKind {
  switch (value) {
    case CompanionParticipationSurfaceKind.AVATAR_COMPANION:
      return 'avatar_companion';
    case CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL:
      return 'desktop_companion_panel';
    case CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH:
      return 'avatar_debug_workbench';
    default:
      throw new Error(`unknown companion participation projection surface kind: ${String(value)}`);
  }
}

function toProtoTriggerSource(value: RuntimeCompanionParticipationTriggerSource): CompanionParticipationTriggerSource {
  switch (value) {
    case 'user_explicit':
      return CompanionParticipationTriggerSource.USER_EXPLICIT;
    case 'scheduled_proactive':
      return CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE;
    case 'domain_event':
      return CompanionParticipationTriggerSource.DOMAIN_EVENT;
    default:
      throw new Error(`unknown companion participation trigger source: ${String(value)}`);
  }
}

function fromProtoTriggerSource(value: CompanionParticipationTriggerSource): RuntimeCompanionParticipationTriggerSource {
  switch (value) {
    case CompanionParticipationTriggerSource.USER_EXPLICIT:
      return 'user_explicit';
    case CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE:
      return 'scheduled_proactive';
    case CompanionParticipationTriggerSource.DOMAIN_EVENT:
      return 'domain_event';
    default:
      throw new Error(`unknown companion participation projection trigger source: ${String(value)}`);
  }
}

function fromProtoStatus(value: CompanionParticipationStatus): RuntimeCompanionParticipationStatus {
  switch (value) {
    case CompanionParticipationStatus.IDLE:
      return 'idle';
    case CompanionParticipationStatus.ADMISSION_PENDING:
      return 'admission_pending';
    case CompanionParticipationStatus.BLOCKED:
      return 'blocked';
    case CompanionParticipationStatus.RUNNING:
      return 'running';
    case CompanionParticipationStatus.CANDIDATE_READY:
      return 'candidate_ready';
    case CompanionParticipationStatus.COMMITTED_BY_OWNER:
      return 'committed_by_owner';
    case CompanionParticipationStatus.FAILED:
      return 'failed';
    case CompanionParticipationStatus.CANCELED:
      return 'canceled';
    default:
      throw new Error(`unknown companion participation projection status: ${String(value)}`);
  }
}

export function decodeCompanionParticipationProjection(
  projection: ProtoCompanionParticipationProjection | undefined,
): RuntimeCompanionParticipationProjection {
  if (!projection) {
    throw new Error('runtime companion participation projection is required');
  }
  const status = fromProtoStatus(projection.status);
  const candidateRef = optionalString(projection.candidateRef);
  const commitRef = optionalString(projection.commitRef);
  if (status === 'candidate_ready' && !candidateRef) {
    throw new Error('runtime companion participation candidate_ready projection missing candidate_ref');
  }
  if (status === 'committed_by_owner' && !commitRef) {
    throw new Error('runtime companion participation committed_by_owner projection missing commit_ref');
  }
  return {
    projectionId: requiredString(projection.projectionId, 'projection_id'),
    agentId: requiredString(projection.agentId, 'agent_id'),
    surfaceKind: fromProtoSurfaceKind(projection.surfaceKind),
    profileRef: requiredString(projection.profileRef, 'profile_ref'),
    roomOrchestrationRef: requiredString(projection.roomOrchestrationRef, 'room_orchestration_ref'),
    triggerSource: fromProtoTriggerSource(projection.triggerSource),
    status,
    ...(candidateRef ? { candidateRef } : {}),
    ...(commitRef ? { commitRef } : {}),
    ...(optionalString(projection.refusalReason) ? { refusalReason: optionalString(projection.refusalReason) } : {}),
    ...(optionalString(projection.presentationRef) ? { presentationRef: optionalString(projection.presentationRef) } : {}),
    auditRef: requiredString(projection.auditRef, 'audit_ref'),
    ...(toIsoFromTimestamp(projection.observedAt) ? { observedAt: toIsoFromTimestamp(projection.observedAt) } : {}),
    conversationAnchorId: requiredString(projection.conversationAnchorId, 'conversation_anchor_id'),
    ...(optionalString(projection.turnId) ? { turnId: optionalString(projection.turnId) } : {}),
    ...(optionalString(projection.streamId) ? { streamId: optionalString(projection.streamId) } : {}),
  };
}

export function createRuntimeCompanionParticipationModule(input: {
  appId: string;
  agent: RuntimeAgentClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeCompanionParticipationModule {
  async function buildContext(request: RuntimeCompanionParticipationBaseRequest) {
    return contextForCompanionParticipation({
      appId: input.appId,
      request,
      resolveSubjectUserId: input.resolveSubjectUserId,
    });
  }

  function baseRequest(request: RuntimeCompanionParticipationBaseRequest, context: Awaited<ReturnType<typeof buildContext>>) {
    return {
      context,
      agentId: context.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      surfaceKind: toProtoSurfaceKind(request.surfaceKind),
      triggerSource: toProtoTriggerSource(request.triggerSource),
      profileRef: optionalString(request.profileRef) || '',
      roomOrchestrationRef: optionalString(request.roomOrchestrationRef) || '',
      requestId: optionalString(request.requestId) || '',
    };
  }

  return {
    async getProjection(request, options) {
      const context = await buildContext(request);
      const callOptions = await input.protectedAccess.getCallOptions([COMPANION_PARTICIPATION_READ_SCOPE], options);
      const response = await input.agent.getCompanionParticipationProjection(baseRequest(request, context), callOptions);
      return decodeCompanionParticipationProjection(response.projection);
    },
    async request(request, options) {
      const context = await buildContext(request);
      const callOptions = await input.protectedAccess.getCallOptions([COMPANION_PARTICIPATION_WRITE_SCOPE], options);
      const response = await input.agent.requestCompanionParticipation({
        ...baseRequest(request, context),
        text: requiredString(request.text, 'text'),
        threadId: optionalString(request.threadId) || '',
        worldId: optionalString(request.worldId) || '',
        maxOutputTokens: Number.isFinite(request.maxOutputTokens) ? Math.trunc(Number(request.maxOutputTokens)) : 0,
      }, callOptions);
      return decodeCompanionParticipationProjection(response.projection);
    },
    async cancel(request, options) {
      const context = await buildContext(request);
      const callOptions = await input.protectedAccess.getCallOptions([COMPANION_PARTICIPATION_WRITE_SCOPE], options);
      const response = await input.agent.cancelCompanionParticipation({
        ...baseRequest(request, context),
        projectionId: optionalString(request.projectionId) || '',
        turnId: optionalString(request.turnId) || '',
        reason: optionalString(request.reason) || '',
      }, callOptions);
      return decodeCompanionParticipationProjection(response.projection);
    },
    async openReplay(request, options) {
      const context = await buildContext(request);
      const callOptions = await input.protectedAccess.getCallOptions([COMPANION_PARTICIPATION_READ_SCOPE], options);
      const response = await input.agent.openCompanionParticipationReplay({
        ...baseRequest(request, context),
        projectionId: requiredString(request.projectionId, 'projection_id'),
      }, callOptions);
      return {
        replayRef: requiredString(response.replayRef, 'replay_ref'),
        projection: decodeCompanionParticipationProjection(response.projection),
      };
    },
  };
}
