import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ackNimiRealmLocalAgentProvisionIntent,
  ackNimiRealmLocalAgentTerminationIntent,
  listNimiRealmLocalAgentProvisionIntents,
  listNimiRealmLocalAgentTerminationIntents,
  type NimiRealmLocalAgentIntentApiCaller,
} from './index';

test('Nimi Realm local agent intent helpers bind generated Realm localAgentIntents methods', async () => {
  const calls: string[] = [];
  const callApi: NimiRealmLocalAgentIntentApiCaller = async (task, fallbackMessage) => {
    calls.push(`fallback:${fallbackMessage || ''}`);
    return task({
      localAgentIntents: {
        async listMyLocalAgentProvisionIntents(request) {
          calls.push(`list-provision:${Object.keys(request.path).length}`);
          return { items: [{ id: 'provision-1', localAgentRef: 'local-1' }] };
        },
        async ackMyLocalAgentProvisionIntent(request) {
          calls.push(`ack-provision:${request.path.intentId}:${request.body.outcome}`);
          return { id: request.path.intentId };
        },
        async listMyLocalAgentTerminationIntents(request) {
          calls.push(`list-termination:${Object.keys(request.path).length}`);
          return { items: [{ id: 'termination-1', localAgentRef: 'local-1' }] };
        },
        async ackMyLocalAgentTerminationIntent(request) {
          calls.push(`ack-termination:${request.path.intentId}:${request.body.outcome}`);
          return { id: request.path.intentId };
        },
      },
    } as never);
  };

  const provision = await listNimiRealmLocalAgentProvisionIntents(callApi);
  assert.equal(provision[0]?.id, 'provision-1');
  await ackNimiRealmLocalAgentProvisionIntent(callApi, 'provision-1', {
    outcome: 'established',
    reasonCode: '',
    detail: '',
  });

  const termination = await listNimiRealmLocalAgentTerminationIntents(callApi);
  assert.equal(termination[0]?.id, 'termination-1');
  await ackNimiRealmLocalAgentTerminationIntent(callApi, 'termination-1', {
    outcome: 'terminated',
    reasonCode: '',
    detail: '',
  });

  assert.deepEqual(calls, [
    'fallback:拉取本地 Agent 创建意图失败',
    'list-provision:0',
    'fallback:上报本地 Agent 创建结果失败',
    'ack-provision:provision-1:established',
    'fallback:拉取本地 Agent 终止意图失败',
    'list-termination:0',
    'fallback:上报本地 Agent 终止结果失败',
    'ack-termination:termination-1:terminated',
  ]);
});
