import { test } from 'node:test';
import assert from 'node:assert/strict';

import { asNimiError } from '../../src/runtime/index.js';
import { createScopeModule } from '../../src/scope/index.js';

test('createScopeModule validates appId and include fallback', () => {
  let thrown: unknown = null;
  try {
    createScopeModule({ appId: '' });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown);
  assert.equal(asNimiError(thrown, { source: 'sdk' }).reasonCode, 'SDK_APP_ID_REQUIRED');

  const scope = createScopeModule({ appId: 'nimi.scope.coverage' });
  const catalog = scope.listCatalog({
    include: ['invalid' as never],
  });
  assert.equal(catalog.appId, 'nimi.scope.coverage');
  assert.equal(catalog.appScopes.length, 0);
  assert.ok(catalog.realmScopes.length > 0);
  assert.ok(catalog.runtimeScopes.length > 0);
});

test('createScopeModule enforces app binding and manifest validation', () => {
  const scope = createScopeModule({ appId: 'nimi.scope.coverage' });

  let appMismatchError: unknown = null;
  try {
    scope.listCatalog({ appId: 'other.app' });
  } catch (error) {
    appMismatchError = error;
  }
  assert.ok(appMismatchError);
  assert.equal(asNimiError(appMismatchError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_CONFLICT');

  let missingManifestVersionError: unknown = null;
  try {
    scope.registerAppScopes({
      manifest: {
        manifestVersion: '',
        scopes: ['app.nimi.scope.coverage.chat.read'],
      },
    });
  } catch (error) {
    missingManifestVersionError = error;
  }
  assert.ok(missingManifestVersionError);
  assert.equal(asNimiError(missingManifestVersionError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_MANIFEST_INVALID');

  let emptyScopesError: unknown = null;
  try {
    scope.registerAppScopes({
      manifest: {
        manifestVersion: '1.0.0',
        scopes: [],
      },
    });
  } catch (error) {
    emptyScopesError = error;
  }
  assert.ok(emptyScopesError);
  assert.equal(asNimiError(emptyScopesError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_MANIFEST_INVALID');
});

test('createScopeModule covers publish/revoke conflict branches', () => {
  const scope = createScopeModule({ appId: 'nimi.scope.coverage' });

  let revokeUnpublishedError: unknown = null;
  try {
    scope.revokeAppScopes({
      scopes: ['app.nimi.scope.coverage.chat.read'],
    });
  } catch (error) {
    revokeUnpublishedError = error;
  }
  assert.ok(revokeUnpublishedError);
  assert.equal(asNimiError(revokeUnpublishedError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_CATALOG_UNPUBLISHED');

  scope.registerAppScopes({
    manifest: {
      manifestVersion: '1.0.0',
      scopes: ['app.nimi.scope.coverage.chat.read'],
    },
  });
  scope.publishCatalog();

  scope.registerAppScopes({
    manifest: {
      manifestVersion: '1.0.0',
      scopes: ['app.nimi.scope.coverage.chat.write'],
    },
  });
  let publishConflictError: unknown = null;
  try {
    scope.publishCatalog();
  } catch (error) {
    publishConflictError = error;
  }
  assert.ok(publishConflictError);
  assert.equal(asNimiError(publishConflictError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_CONFLICT');

  let revokeConflictError: unknown = null;
  try {
    scope.revokeAppScopes({
      scopes: ['app.nimi.scope.coverage.chat.write'],
    });
  } catch (error) {
    revokeConflictError = error;
  }
  assert.ok(revokeConflictError);
  assert.equal(asNimiError(revokeConflictError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_CONFLICT');

  scope.revokeAppScopes({
    scopes: ['app.nimi.scope.coverage.chat.read'],
  });
  let revokedVersionError: unknown = null;
  try {
    scope.resolvePublishedCatalogVersion('1.0.0');
  } catch (error) {
    revokedVersionError = error;
  }
  assert.ok(revokedVersionError);
  assert.equal(asNimiError(revokedVersionError, { source: 'sdk' }).reasonCode, 'APP_SCOPE_REVOKED');
});
