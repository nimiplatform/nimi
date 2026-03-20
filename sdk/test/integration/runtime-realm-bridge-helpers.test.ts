import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeAuthMetadata,
  createRuntimeRealmBridgeHelpers,
  fetchRealmGrant,
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

test('fetchRealmGrant and helper bundle follow the standard typed Realm -> Runtime bridge contract', async () => {
  const capturedCalls: Array<Record<string, unknown>> = [];
  const context = {
    appId: 'app.bridge.test',
    runtime: {} as never,
    realm: {
      services: {
        RuntimeRealmGrantsService: {
          issueRuntimeRealmGrant: async (input: Record<string, unknown>) => {
            capturedCalls.push(input);
            return {
              token: 'grant-token-bridge',
              version: 'grant-version-bridge',
              expiresAt: '2026-02-28T00:00:00Z',
            };
          },
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
  assert.deepEqual(capturedCalls[0], {
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

test('fetchRealmGrant rejects missing scopes', async () => {
  const context = {
    appId: 'app.bridge.test',
    runtime: {} as never,
    realm: {
      services: {
        RuntimeRealmGrantsService: {
          issueRuntimeRealmGrant: async () => ({
            token: 'unused',
            version: 'unused',
            expiresAt: '2026-02-28T00:00:00Z',
          }),
        },
      },
    } as never,
  } as RuntimeRealmBridgeContext;

  await assert.rejects(
    async () => fetchRealmGrant(context, {
      subjectUserId: 'subject-bridge',
      scopes: [],
    }),
    (error: unknown) => String((error as Error).message) === 'scopes is required',
  );
});
