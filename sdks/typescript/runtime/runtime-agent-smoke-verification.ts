import type {
  ConversationAnchorSnapshot,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
} from './agent-local-identity';
import {
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
} from './runtime-agent-values';
import {
  type NimiRuntimeAgentProtectedRuntime,
  type NimiRuntimeAgentScopeRunner,
  withNimiRuntimeAgentScopes,
} from './runtime-agent-protected';

type Awaitable<T> = T | Promise<T>;

export interface NimiRuntimeAgentSmokeVerificationRuntime extends NimiRuntimeAgentProtectedRuntime {
  readonly agents: {
    getConversationAnchorSnapshot(
      request: GetConversationAnchorSnapshotRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetConversationAnchorSnapshotResponse>;
  };
  health(request?: GetRuntimeHealthRequest, options?: RuntimeTypedCallOptions): Promise<GetRuntimeHealthResponse>;
}

export interface NimiRuntimeAgentSmokeVerificationSurfaceOptions {
  readonly getRuntime: () => NimiRuntimeAgentSmokeVerificationRuntime;
  readonly getSubjectUserId: () => Awaitable<string | undefined>;
  readonly withTimeout?: <T>(label: string, task: Promise<T>, timeoutMs?: number) => Promise<T>;
  readonly timeoutMs?: number;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export interface NimiRuntimeAgentSmokeConversationAnchorInput {
  readonly agentId?: unknown;
  readonly localAgentRef?: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly conversationAnchorId: unknown;
}

export interface NimiRuntimeAgentSmokeProductPathEvidence {
  readonly runtime_health: {
    readonly status: unknown;
    readonly reason: string | null;
    readonly queue_depth: unknown;
    readonly active_workflows: unknown;
    readonly active_inference_jobs: unknown;
    readonly sampled_at: string | null;
  };
  readonly runtime_authenticated: true;
  readonly runtime_auth_scopes: ['runtime.agent.read'];
  readonly same_anchor: true;
  readonly agent_id: string;
  readonly conversation_anchor_id: string;
  readonly subject_user_id: string;
  readonly anchor_snapshot: {
    readonly status: unknown;
    readonly last_turn_id: string | null;
    readonly active_turn_id: string | null;
    readonly active_stream_id: string | null;
    readonly last_message_id: string | null;
  };
  readonly has_runtime_turn: boolean;
}

export interface NimiRuntimeAgentSmokeVerificationSurface {
  verifyConversationAnchor(input: NimiRuntimeAgentSmokeConversationAnchorInput): Promise<void>;
  readProductPathEvidence(
    input: NimiRuntimeAgentSmokeConversationAnchorInput,
  ): Promise<NimiRuntimeAgentSmokeProductPathEvidence>;
}

export function createNimiRuntimeAgentSmokeVerificationSurface(
  options: NimiRuntimeAgentSmokeVerificationSurfaceOptions,
): NimiRuntimeAgentSmokeVerificationSurface {
  const withTimeout = options.withTimeout ?? defaultTimeout;
  const timeoutMs = options.timeoutMs ?? 5_000;

  const resolveSubjectUserId = async (): Promise<string> => requireText(
    await options.getSubjectUserId(),
    'Runtime Agent smoke verification requires authenticated subject user id',
    'authenticate_runtime_agent_smoke_subject',
  );

  const readAnchorSnapshot = async (input: NimiRuntimeAgentSmokeConversationAnchorInput) => {
    const runtime = options.getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const identity = projectRuntimeLocalAgentIdentity({
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef ?? input.agentId,
    });
    const conversationAnchorId = requireText(
      input.conversationAnchorId,
      'Runtime Agent smoke verification requires conversationAnchorId',
      'provide_runtime_agent_smoke_conversation_anchor_id',
    );
    const snapshot = await withTimeout(
      'Runtime Agent conversation anchor smoke verification',
      withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.read'], (callOptions) => runtime.agents.getConversationAnchorSnapshot({
        context: buildRuntimeAgentRequestContext({
          runtimeAppId: runtime.appId,
          subjectUserId,
          ownerUserId: identity.ownerUserId,
          runtimeSourceRef: identity.runtimeSourceRef,
          localAgentRef: identity.localAgentRef,
        }),
        agentId: identity.localAgentRef,
        conversationAnchorId,
      }, callOptions)),
      timeoutMs,
    );
    return {
      subjectUserId,
      identity,
      conversationAnchorId,
      snapshot: requireSnapshot(snapshot.snapshot),
    };
  };

  return {
    async verifyConversationAnchor(input) {
      await readAnchorSnapshot(input);
    },

    async readProductPathEvidence(input) {
      const runtime = options.getRuntime();
      const [{ subjectUserId, conversationAnchorId, snapshot, identity }, health] = await Promise.all([
        readAnchorSnapshot(input),
        withTimeout('Runtime Agent product evidence health read', runtime.health({}, {}), timeoutMs),
      ]);
      const anchor = snapshot.anchor || null;
      const snapshotAgentId = normalizeText(anchor?.agentId);
      const snapshotAnchorId = normalizeText(anchor?.conversationAnchorId);
      const lastTurnId = normalizeText(anchor?.lastTurnId);
      const activeTurnId = normalizeText(snapshot.activeTurnId);
      const lastMessageId = normalizeText(anchor?.lastMessageId);
      if (snapshotAgentId !== identity.localAgentRef || snapshotAnchorId !== conversationAnchorId) {
        throw smokeVerificationError(
          `Runtime Agent anchor snapshot mismatch agent=${snapshotAgentId || 'missing'} anchor=${snapshotAnchorId || 'missing'}`,
          'SDK_RUNTIME_AGENT_SMOKE_ANCHOR_MISMATCH',
          'check_runtime_agent_anchor_snapshot',
        );
      }
      return {
        runtime_health: {
          status: health.status,
          reason: normalizeText(health.reason) || null,
          queue_depth: health.queueDepth,
          active_workflows: health.activeWorkflows,
          active_inference_jobs: health.activeInferenceJobs,
          sampled_at: toNimiRuntimeIsoFromTimestamp(health.sampledAt),
        },
        runtime_authenticated: true,
        runtime_auth_scopes: ['runtime.agent.read'],
        same_anchor: true,
        agent_id: identity.localAgentRef,
        conversation_anchor_id: conversationAnchorId,
        subject_user_id: subjectUserId,
        anchor_snapshot: {
          status: anchor?.status ?? null,
          last_turn_id: lastTurnId || null,
          active_turn_id: activeTurnId || null,
          active_stream_id: normalizeText(snapshot.activeStreamId) || null,
          last_message_id: lastMessageId || null,
        },
        has_runtime_turn: Boolean(lastTurnId || activeTurnId || lastMessageId),
      };
    },
  };
}

async function defaultTimeout<T>(label: string, task: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function requireSnapshot(value: ConversationAnchorSnapshot | undefined): ConversationAnchorSnapshot {
  if (!value) {
    throw smokeVerificationError(
      'Runtime Agent smoke verification response is missing anchor snapshot',
      'SDK_RUNTIME_AGENT_SMOKE_RESPONSE_INVALID',
      'check_runtime_agent_anchor_snapshot',
    );
  }
  return value;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw smokeVerificationError(message, 'SDK_RUNTIME_AGENT_SMOKE_INPUT_INVALID', actionHint);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return normalizeNimiRuntimeAgentText(value);
}

function smokeVerificationError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}
