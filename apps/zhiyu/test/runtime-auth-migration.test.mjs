import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function assertExists(relativePath) {
  assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
}

test('zhiyu runtime auth migrates to shared SDK/Kit account gate surfaces', () => {
  for (const relativePath of [
    'src/shell/auth/auth-gate.tsx',
    'src/shell/auth/runtime-account-auth.ts',
    'src/shell/auth/runtime-login-page.tsx',
    'src/shell/auth/runtime-platform.ts',
  ]) {
    assertExists(relativePath);
  }

  const mainSource = read('src/main.tsx');
  const authGateSource = read('src/shell/auth/auth-gate.tsx');
  const runtimeAccountAuthSource = read('src/shell/auth/runtime-account-auth.ts');
  const runtimeLoginSource = read('src/shell/auth/runtime-login-page.tsx');
  const runtimePlatformSource = read('src/shell/auth/runtime-platform.ts');
  const electronMainSource = read('src-electron/main.ts');

  assert.match(mainSource, /installNimiShellRuntimeBridge\(\)/);
  assert.match(mainSource, /<AuthGate>/);
  assert.match(authGateSource, /loadRuntimeAccountUser/);
  assert.match(authGateSource, /clearRuntimePlatformProjection\(\);\s*setReloadKey/s);
  assert.match(authGateSource, /<RuntimeLoginPage[^>]*onRetry=\{retry\}/);
  assert.doesNotMatch(runtimeLoginSource, /DesktopShellAuthPage|runtimeAccountBroker|oauth/);
  assert.match(runtimeLoginSource, /账户操作仅由 Nimi Desktop 提供/);
  assert.doesNotMatch(runtimeAccountAuthSource, /createRuntimeAccountDesktopBrowserAuth|@nimiplatform\/kit\/auth|createStandardShellOAuthBridge/);
  assert.match(runtimeAccountAuthSource, /getRuntimeAccountCaller/);
  assert.doesNotMatch(runtimeAccountAuthSource, /beginLogin|completeLogin|logout|switchAccount|refreshAccountSession|getAccessToken/);
  assert.match(runtimePlatformSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(runtimePlatformSource, /deviceId:\s*runtimeAccountDeviceId/);
  assert.match(runtimePlatformSource, /export const appTitle = '织羽 Zhiyu'/);
  assert.equal(existsSync(path.join(root, 'src-electron/runtime-account-caller.ts')), false);
  assert.doesNotMatch(electronMainSource, /trustedRuntimeMetadataProvider|runtime-auth\.js|registerNimiElectronRuntimeBridge|NIMI_RUNTIME_GRPC_ADDR|runtimeEndpoint/);
  assert.match(electronMainSource, /registerNimiElectronAppBridge/);

  for (const source of [authGateSource, runtimeAccountAuthSource, runtimeLoginSource, runtimePlatformSource]) {
    assert.doesNotMatch(source, /getAccessToken|persistAccessToken|loadPersistedAccessToken|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
    assert.doesNotMatch(source, /\/api\/auth\/login|\/api\/auth\/refresh|passwordLogin\(/);
  }
});
