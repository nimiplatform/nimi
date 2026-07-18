import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const manifestText = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
const manifest = parseYaml(manifestText);

test('Zhiyu declares no public permission before an atomic permission admission', () => {
  assert.deepEqual(manifest.permissions, []);
  assert.doesNotMatch(manifestText, /declared_nimi_api_scopes|scope:|qualifier:|purpose:/);
});

test('Zhiyu local development does not claim Runtime bindings through its manifest', () => {
  assert.deepEqual(Object.keys(manifest.local_development || {}), ['electron']);
  assert.doesNotMatch(manifestText, /runtime_scoped_binding_requests|runtime\.agent\.|grant_id|operation_id|resource_ref/);
  assert.equal(manifest.local_development.electron.renderer_origin, 'http://127.0.0.1:1472');
});
