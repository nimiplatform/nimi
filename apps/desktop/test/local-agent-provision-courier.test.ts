import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Realm } from '@nimiplatform/sdk/realm';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  COURIER_POLLING_KEY,
  COURIER_POLL_INTERVAL_MS,
  runLocalAgentProvisionCourierPass,
  type LocalAgentProvisionDeliverer,
} from '../src/shell/renderer/infra/local-agent-courier/provision-courier.js';

/**
 * The courier consumes a `RealmCourierApiCaller`: `<T>(task: (realm: Realm) =>
 * Promise<T>) => Promise<T>`. The test doubles supply only the two MeService
 * provision-intent operations the courier actually calls; this alias names that
 * exact call shape so the structural double is cast once, at one boundary.
 */
type RealmCourierApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;

/**
 * R-SOC-009 / T6.2-B-courier — desktop reconciliation courier (creation side).
 *
 * The courier is pure transport: it pulls the viewer's OPEN
 * LocalAgentProvisionIntents, delivers runtime.agent.initializeAgent to the
 * loopback runtime, and acks the typed outcome. It owns no decision, holds no
 * desktop-local state, and never synthesizes success.
 */

type IntentDto = {
  id: string;
  localAgentRef: string;
  ownerUserId: string;
  realmAgentId: string;
  status: 'OPEN' | 'ACKED' | 'FAILED';
  attempts: number;
  availableAt: string;
  createdAt: string;
  ackedAt?: string | null;
};

type AckCall = { intentId: string; outcome: string; detail?: string };

function makeIntent(id: string, overrides: Partial<IntentDto> = {}): IntentDto {
  const ownerUserId = overrides.ownerUserId ?? 'owner-1';
  const realmAgentId = overrides.realmAgentId ?? `agent-${id}`;
  return {
    id,
    ownerUserId,
    realmAgentId,
    localAgentRef: `local-agent:${ownerUserId}:${realmAgentId}`,
    status: 'OPEN',
    attempts: 0,
    availableAt: '2026-05-21T00:00:00.000Z',
    createdAt: '2026-05-21T00:00:00.000Z',
    ackedAt: null,
    ...overrides,
  };
}

/**
 * A backend test double. Holds the OPEN intent list and records acks. Modelled
 * on the real R-SOC-009 backend transition: an `ackMyLocalAgentProvisionIntent`
 * with `established` removes the intent from the OPEN list; with
 * `substrate_failure` it keeps it OPEN (backoff). The courier never mutates
 * intent state directly — only the backend (this double) does.
 */
function createBackendDouble(initial: IntentDto[]) {
  let openIntents = [...initial];
  const ackCalls: AckCall[] = [];
  let listCalls = 0;

  const callApi: RealmCourierApiCaller = async <T>(task: (realm: Realm) => Promise<T>): Promise<T> => {
    const realm = {
      services: {
        MeService: {
          listMyLocalAgentProvisionIntents: async () => {
            listCalls += 1;
            return { items: openIntents.map((intent) => ({ ...intent })) };
          },
          ackMyLocalAgentProvisionIntent: async (
            intentId: string,
            body: { outcome: string; detail?: string },
          ) => {
            ackCalls.push({ intentId, outcome: body.outcome, detail: body.detail });
            if (body.outcome === 'established') {
              openIntents = openIntents.filter((intent) => intent.id !== intentId);
            }
            // substrate_failure → backend keeps it OPEN with backoff; the test
            // double leaves it in the OPEN list to model that.
            return { id: intentId, status: body.outcome === 'established' ? 'ACKED' : 'OPEN' };
          },
        },
      },
    } as unknown as Realm;
    return task(realm);
  };

  return {
    callApi,
    ackCalls,
    get listCalls() {
      return listCalls;
    },
    get openIntents() {
      return openIntents;
    },
  };
}

const noopEmit = () => {};
const getCurrentUser = () => ({ id: 'owner-1' });

describe('R-SOC-009 T6.2-B: courier pull + deliver + ack on success', () => {
  test('pulls OPEN intents, delivers initialize, and acks established', async () => {
    const backend = createBackendDouble([makeIntent('intent-a'), makeIntent('intent-b')]);
    const delivered: string[] = [];
    const deliverer: LocalAgentProvisionDeliverer = async (intent) => {
      delivered.push(intent.localAgentRef);
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.pulled, 2);
    assert.equal(result.established, 2);
    assert.equal(result.substrateFailed, 0);
    assert.equal(result.deferred, 0);
    assert.deepEqual(delivered.sort(), [
      'local-agent:owner-1:agent-intent-a',
      'local-agent:owner-1:agent-intent-b',
    ]);
    assert.equal(backend.ackCalls.length, 2);
    assert.ok(backend.ackCalls.every((call) => call.outcome === 'established'));
    assert.equal(backend.openIntents.length, 0, 'acked intents leave the OPEN list');
  });

  test('empty pull is a no-op — no initialize, no ack', async () => {
    const backend = createBackendDouble([]);
    let deliveries = 0;
    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer: async () => {
        deliveries += 1;
      },
    });
    assert.deepEqual(result, { pulled: 0, established: 0, substrateFailed: 0, deferred: 0 });
    assert.equal(deliveries, 0);
    assert.equal(backend.ackCalls.length, 0);
  });
});

