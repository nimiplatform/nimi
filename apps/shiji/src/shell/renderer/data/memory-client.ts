import { getPlatformClient } from '@nimiplatform/sdk';
import {
  asNimiError,
  createRuntimeProtectedScopeHelper,
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryRecordKind,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/app-store.js';

export type AgentMemoryRecord = {
  id: string;
  content: string;
  class: string;
  createdAt: string;
};

export type WriteAgentMemoryInput = {
  agentId: string;
  learnerId: string;
  worldId: string;
  sessionId: string;
  memoryText: string;
};

const SOURCE_SYSTEM = 'nimi.shiji';
const POLICY_REASON = 'shiji_dialogue_session_summary';
const runtimeProtectedAccess = createRuntimeProtectedScopeHelper({
  runtime: getPlatformClient().runtime,
  getSubjectUserId: async () => requireSubjectUserId(),
});

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dateToTimestamp(date: Date): { seconds: string; nanos: number } {
  const ms = date.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: String(seconds), nanos };
}

function timestampToIso(timestamp?: { seconds: string; nanos: number }): string {
  if (!timestamp) {
    return new Date(0).toISOString();
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return new Date(0).toISOString();
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  if (!Number.isFinite(millis)) {
    return new Date(0).toISOString();
  }
  return new Date(millis).toISOString();
}

function requireSubjectUserId(): string {
  const subjectUserId = normalizeText(useAppStore.getState().auth.user?.id);
  if (!subjectUserId) {
    throw new Error('shiji runtime agent memory requires authenticated subject user id');
  }
  return subjectUserId;
}

function isRuntimeMemoryUnavailable(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'check_runtime_memory',
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

function summarizeMemory(view: {
  record?: {
    payload?: {
      oneofKind?: string;
      observational?: { observation?: string };
      episodic?: { summary?: string };
      semantic?: { subject?: string; predicate?: string; object?: string };
    };
  };
}): string {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'observational':
      return normalizeText(payload.observational?.observation);
    case 'episodic':
      return normalizeText(payload.episodic?.summary);
    case 'semantic':
      return [
        normalizeText(payload.semantic?.subject),
        normalizeText(payload.semantic?.predicate),
        normalizeText(payload.semantic?.object),
      ].filter(Boolean).join(' ');
    default:
      return '';
  }
}

function toAgentMemoryRecord(view: {
  canonicalClass?: MemoryCanonicalClass;
  record?: {
    memoryId?: string;
    createdAt?: { seconds: string; nanos: number };
    updatedAt?: { seconds: string; nanos: number };
    payload?: {
      oneofKind?: string;
      observational?: { observation?: string };
      episodic?: { summary?: string };
      semantic?: { subject?: string; predicate?: string; object?: string };
    };
  };
}): AgentMemoryRecord | null {
  const id = normalizeText(view.record?.memoryId);
  const content = summarizeMemory(view);
  if (!id || !content) {
    return null;
  }
  return {
    id,
    content,
    class: view.canonicalClass === MemoryCanonicalClass.DYADIC ? 'DYADIC' : 'PUBLIC_SHARED',
    createdAt: timestampToIso(view.record?.updatedAt || view.record?.createdAt),
  };
}

async function ensureRuntimeAgent(input: {
  agentId: string;
  learnerId: string;
  worldId?: string | null;
  createIfMissing: boolean;
}): Promise<{
  runtime: ReturnType<typeof getPlatformClient>['runtime'];
  context: {
    appId: string;
    subjectUserId: string;
  };
} | null> {
  const runtime = getPlatformClient().runtime;
  const subjectUserId = requireSubjectUserId();
  const context = {
    appId: runtime.appId,
    subjectUserId,
  };
  const agentId = normalizeText(input.agentId);
  try {
    await runtimeProtectedAccess.withScopes(['runtime.agent.read'], (options) => runtime.agent.getAgent({
      context,
      agentId,
    }, options));
  } catch (error) {
    const normalized = asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'check_runtime_agent',
      source: 'runtime',
    });
    if (normalized.reasonCode !== 'RUNTIME_GRPC_NOT_FOUND') {
      throw normalized;
    }
    if (!input.createIfMissing) {
      return null;
    }
    try {
      await runtimeProtectedAccess.withScopes(['runtime.agent.admin'], (options) => runtime.agent.initializeAgent({
        context,
        agentId,
        displayName: agentId,
        autonomyConfig: undefined,
        worldId: normalizeText(input.worldId),
        metadata: undefined,
      }, options));
    } catch (initError) {
      const normalizedInit = asNimiError(initError, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'initialize_runtime_agent',
        source: 'runtime',
      });
      if (normalizedInit.reasonCode !== 'RUNTIME_GRPC_ALREADY_EXISTS') {
        throw normalizedInit;
      }
    }
  }

  await runtimeProtectedAccess.withScopes(['runtime.agent.write'], (options) => runtime.agent.updateAgentState({
    context,
    agentId,
    mutations: [
      {
        mutation: {
          oneofKind: 'setDyadicContext',
          setDyadicContext: {
            userId: normalizeText(input.learnerId),
          },
        },
      },
      normalizeText(input.worldId)
        ? {
          mutation: {
            oneofKind: 'setWorldContext' as const,
            setWorldContext: {
              worldId: normalizeText(input.worldId),
            },
          },
        }
        : {
          mutation: {
            oneofKind: 'clearWorldContext' as const,
            clearWorldContext: {},
          },
        },
    ],
  }, options));

  return {
    runtime,
    context,
  };
}

