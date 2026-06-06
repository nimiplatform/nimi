import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import { parseRuntimeLocalAgentIdentity } from './local-agent-identity.js';
import type { RuntimeCallOptions, RuntimeTransportConfig } from './types.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAuthClient,
} from './types-client-interfaces.js';

type Awaitable<T> = T | Promise<T>;

export type RuntimeAgentSmokeVerificationRuntime = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly agent: {
    readonly anchors: {
      getSnapshot(request: {
        ownerUserId: string;
        realmAgentId: string;
        localAgentRef: string;
        conversationAnchorId: string;
      }, options?: RuntimeCallOptions): Promise<{
        anchor?: {
          agentId?: unknown;
          conversationAnchorId?: unknown;
          status?: unknown;
          lastTurnId?: unknown;
          lastMessageId?: unknown;
        };
        activeTurnId?: unknown;
        activeStreamId?: unknown;
      }>;
    };
  };
  readonly health: () => Promise<{
    status?: unknown;
    reason?: unknown;
    queueDepth?: unknown;
    activeWorkflows?: unknown;
    activeInferenceJobs?: unknown;
    sampledAt?: unknown;
  }>;
};

export type RuntimeAgentSmokeVerificationSurfaceOptions = {
  getRuntime: () => RuntimeAgentSmokeVerificationRuntime;
  getSubjectUserId: () => Awaitable<string | undefined>;
  withTimeout?: <T>(label: string, task: Promise<T>, timeoutMs?: number) => Promise<T>;
  timeoutMs?: number;
};

export type RuntimeAgentSmokeConversationAnchorInput = {
  agentId: unknown;
  conversationAnchorId: unknown;
};

export type RuntimeAgentSmokeProductPathEvidence = {
  runtime_health: {
    status: unknown;
    reason: string | null;
    queue_depth: unknown;
    active_workflows: unknown;
    active_inference_jobs: unknown;
    sampled_at: string | null;
  };
  runtime_authenticated: true;
  runtime_auth_scopes: ['runtime.agent.read'];
  same_anchor: true;
  agent_id: string;
  conversation_anchor_id: string;
  subject_user_id: string;
  anchor_snapshot: {
    status: unknown;
    last_turn_id: string | null;
    active_turn_id: string | null;
    active_stream_id: string | null;
    last_message_id: string | null;
  };
  has_runtime_turn: boolean;
};

export type RuntimeAgentSmokeVerificationSurface = {
  verifyConversationAnchor(input: RuntimeAgentSmokeConversationAnchorInput): Promise<void>;
  readProductPathEvidence(input: RuntimeAgentSmokeConversationAnchorInput): Promise<RuntimeAgentSmokeProductPathEvidence>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, errorMessage: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
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

export function createRuntimeAgentSmokeVerificationSurface(
  options: RuntimeAgentSmokeVerificationSurfaceOptions,
): RuntimeAgentSmokeVerificationSurface {
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;
  const withTimeout = options.withTimeout ?? defaultTimeout;
  const timeoutMs = options.timeoutMs ?? 5_000;

  const resolveSubjectUserId = async (): Promise<string> => (
    requireText(
      await options.getSubjectUserId(),
      'runtime agent smoke verification requires authenticated subject user id',
    )
  );

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: options.getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const readAnchorSnapshot = async (input: RuntimeAgentSmokeConversationAnchorInput) => {
    const subjectUserId = await resolveSubjectUserId();
    const localAgentRef = requireText(input.agentId, 'Runtime smoke verification requires localAgentRef');
    const conversationAnchorId = requireText(
      input.conversationAnchorId,
      'Runtime smoke verification requires conversationAnchorId',
    );
    let identity: ReturnType<typeof parseRuntimeLocalAgentIdentity>;
    try {
      identity = parseRuntimeLocalAgentIdentity(localAgentRef);
    } catch {
      throw new Error('Runtime smoke verification requires localAgentRef formatted as local-agent:${ownerUserId}:${realmAgentId}');
    }
    const runtime = options.getRuntime();
    const snapshot = await withTimeout(
      'Runtime conversation anchor smoke verification',
      getProtectedAccess().withScopes(['runtime.agent.read'], (callOptions: RuntimeCallOptions) => runtime.agent.anchors.getSnapshot({
        ownerUserId: identity.ownerUserId,
        realmAgentId: identity.realmAgentId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
      }, callOptions)),
      timeoutMs,
    );
    return {
      subjectUserId,
      identity,
      conversationAnchorId,
      snapshot,
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
        withTimeout('Runtime product evidence health read', runtime.health(), timeoutMs),
      ]);
      const anchor = snapshot.anchor || null;
      const snapshotAgentId = normalizeText(anchor?.agentId);
      const snapshotAnchorId = normalizeText(anchor?.conversationAnchorId);
      const lastTurnId = normalizeText(anchor?.lastTurnId);
      const activeTurnId = normalizeText(snapshot.activeTurnId);
      const lastMessageId = normalizeText(anchor?.lastMessageId);
      if (snapshotAgentId !== identity.localAgentRef || snapshotAnchorId !== conversationAnchorId) {
        throw new Error(`Runtime anchor snapshot mismatch agent=${snapshotAgentId || 'missing'} anchor=${snapshotAnchorId || 'missing'}`);
      }
      return {
        runtime_health: {
          status: health.status,
          reason: normalizeText(health.reason) || null,
          queue_depth: health.queueDepth,
          active_workflows: health.activeWorkflows,
          active_inference_jobs: health.activeInferenceJobs,
          sampled_at: normalizeText(health.sampledAt) || null,
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
