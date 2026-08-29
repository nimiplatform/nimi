import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_RUNTIME_PROTECTED_AUTHORIZATION_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION,
  DESKTOP_RUNTIME_PROTECTED_SCOPE_SIGNATURE,
  DESKTOP_RUNTIME_PROTECTED_SCOPES,
  PLATFORM_RUNTIME_SESSION_DEVICE_ID,
} from '../src/shell/shared/runtime-account-contract.js';

test('Desktop Runtime account contract keeps protected scopes in a single shared authority', () => {
  assert.equal(PLATFORM_RUNTIME_SESSION_DEVICE_ID, 'platform-runtime-session');
  assert.equal(DESKTOP_RUNTIME_PROTECTED_SCOPE_CATALOG_VERSION, 'sdk-v2');
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('ai.spend.meter'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.ai_config.read'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.ai_config.write'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.read'));
  assert.ok(DESKTOP_RUNTIME_PROTECTED_SCOPES.includes('runtime.agent.write'));
  assert.equal(
    DESKTOP_RUNTIME_PROTECTED_SCOPES.some((scope) => scope.includes('avatar_debug')),
    false,
  );
  assert.equal(
    DESKTOP_RUNTIME_PROTECTED_SCOPES.some((scope) => scope.includes('companion_participation')),
    false,
  );
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
