import assert from 'node:assert/strict';
import test from 'node:test';

import * as realmClient from '@nimiplatform/sdk-realm';
import {
  asNimiError,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '@nimiplatform/sdk-runtime';

import { createNimiClient } from '../src/client';

const APP_ID = 'nimi.sdk.test';

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

function createAuthorizeRequest(scopeCatalogVersion?: string) {
  return {
    domain: 'app-auth',
    appId: APP_ID,
    externalPrincipalId: 'external-app-1',
    externalPrincipalType: 2,
    subjectUserId: 'user-1',
    consentId: 'consent-1',
    consentVersion: '1.0',
    decisionAt: { seconds: '1700000000', nanos: 0 },
    policyVersion: '1.0.0',
    policyMode: 1,
    preset: 1,
    scopes: ['app.nimi.sdk.test.chat.read'],
    resourceSelectors: undefined,
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: 3600,
    scopeCatalogVersion: scopeCatalogVersion || '',
    policyOverride: false,
  };
}

test('createNimiClient configures realm and runtime clients', () => {
  const previousBase = realmClient.OpenAPI.BASE;
  const previousToken = realmClient.OpenAPI.TOKEN;
  try {
    const client = createNimiClient({
      appId: APP_ID,
      realm: {
        baseUrl: 'https://realm.nimi.local',
        accessToken: 'token-1',
      },
      runtime: {
        transport: {
          type: 'tauri-ipc',
          commandNamespace: 'runtime_bridge',
          eventNamespace: 'runtime_bridge',
        },
      },
    });

    assert.equal(client.appId, APP_ID);
    assert.ok(client.realm);
    assert.ok(client.runtime);
    assert.ok(client.scope);
    assert.equal(client.runtime?.appId, APP_ID);
    assert.equal(client.runtime?.transport.type, 'tauri-ipc');
    assert.equal(realmClient.OpenAPI.BASE, 'https://realm.nimi.local');
    assert.equal(realmClient.OpenAPI.TOKEN, 'token-1');
  } finally {
    realmClient.OpenAPI.BASE = previousBase;
    realmClient.OpenAPI.TOKEN = previousToken;
  }
});

test('createNimiClient requires appId', () => {
  let thrown: unknown = null;
  try {
    createNimiClient({
      appId: '',
      runtime: {
        transport: {
          type: 'node-grpc',
          endpoint: '127.0.0.1:46371',
        },
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, 'SDK_APP_ID_REQUIRED');
  assert.equal(nimiError.source, 'sdk');
});

test('createNimiClient requires at least one target', () => {
  let thrown: unknown = null;
  try {
    createNimiClient({
      appId: APP_ID,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, 'SDK_TARGET_REQUIRED');
  assert.equal(nimiError.source, 'sdk');
});

test('createNimiClient validates realm baseUrl when realm config is present', () => {
  let thrown: unknown = null;
  try {
    createNimiClient({
      appId: APP_ID,
      realm: {
        baseUrl: '',
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, 'SDK_REALM_BASE_URL_REQUIRED');
  assert.equal(nimiError.source, 'sdk');
});

test('scope.registerAppScopes enforces app namespace and stable catalog hash', () => {
  const client = createNimiClient({
    appId: APP_ID,
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    },
  });

  let namespaceError: unknown = null;
  try {
    client.scope.registerAppScopes({
      manifest: {
        manifestVersion: '1.0.0',
        scopes: ['app.other.chat.read'],
      },
    });
  } catch (error) {
    namespaceError = error;
  }

  assert.ok(namespaceError);
  assert.equal(
    asNimiError(namespaceError, { source: 'sdk' }).reasonCode,
    'APP_SCOPE_NAMESPACE_FORBIDDEN',
  );

  client.scope.registerAppScopes({
    manifest: {
      manifestVersion: '1.0.0',
      scopes: [
        'app.nimi.sdk.test.chat.write',
        'app.nimi.sdk.test.chat.read',
      ],
    },
  });
  const publishA = client.scope.publishCatalog();

  client.scope.registerAppScopes({
    manifest: {
      manifestVersion: '1.0.0',
      scopes: [
        'app.nimi.sdk.test.chat.read',
        'app.nimi.sdk.test.chat.write',
      ],
    },
  });
  const publishB = client.scope.publishCatalog();

  assert.equal(publishA.scopeCatalogVersion, '1.0.0');
  assert.equal(publishA.catalogHash, publishB.catalogHash);
  assert.equal(
    publishA.catalogHash,
    '1dad31ac7fcf55faeecfde63159d3d8d0edef33a9d2e3edd288d81d4a42611fb',
  );
});

test('scope + appAuth binding rejects unpublished catalogs and revoked versions', async () => {
  let invokeCount = 0;
  installNodeGrpcBridge({
    invokeUnary: async () => {
      invokeCount += 1;
      return new Uint8Array(0);
    },
    openStream: async () => {
      return {
        async *[Symbol.asyncIterator]() {
          yield new Uint8Array(0);
        },
      };
    },
    closeStream: async () => {},
  });

  try {
    const client = createNimiClient({
      appId: APP_ID,
      runtime: {
        transport: {
          type: 'node-grpc',
          endpoint: '127.0.0.1:46371',
        },
      },
    });
    const runtime = client.runtime;
    assert.ok(runtime);

    let unpublishedError: unknown = null;
    try {
      await runtime.appAuth.authorizeExternalPrincipal(createAuthorizeRequest());
    } catch (error) {
      unpublishedError = error;
    }
    assert.ok(unpublishedError);
    assert.equal(
      asNimiError(unpublishedError, { source: 'sdk' }).reasonCode,
      'APP_SCOPE_CATALOG_UNPUBLISHED',
    );
    assert.equal(invokeCount, 0);

    client.scope.registerAppScopes({
      manifest: {
        manifestVersion: '1.0.0',
        scopes: ['app.nimi.sdk.test.chat.read'],
      },
    });
    const published = client.scope.publishCatalog();
    assert.equal(published.scopeCatalogVersion, '1.0.0');

    await runtime.appAuth.authorizeExternalPrincipal(createAuthorizeRequest());
    assert.equal(invokeCount, 1);

    client.scope.revokeAppScopes({
      scopes: ['app.nimi.sdk.test.chat.read'],
    });

    let revokedError: unknown = null;
    try {
      await runtime.appAuth.authorizeExternalPrincipal(createAuthorizeRequest('1.0.0'));
    } catch (error) {
      revokedError = error;
    }
    assert.ok(revokedError);
    const revokedNimiError = asNimiError(revokedError, { source: 'sdk' });
    assert.equal(revokedNimiError.reasonCode, 'APP_SCOPE_REVOKED');
    assert.equal(
      revokedNimiError.actionHint,
      'publish_new_scope_catalog_and_reauthorize',
    );
    assert.equal(invokeCount, 1);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('scope lifecycle exposes draft/published/revoked states and next draft version', () => {
  const client = createNimiClient({
    appId: APP_ID,
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    },
  });

  const initial = client.scope.listCatalog();
  assert.equal(initial.draft, null);
  assert.equal(initial.published, null);
  assert.deepEqual(initial.appScopes, []);

  client.scope.registerAppScopes({
    manifest: {
      manifestVersion: '2.1.0',
      scopes: [
        'app.nimi.sdk.test.chat.write',
        'app.nimi.sdk.test.chat.read',
      ],
    },
  });

  const withDraft = client.scope.listCatalog();
  assert.ok(withDraft.draft);
  assert.equal(withDraft.draft?.scopeCatalogVersion, '2.1.0');
  assert.equal(withDraft.published, null);

  client.scope.publishCatalog();
  const withPublished = client.scope.listCatalog();
  assert.equal(withPublished.published?.status, 'published');
  assert.deepEqual(withPublished.appScopes, [
    'app.nimi.sdk.test.chat.read',
    'app.nimi.sdk.test.chat.write',
  ]);

  client.scope.revokeAppScopes({
    scopes: ['app.nimi.sdk.test.chat.write'],
  });
  const revoked = client.scope.listCatalog();
  assert.equal(revoked.published?.status, 'revoked');
  assert.deepEqual(revoked.revokedScopes, ['app.nimi.sdk.test.chat.write']);
  assert.equal(revoked.draft?.scopeCatalogVersion, '2.1.0-r1');
  assert.deepEqual(revoked.draft?.scopes, ['app.nimi.sdk.test.chat.read']);
});

test('scope.resolvePublishedCatalogVersion rejects unknown explicit version', () => {
  const client = createNimiClient({
    appId: APP_ID,
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    },
  });

  client.scope.registerAppScopes({
    manifest: {
      manifestVersion: '1.0.0',
      scopes: ['app.nimi.sdk.test.chat.read'],
    },
  });
  client.scope.publishCatalog();

  let thrown: unknown = null;
  try {
    client.scope.resolvePublishedCatalogVersion('9.9.9');
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown);
  const nimiError = asNimiError(thrown, { source: 'sdk' });
  assert.equal(nimiError.reasonCode, 'APP_SCOPE_CATALOG_UNPUBLISHED');
  assert.equal(nimiError.actionHint, 'publish_scope_catalog');
});
