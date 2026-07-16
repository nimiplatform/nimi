import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS } from '@nimiplatform/sdk/app';

import {
  DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE,
  DESKTOP_RUNTIME_PROTECTED_SCOPES,
  PLATFORM_RUNTIME_SESSION_DEVICE_ID,
} from '../src/shell/shared/runtime-account-contract.js';

const rendererSessionSource = readFileSync(
  new URL('../src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts', import.meta.url),
  'utf8',
);
const electronMainSource = readFileSync(new URL('../src-electron/main.ts', import.meta.url), 'utf8');

test('Desktop Runtime account contract keeps protected scopes in a single shared authority', () => {
  assert.equal(PLATFORM_RUNTIME_SESSION_DEVICE_ID, 'platform-runtime-session');
  assert.equal(DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION, 'sdk-v2');
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('ai.spend.meter'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.ai_config.read'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.ai_config.write'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.read'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.write'));
  assert.match(DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE, /^s\d+-[a-z0-9]+$/u);
  assert.equal(
    DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
    [
      'desktop-shell-runtime-account',
      DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
      DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE,
    ].join('-'),
  );
});

test('Desktop renderer consumes the shared Runtime account contract instead of local constants', () => {
  assert.match(rendererSessionSource, /from ['"]\.\.\/\.\.\/\.\.\/shared\/runtime-account-contract/u);
  assert.match(rendererSessionSource, /createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport/u);
  assert.doesNotMatch(rendererSessionSource, /createRuntimeAccountMediatedRealmTransport\s*\(/u);
  assert.doesNotMatch(rendererSessionSource, /realmBaseUrl/u);
  assert.doesNotMatch(rendererSessionSource, /const DESKTOP_RUNTIME_PROTECTED_SCOPES = \[/u);
  assert.doesNotMatch(rendererSessionSource, /function buildDesktopRuntimeProtectedScopeSignature/u);
  assert.equal(NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS.length, 9);
});

test('Desktop Electron host exposes no ordinary Runtime account metadata provider', () => {
  assert.doesNotMatch(electronMainSource, /trustedRuntimeMetadataProvider|runtime-auth\.js/u);
  assert.match(electronMainSource, /createDesktopElectronProductControlHost/u);
});
