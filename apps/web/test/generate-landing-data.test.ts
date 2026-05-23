import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('landing data generator treats local as an admitted capabilities-only provider', () => {
  const appRoot = new URL('..', import.meta.url);
  const result = spawnSync(process.execPath, ['scripts/generate-landing-data.mjs'], {
    cwd: appRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /provider\(s\) in capabilities but not in catalog: \[local\]/);
  assert.match(result.stdout, /wrote 46 ADMITTED_PROVIDERS, 47 PROVIDER_CAPABILITIES/);
  assert.match(result.stdout, /-> apps\/web\/src\/landing\/generated\/provider-capabilities\.ts/);

  const providerCapabilities = readFileSync(
    new URL('src/landing/generated/provider-capabilities.ts', appRoot),
    'utf8',
  );
  assert.match(
    providerCapabilities,
    /\*   \.nimi\/spec\/runtime\/kernel\/tables\/provider-capabilities\.yaml/,
  );
  assert.doesNotMatch(providerCapabilities, /[A-Za-z]:\\/);
});
