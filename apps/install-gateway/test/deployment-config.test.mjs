import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deploymentConfig } from '../scripts/prepare-deployment.mjs';

const current = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('version publication preserves the Worker target and assets without reconciling routes', () => {
  const config = deploymentConfig(current);
  assert.equal(config.name, current.name);
  assert.equal(config.compatibility_date, current.compatibility_date);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.assets, { ...current.assets, directory: 'assets' });
  assert.equal(config.main, 'worker/index.js');
  assert.equal(config.no_bundle, true);
});

test('an artifact cannot make the credentialed runner execute a build command or environment hook', () => {
  for (const field of ['build', 'env', 'site', 'unsafe']) {
    assert.throws(() => deploymentConfig({ ...current, [field]: { command: 'unexpected-command' } }));
  }
  assert.throws(() => deploymentConfig({ ...current, main: '../../outside.js' }));
  assert.throws(() => deploymentConfig({ ...current, name: 'another-worker' }));
  assert.throws(() => deploymentConfig({ ...current, assets: { ...current.assets, directory: '../../outside' } }));
});
