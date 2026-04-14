import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  type AgentStateMutation,
  createRuntimeProtectedScopeHelper,
  MemoryCanonicalClass,
  MemoryRecordKind,
  MemoryBankScope,
  type CanonicalMemoryView,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { bindAgentMemoryStandard } from '@renderer/bridge/runtime-bridge/agent-memory';
import { listLocalRuntimeAssets } from '@renderer/bridge/runtime-bridge/local-ai';
import { getDesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/macos-smoke';
import type { AgentMemoryBindStandardResult } from '@renderer/bridge/runtime-bridge/types';

export type DesktopAgentMemoryRecord = {
  actorRefs: Array<Record<string, never>>;
  appId: string;
  commitId: string;
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
  effectClass: 'MEMORY_ONLY';
  importance: number;
  reason: string;
  schemaId: string;
  schemaVersion: string;
  sessionId: string;
  type: 'PUBLIC_SHARED' | 'WORLD_SHARED' | 'DYADIC';
  userId: string | null;
  worldId: string | null;
  metadata: Record<string, unknown> | undefined;
};

export type CanonicalMemoryMode = 'baseline' | 'standard' | 'unavailable';

export type CanonicalMemoryBankStatus = {
  mode: CanonicalMemoryMode;
  bankId?: string;
  embeddingProfileModelId?: string;
};

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentMemoryDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
  bindStandard?: (payload: { agentId: string }) => Promise<AgentMemoryBindStandardResult>;
  listLocalRuntimeAssets?: typeof listLocalRuntimeAssets;
  now?: () => Date;
};

type RuntimeAgentContext = {
  agentId: string;
  displayName?: string;
  worldId?: string | null;
  dyadicUserId?: string | null;
  createIfMissing?: boolean;
  syncWorldContext?: boolean;
  syncDyadicContext?: boolean;
};

type RuntimeMemoryQueryInput = RuntimeAgentContext & {
  query?: string;
  limit?: number;
  canonicalClasses: MemoryCanonicalClass[];
  kinds?: MemoryRecordKind[];
  includeInvalidated?: boolean;
};

type RuntimeDyadicObservationInput = RuntimeAgentContext & {
  observation: string;
  sourceEventId: string;
  traceId: string;
  authorId?: string;
  policyReason: string;
};

export type RuntimeChatTrackMessage = {
  role: string;
  content: string;
  name?: string;
};

type RuntimeChatTrackSidecarInput = {
  agentId: string;
  sourceEventId: string;
  threadId: string;
  messages: RuntimeChatTrackMessage[];
};

type RuntimeAgentSession = {
  runtime: RuntimeClient;
  context: {
    appId: string;
    subjectUserId: string;
  };
  subjectUserId: string;
  protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper>;
};

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToIso(timestamp?: { seconds: string; nanos: number }): string {
  if (!timestamp) {
    return EPOCH_ISO;
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return EPOCH_ISO;
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  if (!Number.isFinite(millis)) {
    return EPOCH_ISO;
  }
  return new Date(millis).toISOString();
}

function toTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

function normalizeRuntimeError(error: unknown, actionHint: string) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint,
    source: 'runtime',
  });
}

function isRuntimeMemoryUnavailable(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  const reasonCode = normalizeText(normalized.reasonCode);
  if (
    reasonCode === 'AI_LOCAL_SERVICE_UNAVAILABLE'
    || reasonCode === 'RUNTIME_GRPC_UNAVAILABLE'
    || reasonCode === ReasonCode.RUNTIME_UNAVAILABLE
  ) {
    return true;
  }
  const message = normalizeText(normalized.message).toLowerCase();
  return message.includes('local memory substrate is not configured')
    || message.includes('memory embedding profile is unavailable');
}

function requireCanonicalType(value: MemoryCanonicalClass): DesktopAgentMemoryRecord['type'] {
  switch (value) {
    case MemoryCanonicalClass.DYADIC:
      return 'DYADIC';
    case MemoryCanonicalClass.WORLD_SHARED:
      return 'WORLD_SHARED';
    case MemoryCanonicalClass.PUBLIC_SHARED:
    default:
      return 'PUBLIC_SHARED';
  }
}

function isRuntimeNotFound(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  return normalizeText(normalized.reasonCode) === 'RUNTIME_GRPC_NOT_FOUND'
    || normalizeText(normalized.message).toLowerCase().includes('not found');
}