describe('R-SOC-009 T6.2-B: AlreadyExists no-op converges', () => {
  test('K-AGCORE-139 already-exists typed no-op (deliverer resolves) → acks established', async () => {
    // An AgentFriend whose LocalAgent projection already exists: the production
    // deliverer treats RUNTIME_GRPC_ALREADY_EXISTS as a typed success and
    // resolves, so the courier acks `established` and the intent converges.
    const backend = createBackendDouble([makeIntent('intent-exists')]);
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      /* K-AGCORE-139 already-exists idempotent no-op success */
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.established, 1);
    assert.equal(result.deferred, 0);
    assert.equal(backend.ackCalls[0]?.outcome, 'established');
    assert.equal(backend.openIntents.length, 0, 'already-established agent converges');
  });
});

describe('R-SOC-009 T6.2-B: transport/offline failure leaves the intent OPEN', () => {
  test('runtime daemon down (RUNTIME_UNAVAILABLE) → no ack, intent stays OPEN', async () => {
    const backend = createBackendDouble([makeIntent('intent-offline')]);
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      throw createNimiError({
        message: 'runtime daemon unavailable',
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'start_runtime',
        source: 'runtime',
      });
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.pulled, 1);
    assert.equal(result.established, 0);
    assert.equal(result.substrateFailed, 0);
    assert.equal(result.deferred, 1);
    assert.equal(backend.ackCalls.length, 0, 'transport/offline failure must NOT ack');
    assert.equal(backend.openIntents.length, 1, 'intent stays OPEN for a later pass');
  });

  test('runtime bridge daemon unavailable → no ack, intent stays OPEN', async () => {
    const backend = createBackendDouble([makeIntent('intent-bridge')]);
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      throw createNimiError({
        message: 'runtime bridge daemon unavailable',
        reasonCode: ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
        actionHint: 'start_runtime',
        source: 'runtime',
      });
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.deferred, 1);
    assert.equal(backend.ackCalls.length, 0);
    assert.equal(backend.openIntents.length, 1);
  });

  test('realm unreachable on pull → whole pass is a no-op, no throw', async () => {
    const offlineCallApi: RealmCourierApiCaller = async () => {
      throw createNimiError({
        message: 'realm unavailable',
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        actionHint: 'retry_when_online',
        source: 'realm',
      });
    };
    const result = await runLocalAgentProvisionCourierPass({
      callApi: offlineCallApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer: async () => {
        throw new Error('deliverer must not run when the pull is offline');
      },
    });
    assert.deepEqual(result, { pulled: 0, established: 0, substrateFailed: 0, deferred: 0 });
  });
});

describe('R-SOC-009 T6.2-B: typed substrate failure is acked, never synthesized as success', () => {
  test('K-AGCORE-139 fail-closed substrate failure → acks substrate_failure (not established)', async () => {
    const backend = createBackendDouble([makeIntent('intent-substrate')]);
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      throw createNimiError({
        message: 'projection create failed: disk error',
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'inspect_runtime',
        source: 'runtime',
      });
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.established, 0);
    assert.equal(result.substrateFailed, 1);
    assert.equal(result.deferred, 0);
    assert.equal(backend.ackCalls.length, 1);
    assert.equal(backend.ackCalls[0]?.outcome, 'substrate_failure');
    assert.match(String(backend.ackCalls[0]?.detail), /RUNTIME_CALL_FAILED/);
    assert.equal(backend.openIntents.length, 1, 'substrate_failure keeps the intent OPEN (backoff)');
  });
});

