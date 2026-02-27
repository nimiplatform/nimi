import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAuthMetadata,
  createRuntimeRealmBridgeHelpers,
  fetchRealmGrant,
  linkRuntimeTraceToRealmWrite,
  type RuntimeRealmBridgeContext,
} from '../../src/runtime/index.js';

test('buildRuntimeAuthMetadata maps grant token and version into runtime metadata', () => {
  const metadata = buildRuntimeAuthMetadata({
    grantToken: 'grant-token-1',
    grantVersion: 'v1',
  });

  assert.deepEqual(metadata, {
    realmGrantToken: 'grant-token-1',
    realmGrantVersion: 'v1',
  });
});

test('linkRuntimeTraceToRealmWrite injects traceId only when payload traceId is missing', () => {
  const injected = linkRuntimeTraceToRealmWrite({
    runtimeTraceId: 'trace-runtime-1',
    realmPayload: {
      content: 'hello',
    },
  });
  assert.equal(injected.traceId, 'trace-runtime-1');
  assert.equal(injected.content, 'hello');

  const kept = linkRuntimeTraceToRealmWrite({
    runtimeTraceId: 'trace-runtime-2',
    realmPayload: {
      content: 'hello',
      traceId: 'trace-already-set',
    },
  });
  assert.equal(kept.traceId, 'trace-already-set');
});

test('fetchRealmGrant and helper bundle follow explicit Realm -> Runtime bridge contract', async () => {
  const capturedCalls: Array<Record<string, unknown>> = [];
  const context = {
    appId: 'app.bridge.test',
    runtime: {} as never,
    realm: {
      raw: {
        request: async <T>(input: Record<string, unknown>): Promise<T> => {
          capturedCalls.push(input);
          return {
            token: 'grant-token-bridge',
            version: 'grant-version-bridge',
            expiresAt: '2026-02-28T00:00:00Z',
          } as T;
        },
      },
    } as never,
  } as RuntimeRealmBridgeContext;

  const directGrant = await fetchRealmGrant(context, {
    subjectUserId: 'subject-bridge',
    scopes: ['ai.text.generate'],
  });
  assert.deepEqual(directGrant, {
    token: 'grant-token-bridge',
    version: 'grant-version-bridge',
    expiresAt: '2026-02-28T00:00:00Z',
  });

  const helpers = createRuntimeRealmBridgeHelpers(context);
  const helperGrant = await helpers.fetchRealmGrant({
    subjectUserId: 'subject-bridge',
    scopes: ['ai.text.generate'],
  });
  assert.equal(helperGrant.token, 'grant-token-bridge');
  assert.equal(helperGrant.version, 'grant-version-bridge');

  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[0]?.path, '/api/creator/mods/control/grants/issue');
  assert.equal(capturedCalls[0]?.method, 'POST');
  assert.deepEqual(capturedCalls[0]?.body, {
    appId: 'app.bridge.test',
    subjectUserId: 'subject-bridge',
    scopes: ['ai.text.generate'],
  });

  const metadata = helpers.buildRuntimeAuthMetadata({
    grantToken: helperGrant.token,
    grantVersion: helperGrant.version,
  });
  assert.deepEqual(metadata, {
    realmGrantToken: 'grant-token-bridge',
    realmGrantVersion: 'grant-version-bridge',
  });
});