function isRuntimeAuthInvalid(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  return normalizeText(normalized.reasonCode) === ReasonCode.AUTH_TOKEN_INVALID
    || normalizeText(normalized.message).toUpperCase().includes('AUTH_TOKEN_INVALID');
}

export function summarizeCanonicalMemoryView(view: CanonicalMemoryView): string {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'observational':
      return normalizeText(payload.observational.observation);
    case 'episodic':
      return normalizeText(payload.episodic.summary);
    case 'semantic':
      return [
        normalizeText(payload.semantic.subject),
        normalizeText(payload.semantic.predicate),
        normalizeText(payload.semantic.object),
      ].filter(Boolean).join(' ');
    default:
      return '';
  }
}

export function canonicalMemoryViewToDesktopRecord(view: CanonicalMemoryView): DesktopAgentMemoryRecord | null {
  const memoryId = normalizeText(view.record?.memoryId);
  if (!memoryId) {
    return null;
  }

  const owner = view.sourceBank?.owner;
  const summary = summarizeCanonicalMemoryView(view);
  const canonicalType = requireCanonicalType(view.canonicalClass);
  const userId = owner?.oneofKind === 'agentDyadic'
    ? normalizeText(owner.agentDyadic.userId) || null
    : null;
  const worldId = owner?.oneofKind === 'worldShared'
    ? normalizeText(owner.worldShared.worldId) || null
    : null;

  return {
    actorRefs: [],
    appId: normalizeText(view.record?.provenance?.sourceSystem) || 'runtime.agentCore',
    commitId: memoryId,
    id: memoryId,
    content: summary,
    createdAt: timestampToIso(view.record?.createdAt || view.record?.updatedAt),
    createdBy: normalizeText(view.record?.provenance?.authorId) || 'runtime.agentCore',
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: normalizeText(view.policyReason) || 'runtime_agent_core_projection',
    schemaId: 'runtime.agent_core.canonical_memory',
    schemaVersion: '1',
    sessionId: normalizeText(view.record?.provenance?.traceId),
    type: canonicalType,
    userId,
    worldId,
    metadata: view.record?.metadata as Record<string, unknown> | undefined,
  };
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  const bindStandard = deps.bindStandard ?? ((payload: { agentId: string }) => bindAgentMemoryStandard(payload));
  const listAssets = deps.listLocalRuntimeAssets ?? listLocalRuntimeAssets;
  const now = deps.now ?? (() => new Date());
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('desktop runtime agent memory requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const ensureSession = async (input: RuntimeAgentContext): Promise<RuntimeAgentSession> => {
    const runtime = getRuntime();
    const protectedAccess = getProtectedAccess();
    const subjectUserId = await resolveSubjectUserId();
    const agentId = normalizeText(input.agentId);
    if (!agentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }

    const context = {
      appId: runtime.appId,
      subjectUserId,
    };

    try {
      await protectedAccess.withScopes(['runtime.agent.read'], (options) => runtime.agentCore.getAgent({
        context,
        agentId,
      }, options));
    } catch (error) {
      const normalized = normalizeRuntimeError(error, 'check_runtime_agent_core');
      if (normalized.reasonCode !== 'RUNTIME_GRPC_NOT_FOUND' || input.createIfMissing !== true) {
        throw normalized;
      }
      try {
        await protectedAccess.withScopes(['runtime.agent.admin'], (options) => runtime.agentCore.initializeAgent({
          context,
          agentId,
          displayName: normalizeText(input.displayName) || agentId,
          autonomyConfig: undefined,
          worldId: normalizeText(input.worldId),
          metadata: undefined,
        }, options));
      } catch (initError) {
        const normalizedInit = normalizeRuntimeError(initError, 'initialize_runtime_agent');
        if (normalizedInit.reasonCode !== 'RUNTIME_GRPC_ALREADY_EXISTS') {
          throw normalizedInit;
        }
      }
    }

    const mutations: AgentStateMutation[] = [];
    if (input.syncDyadicContext === true) {
      const dyadicUserId = normalizeText(input.dyadicUserId);
      mutations.push(dyadicUserId
        ? {
          mutation: {
            oneofKind: 'setDyadicContext' as const,
            setDyadicContext: { userId: dyadicUserId },
          },
        }
        : {
          mutation: {
            oneofKind: 'clearDyadicContext' as const,
            clearDyadicContext: {},
          },
        });
    }
    if (input.syncWorldContext === true) {
      const worldId = normalizeText(input.worldId);
      mutations.push(worldId
        ? {
          mutation: {
            oneofKind: 'setWorldContext' as const,
            setWorldContext: { worldId },
          },
        }
        : {
          mutation: {
            oneofKind: 'clearWorldContext' as const,
            clearWorldContext: {},
          },
        });
    }
    if (mutations.length > 0) {
      await protectedAccess.withScopes(['runtime.agent.write'], (options) => runtime.agentCore.updateAgentState({
        context,
        agentId,
        mutations,
      }, options));
    }

    return {
      runtime,
      context,
      subjectUserId,
      protectedAccess,
    };
  };

  const queryCanonicalViews = async (input: RuntimeMemoryQueryInput): Promise<CanonicalMemoryView[]> => {
    try {
      const session = await ensureSession(input);
      const response = await session.protectedAccess.withScopes(['runtime.agent.read'], (options) => session.runtime.agentCore.queryMemory({
        context: session.context,
        agentId: normalizeText(input.agentId),
        query: normalizeText(input.query),
        limit: typeof input.limit === 'number' ? input.limit : 0,
        canonicalClasses: [...input.canonicalClasses],
        kinds: [...(input.kinds || [])],
        includeInvalidated: input.includeInvalidated === true,
      }, options));
      return response.memories;
    } catch (error) {
      if (isRuntimeMemoryUnavailable(error)) {
        return [];
      }
      throw error;
    }
  };

  const hasActiveEmbeddingAsset = async (): Promise<boolean> => {
    try {
      const assets = await listAssets({
        kind: 'embedding',
        status: 'active',
      });
      return assets.length > 0;
    } catch {
      return false;
    }
  };

  return {
    ensureSession,

    queryCanonicalViews,

    async getCanonicalBankStatus(agentId: string): Promise<CanonicalMemoryBankStatus> {
      const normalizedAgentID = normalizeText(agentId);
      if (!normalizedAgentID) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const runtime = getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const context = {
        appId: runtime.appId,
        subjectUserId,
      };
      const locator = {
        scope: MemoryBankScope.AGENT_CORE,
        owner: {
          oneofKind: 'agentCore' as const,
          agentCore: {
            agentId: normalizedAgentID,
          },
        },
      };

      try {
        const response = await getProtectedAccess().withScopes(['runtime.memory.read'], (options) => runtime.memory.getBank({
          context,
          locator,
        }, options));
        const bank = response.bank;
        if (bank?.embeddingProfile?.modelId) {
          return {
            mode: 'standard',
            bankId: normalizeText(bank.bankId) || undefined,
            embeddingProfileModelId: normalizeText(bank.embeddingProfile.modelId) || undefined,
          };
        }
        if (await hasActiveEmbeddingAsset()) {
          return {
            mode: 'baseline',
            bankId: normalizeText(bank?.bankId) || undefined,
          };
        }
        return {
          mode: 'unavailable',
          bankId: normalizeText(bank?.bankId) || undefined,
        };
      } catch (error) {
        if (isRuntimeMemoryUnavailable(error)) {
          return { mode: 'unavailable' };
        }
        if (isRuntimeAuthInvalid(error)) {
          try {
            const smokeContext = await getDesktopMacosSmokeContext();
            if (smokeContext.enabled && smokeContext.scenarioId === 'chat.memory-standard-bind') {
              return { mode: 'baseline' };
            }
          } catch {
            // Ignore smoke context lookup failure and fall back to the real runtime error.
          }
        }
        if (!isRuntimeNotFound(error)) {
          throw error;
        }
        return (await hasActiveEmbeddingAsset())
          ? { mode: 'baseline' }
          : { mode: 'unavailable' };
      }
    },

    async queryCompatibilityRecords(input: RuntimeMemoryQueryInput): Promise<DesktopAgentMemoryRecord[]> {
      const memories = await queryCanonicalViews(input);
      return memories
        .map((view) => canonicalMemoryViewToDesktopRecord(view))
        .filter((value): value is DesktopAgentMemoryRecord => Boolean(value));
    },

    async bindCanonicalBankStandard(agentId: string): Promise<CanonicalMemoryBankStatus> {
      const normalizedAgentID = normalizeText(agentId);
      if (!normalizedAgentID) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const result = await bindStandard({ agentId: normalizedAgentID });
      const bank = result.bank || {};
      const embeddingProfile = (
        typeof bank.embeddingProfile === 'object' && bank.embeddingProfile
          ? bank.embeddingProfile as Record<string, unknown>
          : {}
      );
      return {
        mode: normalizeText(String(embeddingProfile.modelId || '')) ? 'standard' : 'baseline',
        bankId: normalizeText(String(bank.bankId || '')) || undefined,
        embeddingProfileModelId: normalizeText(String(embeddingProfile.modelId || '')) || undefined,
      };
    },

    async writeDyadicObservation(input: RuntimeDyadicObservationInput): Promise<CanonicalMemoryView[]> {
      const observation = normalizeText(input.observation);
      if (!observation) {
        return [];
      }

      try {
        const session = await ensureSession({
          ...input,
          createIfMissing: input.createIfMissing !== false,
          syncDyadicContext: input.syncDyadicContext ?? true,
          syncWorldContext: input.syncWorldContext ?? true,
        });
        const dyadicUserId = normalizeText(input.dyadicUserId) || session.subjectUserId;
        const authoredBy = normalizeText(input.authorId) || session.subjectUserId;
        const timestamp = toTimestamp(now());
        const response = await session.protectedAccess.withScopes(['runtime.agent.write'], (options) => session.runtime.agentCore.writeMemory({
          context: session.context,
          agentId: normalizeText(input.agentId),
          candidates: [
            {
              canonicalClass: MemoryCanonicalClass.DYADIC,
              targetBank: {
                scope: MemoryBankScope.AGENT_DYADIC,
                owner: {
                  oneofKind: 'agentDyadic' as const,
                  agentDyadic: {
                    agentId: normalizeText(input.agentId),
                    userId: dyadicUserId,
                  },
                },
              },
              sourceEventId: normalizeText(input.sourceEventId),
              policyReason: normalizeText(input.policyReason),
              record: {
                kind: MemoryRecordKind.OBSERVATIONAL,
                canonicalClass: MemoryCanonicalClass.DYADIC,
                provenance: {
                  sourceSystem: 'desktop.agent-chat',
                  sourceEventId: normalizeText(input.sourceEventId),
                  authorId: authoredBy,
                  traceId: normalizeText(input.traceId),
                  committedAt: timestamp,
                },
                metadata: undefined,
                extensions: undefined,
                payload: {
                  oneofKind: 'observational',
                  observational: {
                    observation,
                    observedAt: timestamp,
                    sourceRef: normalizeText(input.traceId),
                  },
                },
              },
              extensions: undefined,
            },
          ],
        }, options));

        if (response.rejected.length > 0 || response.accepted.length === 0) {
          throw new Error('runtime.agentCore.writeMemory did not admit desktop dyadic memory');
        }
        return response.accepted;
      } catch (error) {
        if (isRuntimeMemoryUnavailable(error)) {
          return [];
        }
        throw error;
      }
    },

    async sendChatTrackSidecarInput(input: RuntimeChatTrackSidecarInput): Promise<void> {
      const agentId = normalizeText(input.agentId);
      const sourceEventId = normalizeText(input.sourceEventId);
      const threadId = normalizeText(input.threadId);
      const messages = Array.isArray(input.messages)
        ? input.messages
          .map((message) => ({
            role: normalizeText(message.role),
            content: normalizeText(message.content),
            ...(normalizeText(message.name) ? { name: normalizeText(message.name) } : {}),
          }))
          .filter((message) => message.role && message.content)
        : [];
      if (!agentId || !sourceEventId || !threadId || messages.length === 0) {
        throw new Error('CHAT_TRACK_SIDECAR_INPUT_INVALID');
      }

      const runtime = getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      await getProtectedAccess().withScopes(['runtime.app.send.cross_app'], (options) => runtime.app.sendMessage({
        fromAppId: runtime.appId,
        toAppId: 'runtime.agentcore',
        subjectUserId,
        messageType: 'agent.chat_track.sidecar_input.v1',
        payload: toProtoStruct({
          agent_id: agentId,
          source_event_id: sourceEventId,
          thread_id: threadId,
          messages,
        }),
        requireAck: false,
      }, options));
    },
  };
}