describe('R-SOC-009 T6.2-B: statelessness — re-pulls each pass, holds no queue', () => {
  test('a second pass re-pulls from the backend; converged intents do not reappear', async () => {
    const backend = createBackendDouble([makeIntent('intent-x'), makeIntent('intent-y')]);
    const deliverer: LocalAgentProvisionDeliverer = async () => {};

    const first = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(first.established, 2);

    // Second pass: the courier holds no local queue — it re-pulls. The two
    // intents were acked established last pass, so the backend returns none.
    const second = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(second.pulled, 0);
    assert.equal(second.established, 0);
    assert.equal(backend.listCalls, 2, 'each pass issues its own list pull');
  });

  test('an intent left OPEN by an offline pass is re-delivered on the next pass', async () => {
    const backend = createBackendDouble([makeIntent('intent-retry')]);
    let runtimeUp = false;
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      if (!runtimeUp) {
        throw createNimiError({
          message: 'runtime daemon unavailable',
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'start_runtime',
          source: 'runtime',
        });
      }
    };

    const offlinePass = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(offlinePass.deferred, 1);
    assert.equal(backend.openIntents.length, 1, 'still OPEN after offline pass');

    // Runtime comes online — the next pass re-pulls the still-OPEN intent and
    // converges it. This is the long-offline / cross-device convergence guarantee.
    runtimeUp = true;
    const onlinePass = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(onlinePass.pulled, 1);
    assert.equal(onlinePass.established, 1);
    assert.equal(backend.openIntents.length, 0, 'converged on the device coming online');
  });
});

describe('R-SOC-009 T6.2-B: the courier owns no decision', () => {
  test('the courier never decides which intents exist — it delivers exactly what the backend lists', async () => {
    // The backend is the sole authority on what is OPEN. The courier delivers
    // every listed intent and nothing else; it does not filter, re-prioritize,
    // or invent intents.
    const backend = createBackendDouble([
      makeIntent('decided-by-backend-1'),
      makeIntent('decided-by-backend-2'),
      makeIntent('decided-by-backend-3'),
    ]);
    const delivered: string[] = [];
    const deliverer: LocalAgentProvisionDeliverer = async (intent) => {
      delivered.push(intent.id);
    };

    const result = await runLocalAgentProvisionCourierPass({
      callApi: backend.callApi,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });

    assert.equal(result.pulled, 3);
    assert.deepEqual(delivered.sort(), [
      'decided-by-backend-1',
      'decided-by-backend-2',
      'decided-by-backend-3',
    ]);
    // Every ack targets exactly one backend-authored intent id — the courier
    // authored no intent of its own.
    assert.deepEqual(
      backend.ackCalls.map((call) => call.intentId).sort(),
      ['decided-by-backend-1', 'decided-by-backend-2', 'decided-by-backend-3'],
    );
  });

  test('a re-delivered intent (lost ack) is safe — backend ack stays idempotent', async () => {
    // Models a lost ack POST: the intent is delivered twice across two passes.
    // K-AGCORE-139 makes the second initialize an already-exists typed no-op;
    // the backend ack is idempotent. The courier re-acks without error.
    const intent = makeIntent('intent-lost-ack');
    let firstAck = true;
    const callApiWithLostAck: RealmCourierApiCaller = async <T>(
      task: (realm: Realm) => Promise<T>,
    ): Promise<T> => {
      const realm = {
        services: {
          MeService: {
            listMyLocalAgentProvisionIntents: async () => ({ items: [{ ...intent }] }),
            ackMyLocalAgentProvisionIntent: async (
              intentId: string,
              body: { outcome: string },
            ) => {
              if (firstAck) {
                firstAck = false;
                // Ack POST is lost on the wire after the runtime initialize.
                throw createNimiError({
                  message: 'realm unavailable',
                  reasonCode: ReasonCode.REALM_UNAVAILABLE,
                  actionHint: 'retry_when_online',
                  source: 'realm',
                });
              }
              return { id: intentId, status: body.outcome === 'established' ? 'ACKED' : 'OPEN' };
            },
          },
        },
      } as unknown as Realm;
      return task(realm);
    };

    let deliveries = 0;
    const deliverer: LocalAgentProvisionDeliverer = async () => {
      deliveries += 1; // second delivery is a K-AGCORE-139 already-exists no-op
    };

    // Pass 1: initialize succeeds, ack POST is lost → intent left OPEN (deferred).
    const pass1 = await runLocalAgentProvisionCourierPass({
      callApi: callApiWithLostAck,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(pass1.deferred, 1, 'lost ack POST leaves the intent OPEN');

    // Pass 2: re-pulls the still-OPEN intent, re-delivers (no-op), re-acks.
    const pass2 = await runLocalAgentProvisionCourierPass({
      callApi: callApiWithLostAck,
      emitCourierError: noopEmit,
      getCurrentUser,
      deliverer,
    });
    assert.equal(pass2.established, 1, 're-pull re-delivers and re-acks');
    assert.equal(deliveries, 2, 'initialize delivered twice; second is the K-AGCORE-139 no-op');
  });
});

describe('R-SOC-009 T6.2-B: courier wiring constants', () => {
  test('periodic tick is registered under a stable key with a ~60s interval', () => {
    assert.equal(COURIER_POLLING_KEY, 'local-agent-provision-courier');
    assert.equal(COURIER_POLL_INTERVAL_MS, 60_000);
  });
});
