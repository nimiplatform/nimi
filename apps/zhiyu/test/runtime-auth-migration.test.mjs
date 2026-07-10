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
  const liveAcceptanceSource = read('test/scenario/run-context-helpers.mjs');

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
  assert.match(hostAuthSource, /createZhiyuElectronRuntimeAccountCaller\(appId\)/);
  assert.match(hostAccountCallerSource, /createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(hostAccountCallerSource, /deviceId:\s*runtimeAccountDeviceId/);
  assert.match(hostAccountCallerSource, /const runtimeAccountDeviceId = `\$\{clientIdPrefix\}-local-first-party-device`/);
  assert.match(hostAuthSource, /'runtime\.agent\.delegation\.read'/);
  assert.match(hostAuthSource, /'runtime\.agent\.delegation\.write'/);
  assert.match(hostAuthSource, /'runtime\.agent\.autonomy\.write'/);
  assert.match(hostAuthSource, /'account\.session\.read'/);
  assert.match(hostAuthSource, /'data\.scope\.read#realm\.worlds\.read-probe'/);
  assert.match(hostAuthSource, /capabilities:\s*\[\.\.\.runtimeRegistrationCapabilities\]/);
  assert.match(hostAuthSource, /appSession:\s*\{[\s\S]*appInstanceId:\s*`\$\{appId\}\.local-first-party`[\s\S]*deviceId:\s*`\$\{clientIdPrefix\}-local-first-party-device`/);
  assert.doesNotMatch(hostAuthSource, /platform-runtime-session/);
  assert.match(liveAcceptanceSource, /admitLocalFirstPartyRuntimeAccountCaller/);
  assert.match(liveAcceptanceSource, /appInstanceId:\s*`\$\{zhiyuAppId\}\.scenario-suite`/);
  assert.match(liveAcceptanceSource, /deviceId:\s*'nimi-zhiyu-scenario-suite-device'/);
  assert.match(liveAcceptanceSource, /'runtime\.agent\.delegation\.read'/);
  assert.match(liveAcceptanceSource, /'runtime\.agent\.delegation\.write'/);
  assert.match(liveAcceptanceSource, /'runtime\.agent\.autonomy\.write'/);

  for (const source of [authGateSource, runtimeAccountAuthSource, runtimeLoginSource, runtimePlatformSource]) {
    assert.doesNotMatch(source, /getAccessToken|persistAccessToken|loadPersistedAccessToken|localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(source, /runtime\/internal|apps\/desktop/);
    assert.doesNotMatch(source, /\/api\/auth\/login|\/api\/auth\/refresh|passwordLogin\(/);
  }
});
