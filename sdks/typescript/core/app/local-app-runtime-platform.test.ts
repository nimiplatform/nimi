import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenLocalAppSessionRequest,
  OpenLocalAppSessionResponse,
  RenewLocalAppSessionRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/auth.js';
import {
  createNimiLocalAppClient,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppStandardShell,
} from './local-app-runtime-platform.js';

function standardShell(operationCalls: string[]): NimiLocalAppStandardShell {
  const touched = (name: string) => async (): Promise<never> => {
    operationCalls.push(name);
    throw Object.assign(new Error(`owner adapter unavailable: ${name}`), {
      reasonCode: 'local-app-owner-unavailable',
      retryable: false,
    });
  };
  return {
    session: {
      async status() {
        return { state: 'runtime-unavailable', reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE', retryable: true };
      },
    },
    ai: { text: { generateCandidate: touched('ai.text.generateCandidate') } },
    aiConfig: { get: touched('aiConfig.get'), overwrite: touched('aiConfig.overwrite') },
    storage: {
      readJson: touched('storage.readJson'),
      writeJson: touched('storage.writeJson'),
      removeJson: touched('storage.removeJson'),
    },
    realm: { worldCore: { list: touched('realm.worldCore.list'), create: touched('realm.worldCore.create') } },
    conversation: {
      open: touched('conversation.open'),
      send: touched('conversation.send'),
      interruptTurn: touched('conversation.interruptTurn'),
      subscribe: touched('conversation.subscribe'),
      snapshot: touched('conversation.snapshot'),
    },
    agentConfigure: {
      sharedAgentAIConfigGet: touched('agentConfigure.sharedAgentAIConfigGet'),
      sharedAgentAIConfigOverwrite: touched('agentConfigure.sharedAgentAIConfigOverwrite'),
      sharedAgentAIProfilePreview: touched('agentConfigure.sharedAgentAIProfilePreview'),
      sharedAgentAIProfileApply: touched('agentConfigure.sharedAgentAIProfileApply'),
      autonomySnapshot: touched('agentConfigure.autonomySnapshot'),
      updateAutonomy: touched('agentConfigure.updateAutonomy'),
      presentationSnapshot: touched('agentConfigure.presentationSnapshot'),
      commitPresentation: touched('agentConfigure.commitPresentation'),
    },
    artifacts: { put: touched('artifacts.put'), readBytes: touched('artifacts.readBytes') },
  };
}

function isTypedUnavailable(error: unknown): boolean {
  return (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE';
}

function isTypedOwnerUnavailable(error: unknown): boolean {
  return (error as { reasonCode?: string }).reasonCode === 'local-app-owner-unavailable';
}

test('generated local-app session wire projection is posture-only', () => {
  assert.deepEqual(Object.keys(OpenLocalAppSessionRequest.create()), []);
  assert.deepEqual(Object.keys(RenewLocalAppSessionRequest.create()), []);
  assert.deepEqual(Object.keys(OpenLocalAppSessionResponse.create()).sort(), ['reasonCode', 'state']);
  const projectionSource = JSON.stringify(OpenLocalAppSessionResponse.create()).toLowerCase();
  for (const forbidden of ['subject', 'account', 'snapshot', 'generation', 'credential', 'peerproof']) {
    assert.equal(projectionSource.includes(forbidden), false);
  }
});

test('local-app client hard-cuts the access workflow namespace', () => {
  const client = createNimiLocalAppClient({ standardShell: standardShell([]) });
  assert.deepEqual(Object.keys(client).sort(), [
    'agentConfigure', 'ai', 'aiConfig', 'artifacts', 'auth', 'conversation', 'realm', 'storage',
  ]);
  assert.equal('permissions' in client, false);
});

test('local-app auth remains a separate availability projection', async () => {
  const client = createNimiLocalAppClient({ standardShell: standardShell([]) });
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'unavailable',
    sessionBound: false,
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    actionHint: 'start_fixed_runtime_service',
    retryable: true,
  });
});

test('canonical protected operations reach typed ingress and preserve owner-unavailable', async () => {
  const calls: string[] = [];
  const client = createNimiLocalAppClient({ standardShell: standardShell(calls) });
  const handle = 'runtime-agent-selector' as NimiLocalAppAgentHandle;
  const operations: Array<() => Promise<unknown>> = [
    () => client.ai.text.generateCandidate({ messages: [{ role: 'user', text: 'hello' }], temperature: 0, topP: 1, maxTokens: 1 }),
    () => client.aiConfig.get(),
    () => client.aiConfig.overwrite([]),
    () => client.storage.readJson('settings.json'),
    () => client.storage.writeJson('settings.json', {}),
    () => client.storage.removeJson('settings.json'),
    () => client.realm.worldCore.list(),
    () => client.realm.worldCore.create({ core: {}, origin: { kind: 'manual' } } as never),
    () => client.conversation.open({ agentHandle: handle }),
    () => client.conversation.send({ agentHandle: handle, conversationAnchorId: 'anchor', requestId: 'request', text: 'hello', attachments: [] }),
    () => client.conversation.interruptTurn({ agentHandle: handle, conversationAnchorId: 'anchor' }),
    () => client.conversation.subscribe({ agentHandle: handle, conversationAnchorId: 'anchor' }),
    () => client.conversation.snapshot({ agentHandle: handle, conversationAnchorId: 'anchor' }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, isTypedOwnerUnavailable);
  }
  assert.deepEqual(calls, [
    'ai.text.generateCandidate',
    'aiConfig.get',
    'aiConfig.overwrite',
    'storage.readJson',
    'storage.writeJson',
    'storage.removeJson',
    'realm.worldCore.list',
    'realm.worldCore.create',
    'conversation.open',
    'conversation.send',
    'conversation.interruptTurn',
    'conversation.subscribe',
    'conversation.snapshot',
  ]);

  await assert.rejects(
    () => client.artifacts.putArtifact({ mimeType: 'text/plain', displayName: 'note', data: new Uint8Array([1]) }),
    isTypedUnavailable,
  );
  await assert.rejects(() => client.artifacts.readArtifactBytes({ artifactId: 'artifact' }), isTypedUnavailable);
  await assert.rejects(() => client.agentConfigure.autonomySnapshot({ agentHandle: handle }), isTypedUnavailable);
  assert.equal(calls.length, operations.length);
});

test('local-app client rejects the retired host namespace instead of decoding it', () => {
  const shell = standardShell([]) as NimiLocalAppStandardShell & Record<string, unknown>;
  shell.permission = { status: async () => ({}), request: async () => ({}) };
  assert.throws(
    () => createNimiLocalAppClient({ standardShell: shell }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_REQUIRED',
  );
});
