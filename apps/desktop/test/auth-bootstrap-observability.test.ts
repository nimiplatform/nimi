import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const runtimeBootstrapSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts', import.meta.url),
  'utf8',
);

const runtimeBootstrapAuthSource = readFileSync(
  new URL('../src/shell/renderer/infra/bootstrap/runtime-bootstrap-auth.ts', import.meta.url),
  'utf8',
);

test('desktop bootstrap reads Runtime account projection instead of shared auth-session truth', () => {
  assert.match(runtimeBootstrapSource, /createLocalFirstPartyRuntimePlatformClient\(/);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccountSessionStatus\(\{/);
  assert.match(runtimeBootstrapSource, /runtime\.account\.getAccessToken\(\{/);
  assert.match(runtimeBootstrapSource, /accessTokenProvider: async \(\) => \{/);
  assert.doesNotMatch(runtimeBootstrapSource, /bootstrapAuthSession\(/);
  assert.doesNotMatch(runtimeBootstrapSource, /resolvedBootstrapAuthSession/);
});

test('retired desktop bootstrap auth helper is hard-blocked', () => {
  assert.match(runtimeBootstrapAuthSource, /RuntimeAccountService owns local account truth/);
  assert.doesNotMatch(runtimeBootstrapAuthSource, /persistSharedDesktopSession/);
  assert.doesNotMatch(runtimeBootstrapAuthSource, /dataSync\.loadCurrentUser/);
});
