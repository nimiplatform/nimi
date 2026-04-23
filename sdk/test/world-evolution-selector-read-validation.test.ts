import assert from 'node:assert/strict';
import test from 'node:test';

import { clearPlatformClient, createPlatformClient } from '../src/index.js';
import {
  createWorldEvolutionSelectorReadError,
  setRuntimeWorldEvolutionSelectorReadProvider,
  type WorldEvolutionSelectorReadProvider,
} from '../src/internal/world-evolution-selector-read.js';
import { worldEvolution as modWorldEvolution } from '../src/mod/index.js';
import { clearModSdkHost, setModSdkHost } from '../src/mod/host.js';
import { ReasonCode } from '../src/types/index.js';

function createProvider(): WorldEvolutionSelectorReadProvider {
  const executionEvent = {
    eventId: 'evt-1',
    worldId: 'world-1',
    appId: 'app-1',
    sessionId: 'session-1',
    traceId: 'trace-1',
    tick: 1,
    timestamp: '2026-04-08T00:00:00.000Z',
    eventKind: 'EXECUTION_EVENT',
    stage: 'EFFECT' as const,
    actorRefs: [{ actorId: 'actor-1', actorType: 'AGENT' }],
    causation: null,
    correlation: null,
    effectClass: 'STATE_ONLY' as const,
    reason: 'selector-read',
    evidenceRefs: [{ kind: 'event', refId: 'evt-1' }],
  };

  return {
    executionEvents: {
      read: async () => [executionEvent],
    },
    replays: {
      read: async () => [],
    },
    checkpoints: {
      read: async () => [],
    },
    supervision: {
      read: async () => [],
    },
    commitRequests: {
      read: async () => [],
    },
  };
}

test('platform worldEvolution executionEvents.read supports exact selectors', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.sdk.wee.validation.exact',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  setRuntimeWorldEvolutionSelectorReadProvider(client.runtime, createProvider());

  const result = await client.worldEvolution.executionEvents.read({ eventId: 'evt-1' });
  assert.equal(result.matchMode, 'exact');
  assert.deepEqual(result.selector, { eventId: 'evt-1' });
  assert.equal(result.matches[0]?.eventId, 'evt-1');
});

test('platform worldEvolution executionEvents.read supports anchored filters', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.sdk.wee.validation.filter',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  setRuntimeWorldEvolutionSelectorReadProvider(client.runtime, createProvider());

  const result = await client.worldEvolution.executionEvents.read({
    worldId: 'world-1',
    stage: 'EFFECT',
  });
  assert.equal(result.matchMode, 'filter');
  assert.deepEqual(result.selector, {
    worldId: 'world-1',
    stage: 'EFFECT',
  });
});

test('app and mod worldEvolution paths reject the same invalid selector category', async () => {
  clearPlatformClient();
  clearModSdkHost();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.wee.validation.parity',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const provider = createProvider();
  setRuntimeWorldEvolutionSelectorReadProvider(client.runtime, provider);
  setModSdkHost({
    worldEvolution: provider,
  } as never);

  try {
    let appErrorCategory = '';
    let modErrorCategory = '';

    await assert.rejects(
      () => client.worldEvolution.executionEvents.read({ appId: 'app-only' }),
      (error: unknown) => {
        appErrorCategory = String((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory || '');
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
        return true;
      },
    );

    await assert.rejects(
      () => modWorldEvolution.executionEvents.read({ appId: 'app-only' }),
      (error: unknown) => {
        modErrorCategory = String((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory || '');
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
        return true;
      },
    );

    assert.equal(appErrorCategory, 'INCOMPLETE_SELECTOR');
    assert.equal(modErrorCategory, 'INCOMPLETE_SELECTOR');
  } finally {
    clearModSdkHost();
  }
});

test('commitRequests.read rejects incomplete schema selector pairs', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.sdk.wee.validation.commit',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  setRuntimeWorldEvolutionSelectorReadProvider(client.runtime, {
    executionEvents: { read: async () => [] },
    replays: { read: async () => [] },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: {
      read: async () => {
        throw createWorldEvolutionSelectorReadError(
          'MISSING_REQUIRED_EVIDENCE',
          'worldEvolution.commitRequests.read',
          'missing commit evidence',
        );
      },
    },
  });

  await assert.rejects(
    () => client.worldEvolution.commitRequests.read({
      worldId: 'world-1',
      appId: 'app-1',
      sessionId: 'session-1',
      schemaId: 'schema-only',
    }),
    (error: unknown) => {
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'INCOMPLETE_SELECTOR');
      return true;
    },
  );
});

test('executionEvents.read rejects retired MEMORY_ONLY effectClass selectors', async () => {
  clearPlatformClient();
  const client = await createPlatformClient({
    appId: 'nimi.sdk.wee.validation.effect-class',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  setRuntimeWorldEvolutionSelectorReadProvider(client.runtime, createProvider());

  await assert.rejects(
    () => client.worldEvolution.executionEvents.read({
      worldId: 'world-1',
      effectClass: 'MEMORY_ONLY',
    } as never),
    (error: unknown) => {
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'INVALID_SELECTOR');
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      return true;
    },
  );
});
