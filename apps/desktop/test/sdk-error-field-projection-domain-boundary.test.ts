import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Nimi error field projection is migrated from Desktop runtime telemetry to SDK types', () => {
  const realmApi = read('apps/desktop/src/shell/renderer/infra/realm/realm-api.ts');
  const profilePrivateState = read('apps/desktop/src/shell/renderer/features/relationship/profile-private-state.ts');

  assert.match(realmApi, /extractNimiErrorFields/);
  assert.match(realmApi, /normalizeApiError/);
  assert.match(realmApi, /from '@nimiplatform\/sdk\/types'/);
  assert.match(profilePrivateState, /extractNimiErrorFields/);

  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/desktop/src/runtime/telemetry/error-fields.ts')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'apps/desktop/src/runtime/net/error-normalize.ts')), false);
  assert.doesNotMatch(realmApi, /@runtime\/telemetry\/error-fields/);
  assert.doesNotMatch(realmApi, /@runtime\/net\/error-normalize/);
  assert.doesNotMatch(profilePrivateState, /@runtime\/telemetry\/error-fields/);
});
