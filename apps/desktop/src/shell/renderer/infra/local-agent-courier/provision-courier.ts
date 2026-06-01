import { getPlatformClient } from '@nimiplatform/sdk';
import {
  ackRealmLocalAgentProvisionIntent,
  listRealmLocalAgentProvisionIntents,
  type RealmLocalAgentIntentApiCaller,
  type RealmLocalAgentProvisionIntentAckDto,
  type RealmLocalAgentProvisionIntentDto,
} from '@nimiplatform/sdk/realm';
import {
  asNimiError,
  createHostRuntimeAgentLifecycleSurface,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { isRealmOfflineError, isRuntimeOfflineError } from '@renderer/infra/offline';
import type { JsonObject } from '@nimiplatform/sdk/types';

type LocalAgentProvisionIntentDto = RealmLocalAgentProvisionIntentDto;
type LocalAgentProvisionIntentAckDto = RealmLocalAgentProvisionIntentAckDto;

type RealmCourierApiCaller = RealmLocalAgentIntentApiCaller;
type RealmCourierErrorEmitter = (action: string, error: unknown, details?: JsonObject) => void;
type CurrentUserReader = () => Record<string, unknown> | null;

/**
 * R-SOC-009 — desktop reconciliation courier (creation side).
 *
 * Pure transport. The courier pulls the viewer's `OPEN`
 * `LocalAgentProvisionIntent`s from the backend, delivers
 * `runtime.agent.initializeAgent` (the K-AGCORE-139 creation/repair lifecycle)
 * to the local loopback runtime for each intent's `localAgentRef`, and reports
 * the typed outcome to the backend ack API.
 *
 * It owns no decision: the backend authored the intent (an AgentFriend-creation
 * transaction wrote it); the courier never decides whether a LocalAgent should
 * be established, never authors the linkage, and never creates intent state. It
 * is stateless — the backend `LocalAgentProvisionIntent` table is the sole
 * durable store; the courier keeps no desktop-local intent queue and re-pulls
 * every pass.
 *
 * Failure posture (fail-close, no success synthesis):
 * - typed runtime success (incl. K-AGCORE-139 already-exists no-op) → ack `established`
 * - typed runtime substrate failure (K-AGCORE-139 fail-closed) → ack `substrate_failure`
 * - transport/offline error (runtime daemon down, realm unreachable) → do NOT
 *   ack; the intent stays `OPEN` server-side for a later pass. This is the
 *   long-offline / cross-device convergence guarantee.
 */

const COURIER_POLL_INTERVAL_MS = 60_000;
const COURIER_POLLING_KEY = 'local-agent-provision-courier';
/** Bounded per-pass delivery concurrency, symmetric with the termination courier. */
const COURIER_DELIVERY_CONCURRENCY = 3;

/**
 * K-AGCORE-139 makes `InitializeAgent` for an already-established `localAgentRef`
 * a typed idempotent no-op surfaced as this runtime gRPC code. The courier
 * treats it as a real `established` success — re-delivering a provision is safe.
 */
function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireCurrentUserId(getCurrentUser: CurrentUserReader): string {
  const id = normalizeText(getCurrentUser()?.id);
  if (!id) {
    throw new Error('local-agent provision courier requires authenticated current user id');
  }
  return id;
}

function normalizeRuntimeError(error: unknown) {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'deliver_local_agent_provision',
    source: 'runtime',
  });
}

/**
 * A transport/offline error means "the device or the loopback runtime is not
 * reachable right now" — the courier MUST NOT ack on it (R-SOC-009). The intent
 * stays `OPEN` and a later pass retries. Any other typed runtime error is a
 * K-AGCORE-139 fail-closed substrate failure and IS acked as `substrate_failure`
 * so the backend can charge an attempt and surface a needs-attention state.
 */
function isTransportOrOfflineError(error: unknown): boolean {
  if (isRuntimeOfflineError(error) || isRealmOfflineError(error)) {
    return true;
  }
  const normalized = normalizeRuntimeError(error);
  return normalized.reasonCode === ReasonCode.RUNTIME_UNAVAILABLE
    || normalized.reasonCode === ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE;
}

/**
 * Delivers the K-AGCORE-139 creation/repair for one intent to the loopback
 * runtime. Resolves on a typed runtime success (including the already-exists
 * idempotent no-op); rejects with the runtime's typed error otherwise.
 */
export type LocalAgentProvisionDeliverer = (intent: LocalAgentProvisionIntentDto) => Promise<void>;

/**
 * Production deliverer: `protectedAccess.withScopes(['runtime.agent.admin'])`
 * → `runtime.agent.initializeAgent`. The provision intent carries only the
 * `R-CHAT-016` linkage identity (`localAgentRef`, `ownerUserId`, `realmAgentId`);
 * the runtime K-AGCORE-139 creation/repair lifecycle owns the projection shape,
 * so the courier passes the realm-agent id as the display name and no world
 * binding — it transports the identity, it does not author the projection.
 *
 * A K-AGCORE-139 already-exists typed no-op (`RUNTIME_GRPC_ALREADY_EXISTS`) is a
 * real `established` success: the courier resolves on it rather than rejecting,
 * so a re-delivered intent converges idempotently.
 */
async function deliverInitializeToLocalRuntime(
  intent: LocalAgentProvisionIntentDto,
  getCurrentUser: CurrentUserReader,
): Promise<void> {
  const localAgentRef = normalizeText(intent.localAgentRef);
  const ownerUserId = normalizeText(intent.ownerUserId);
  const realmAgentId = normalizeText(intent.realmAgentId);
  if (!localAgentRef || !ownerUserId || !realmAgentId) {
    throw new Error('local-agent provision intent missing R-CHAT-016 identity fields');
  }
  const lifecycle = createHostRuntimeAgentLifecycleSurface({
    getRuntime: () => getPlatformClient().runtime,
    getSubjectUserId: () => requireCurrentUserId(getCurrentUser),
  });
  await lifecycle.initializeLocalAgent({
    localAgentRef,
    ownerUserId,
    realmAgentId,
    displayName: realmAgentId,
  });
}

