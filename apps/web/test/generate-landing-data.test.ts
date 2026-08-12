import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

test('landing data generator treats local as an admitted capabilities-only provider', () => {
  const appRoot = new URL('..', import.meta.url);
  const providerCatalog = parseYaml(
    readFileSync(new URL('../../config/runtime-provider-catalog.yaml', appRoot), 'utf8'),
  );
  const providerCapabilitiesSource = parseYaml(
    readFileSync(
      new URL('../../config/runtime-provider-capabilities.yaml', appRoot),
      'utf8',
    ),
  );
  const catalogProviders = providerCatalog.providers.map((row: { provider: string }) => row.provider);
  const capabilityProviders = providerCapabilitiesSource.providers.map(
    (row: { provider: string }) => row.provider,
  );

  assert.equal(catalogProviders.includes('local'), false);
  assert.equal(capabilityProviders.includes('local'), true);

  const result = spawnSync(process.execPath, ['scripts/generate-landing-data.mjs', '--check'], {
    cwd: appRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /provider\(s\) in capabilities but not in catalog: \[local\]/);
  assert.match(result.stdout, /generated artifacts current/);

  const providerCapabilities = readFileSync(
    new URL('src/landing/generated/provider-capabilities.ts', appRoot),
    'utf8',
  );
  assert.match(
    providerCapabilities,
    /\*   config\/runtime-provider-capabilities\.yaml/,
  );
  assert.doesNotMatch(providerCapabilities, /[A-Za-z]:\\/);

  const worldLabsRow = providerCapabilities.match(
    /provider: "worldlabs"[\s\S]*?\n  },/,
  )?.[0];
  assert.ok(worldLabsRow, 'generated provider projection must retain the WorldLabs inventory row');
  assert.doesNotMatch(
    worldLabsRow,
    /world\.generate/,
    'deferred world.generate must not be projected as an active public provider claim',
  );
  assert.match(
    providerCapabilities,
    /\| "world\.generate"/,
    'withdrawing the public claim must not delete the canonical contract vocabulary',
  );
});