export async function recallAgentMemory(agentId: string, learnerId: string): Promise<AgentMemoryRecord[]> {
  try {
    const session = await ensureRuntimeAgent({
      agentId,
      learnerId,
      createIfMissing: false,
    });
    if (!session) {
      return [];
    }

    const response = await runtimeProtectedAccess.withScopes(['runtime.agent.read'], (options) => session.runtime.agent.queryMemory({
      context: session.context,
      agentId: normalizeText(agentId),
      query: '',
      limit: 100,
      canonicalClasses: [MemoryCanonicalClass.DYADIC],
      kinds: [],
      includeInvalidated: false,
    }, options));

    return response.memories
      .map((item) => toAgentMemoryRecord(item))
      .filter((item): item is AgentMemoryRecord => Boolean(item));
  } catch (error) {
    if (isRuntimeMemoryUnavailable(error)) {
      return [];
    }
    throw error;
  }
}

export async function writeAgentMemory(input: WriteAgentMemoryInput): Promise<void> {
  const { agentId, learnerId, worldId, sessionId, memoryText } = input;
  const observation = normalizeText(memoryText);
  if (!observation) {
    return;
  }

  try {
    const session = await ensureRuntimeAgent({
      agentId,
      learnerId,
      worldId,
      createIfMissing: true,
    });
    if (!session) {
      return;
    }

    const subjectUserId = requireSubjectUserId();
    const now = new Date();
    const response = await runtimeProtectedAccess.withScopes(['runtime.agent.write'], (options) => session.runtime.agent.writeMemory({
      context: session.context,
      agentId: normalizeText(agentId),
      candidates: [
        {
          canonicalClass: MemoryCanonicalClass.DYADIC,
          targetBank: {
            scope: MemoryBankScope.AGENT_DYADIC,
            owner: {
              oneofKind: 'agentDyadic' as const,
              agentDyadic: {
                agentId: normalizeText(agentId),
                userId: normalizeText(learnerId),
              },
            },
          },
          sourceEventId: normalizeText(sessionId),
          policyReason: POLICY_REASON,
          record: {
            kind: MemoryRecordKind.OBSERVATIONAL,
            canonicalClass: MemoryCanonicalClass.DYADIC,
            provenance: {
              sourceSystem: SOURCE_SYSTEM,
              sourceEventId: normalizeText(sessionId),
              authorId: subjectUserId,
              traceId: normalizeText(sessionId),
              committedAt: dateToTimestamp(now),
            },
            metadata: undefined,
            extensions: undefined,
            payload: {
              oneofKind: 'observational',
              observational: {
                observation,
                observedAt: dateToTimestamp(now),
                sourceRef: normalizeText(sessionId),
              },
            },
          },
          extensions: undefined,
        },
      ],
    }, options));

    if (response.rejected.length > 0 || response.accepted.length === 0) {
      throw new Error('runtime.agent.writeMemory did not admit shiji dyadic memory');
    }
  } catch (error) {
    if (isRuntimeMemoryUnavailable(error)) {
      return;
    }
    throw error;
  }
}