type CourierDelivery =
  | { kind: 'acked'; intentId: string; outcome: LocalAgentProvisionIntentAckDto['outcome'] }
  | { kind: 'deferred'; intentId: string; reasonCode: string };

export type LocalAgentProvisionCourierPassResult = {
  /** Intents returned by the viewer-scoped list this pass. */
  pulled: number;
  /** Intents acked `established` (typed runtime success incl. already-exists no-op). */
  established: number;
  /** Intents acked `substrate_failure` (typed K-AGCORE-139 fail-closed). */
  substrateFailed: number;
  /** Intents left `OPEN` because the runtime/realm was unreachable. */
  deferred: number;
};

/**
 * Deliver one intent: initialize via the loopback runtime, then ack the typed
 * outcome to the backend. The courier never mutates intent state directly — it
 * reports an outcome and the backend owns the `OPEN → ACKED` / backoff / `FAILED`
 * transition.
 */
async function deliverIntent(input: {
  intent: LocalAgentProvisionIntentDto;
  callApi: RealmCourierApiCaller;
  deliverer: LocalAgentProvisionDeliverer;
}): Promise<CourierDelivery> {
  const { intent, callApi, deliverer } = input;

  let ackBody: LocalAgentProvisionIntentAckDto;
  try {
    // K-AGCORE-139 creation/repair. An already-established ref is a typed
    // no-op success, so a re-delivered intent is safe to re-ack.
    await deliverer(intent);
    ackBody = { outcome: 'established' };
  } catch (error) {
    if (isTransportOrOfflineError(error)) {
      // Do NOT ack — leave the intent OPEN for a later pass (R-SOC-009).
      return { kind: 'deferred', intentId: intent.id, reasonCode: normalizeRuntimeError(error).reasonCode };
    }
    // Typed K-AGCORE-139 fail-closed substrate failure — report it so the
    // backend charges an attempt; never synthesize success.
    const normalized = normalizeRuntimeError(error);
    ackBody = {
      outcome: 'substrate_failure',
      detail: `${normalized.reasonCode}: ${normalized.message}`.slice(0, 1000),
    };
  }

  // Report the typed outcome. If the ack POST itself fails on a
  // transport/offline error, the intent stays OPEN server-side (the runtime
  // initialize may have happened, but K-AGCORE-139 makes a re-delivery an
  // already-exists no-op, so the next pass re-acks idempotently).
  await ackRealmLocalAgentProvisionIntent(callApi, intent.id, ackBody);
  return { kind: 'acked', intentId: intent.id, outcome: ackBody.outcome };
}

/**
 * Run one stateless courier pass: pull the viewer's OPEN intents, deliver each
 * initialize with bounded concurrency, ack the typed outcomes. Returns a
 * per-pass summary for telemetry/tests; it drives no UI state.
 *
 * `deliverer` is injectable purely for tests; production callers omit it and
 * the courier uses the real `protectedAccess` + `runtime.agent.initializeAgent`
 * loopback delivery path.
 */
export async function runLocalAgentProvisionCourierPass(input: {
  callApi: RealmCourierApiCaller;
  emitCourierError: RealmCourierErrorEmitter;
  getCurrentUser: CurrentUserReader;
  deliverer?: LocalAgentProvisionDeliverer;
}): Promise<LocalAgentProvisionCourierPassResult> {
  const { callApi, emitCourierError, getCurrentUser } = input;
  const deliverer: LocalAgentProvisionDeliverer = input.deliverer
    ?? ((intent) => deliverInitializeToLocalRuntime(intent, getCurrentUser));
  const empty: LocalAgentProvisionCourierPassResult = {
    pulled: 0,
    established: 0,
    substrateFailed: 0,
    deferred: 0,
  };

  let intents: LocalAgentProvisionIntentDto[];
  try {
    intents = await listRealmLocalAgentProvisionIntents(callApi);
  } catch (error) {
    if (isRealmOfflineError(error)) {
      // Realm unreachable — the pass is a no-op; intents stay OPEN server-side
      // and the next tick / next startup retries. No desktop-local queue.
      return empty;
    }
    emitCourierError('local-agent-provision-courier-pull', error);
    throw error;
  }

  if (intents.length === 0) {
    return empty;
  }

  const result: LocalAgentProvisionCourierPassResult = { ...empty, pulled: intents.length };
  const queue = [...intents];

  const worker = async (): Promise<void> => {
    for (;;) {
      const intent = queue.shift();
      if (!intent) {
        return;
      }
      try {
        const delivery = await deliverIntent({ intent, callApi, deliverer });
        if (delivery.kind === 'deferred') {
          result.deferred += 1;
        } else if (delivery.outcome === 'established') {
          result.established += 1;
        } else {
          result.substrateFailed += 1;
        }
      } catch (error) {
        // A transport/offline failure on the ack POST (or a malformed intent)
        // leaves the intent OPEN — count it deferred, do not abort the pass.
        result.deferred += 1;
        emitCourierError('local-agent-provision-courier-deliver', error, {
          intentId: intent.id,
          localAgentRef: intent.localAgentRef,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(COURIER_DELIVERY_CONCURRENCY, queue.length) }, () => worker()),
  );
  return result;
}

export { COURIER_POLL_INTERVAL_MS, COURIER_POLLING_KEY };
