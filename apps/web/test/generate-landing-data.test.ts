import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('landing data generator treats local as an admitted capabilities-only provider', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-landing-data.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /provider\(s\) in capabilities but not in catalog: \[local\]/);
  assert.match(result.stdout, /wrote 46 ADMITTED_PROVIDERS, 47 PROVIDER_CAPABILITIES/);
});
