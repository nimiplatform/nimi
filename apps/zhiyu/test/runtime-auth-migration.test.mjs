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
  const hostAccountCallerSource = read('src-electron/runtime-account-caller.ts');
  const hostAuthSource = read('src-electron/runtime-auth.ts');
  const liveAcceptanceSource = read('test/electron-live-runtime-acceptance.mjs');

  assert.match(mainSource, /installNimiShellRuntimeBridge\(\)/);
  assert.match(mainSource, /<AuthGate>/);
  assert.match(authGateSource, /loadRuntimeAccountUser/);
  assert.match(authGateSource, /clearRuntimePlatformProjection\(\);\s*setReloadKey/s);
  assert.match(authGateSource, /<RuntimeLoginPage client=\{state\.projection\.client\}/);
  assert.match(runtimeLoginSource, /DesktopShellAuthPage/);
  assert.match(runtimeLoginSource, /createZhiyuDesktopBrowserAuthAdapter\(onReady, client\)/);
  assert.match(runtimeLoginSource, /createZhiyuRuntimeAccountBroker\(client\)/);
  assert.match(runtimeAccountAuthSource, /createRuntimeAccountDesktopBrowserAuth/);
  assert.match(runtimeAccountAuthSource, /from '@nimiplatform\/kit\/auth'/);
  assert.match(runtimeAccountAuthSource, /createStandardShellOAuthBridge/);
  assert.match(runtimeAccountAuthSource, /getRuntimeAccountCaller/);
  assert.match(runtimePlatformSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(runtimePlatformSource, /deviceId:\s*runtimeAccountDeviceId/);
  assert.match(hostAuthSource, /createZhiyuElectronRuntimeAccountCaller\(appId\)/);
  assert.match(hostAccountCallerSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(hostAccountCallerSource, /deviceId:\s*runtimeAccountDeviceId/);
  assert.match(hostAccountCallerSource, /const runtimeAccountDeviceId = `\$\{clientIdPrefix\}-local-first-party-device`/);
  assert.match(hostAuthSource, /'runtime\.agent\.delegation\.read'/);
  assert.match(hostAuthSource, /'runtime\.agent\.delegation\.write'/);
  assert.match(liveAcceptanceSource, /admitLocalFirstPartyRuntimeAccountCaller/);
  assert.match(liveAcceptanceSource, /appInstanceId:\s*`\$\{zhiyuAppId\}\.local-first-party`/);
  assert.match(liveAcceptanceSource, /deviceId:\s*'nimi-zhiyu-local-first-party-device'/);
  assert.match(liveAcceptanceSource, /'runtime\.agent\.delegation\.read'/);
  assert.match(liveAcceptanceSource, /'runtime\.agent\.delegation\.write'/);

  for (const source of [authGateSource, runtimeAccountAuthSource, runtimeLoginSource, runtimePlatformSource]) {
    assert.doesNotMatch(source, /getAccessToken|persistAccessToken|loadPersistedAccessToken|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
    assert.doesNotMatch(source, /\/api\/auth\/login|\/api\/auth\/refresh|passwordLogin\(/);
  }
});
