import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ackRealmLocalAgentProvisionIntent,
  ackRealmLocalAgentTerminationIntent,
  listRealmLocalAgentProvisionIntents,
  listRealmLocalAgentTerminationIntents,
} from '../src/realm/index.js';

function createCallApi(services: Record<string, unknown>) {
  return async <T>(task: (realm: { services: Record<string, unknown> }) => Promise<T>) =>
    task({ services });
}

test('Realm local-agent intent helpers own provision list and ack service calls', async () => {
  const calls: string[] = [];
  const callApi = createCallApi({
    MeService: {
      listMyLocalAgentProvisionIntents: async () => {
        calls.push('list-provision');
        return { items: [{ id: 'provision-1', localAgentRef: 'local-agent:owner:agent' }] };
      },
      ackMyLocalAgentProvisionIntent: async (intentId: string, body: Record<string, unknown>) => {
        calls.push(`ack-provision:${intentId}:${body.outcome}`);
        return { ok: true };
      },
    },
  }) as never;

  const intents = await listRealmLocalAgentProvisionIntents(callApi);
  await ackRealmLocalAgentProvisionIntent(callApi, 'provision-1', { outcome: 'established' } as never);

  assert.deepEqual(calls, ['list-provision', 'ack-provision:provision-1:established']);
  assert.equal(intents[0]?.id, 'provision-1');
});

test('Realm local-agent intent helpers own termination list and ack service calls', async () => {
  const calls: string[] = [];
  const callApi = createCallApi({
    MeService: {
      listMyLocalAgentTerminationIntents: async () => {
        calls.push('list-termination');
        return { items: [{ id: 'termination-1', localAgentRef: 'local-agent:owner:agent' }] };
      },
      ackMyLocalAgentTerminationIntent: async (intentId: string, body: Record<string, unknown>) => {
        calls.push(`ack-termination:${intentId}:${body.outcome}`);
        return { ok: true };
      },
    },
  }) as never;

  const intents = await listRealmLocalAgentTerminationIntents(callApi);
  await ackRealmLocalAgentTerminationIntent(callApi, 'termination-1', { outcome: 'terminated' } as never);

  assert.deepEqual(calls, ['list-termination', 'ack-termination:termination-1:terminated']);
  assert.equal(intents[0]?.id, 'termination-1');
});

test('Realm local-agent intent list helpers fail closed and do not synthesize success', async () => {
  await assert.rejects(
    () => listRealmLocalAgentProvisionIntents((async () => {
      throw new Error('Realm unavailable');
    }) as never),
    /Realm unavailable/,
  );

  await assert.rejects(
    () => ackRealmLocalAgentTerminationIntent((async () => {
      throw new Error('Ack denied');
    }) as never, 'termination-1', { outcome: 'terminated' } as never),
    /Ack denied/,
  );
});
