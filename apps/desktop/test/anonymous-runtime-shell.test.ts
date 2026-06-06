import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const uiSliceSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/ui-slice.ts');
const appRoutesSource = readWorkspaceFile('src/shell/renderer/app-shell/routes/app-routes.tsx');
const loginPageSource = readWorkspaceFile('src/shell/renderer/features/auth/login-page.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');

test('Gate 7 ready entry: default app tab is Chat', () => {
  assert.match(uiSliceSource, /activeTab: 'chat',/);
  assert.match(uiSliceSource, /const target = state\.previousTab \|\| 'chat';/);
});

test('Gate 7 ready entry: desktop router gates root ordinary shell', () => {
  assert.match(appRoutesSource, /const isDesktopShell = flags\.mode === 'desktop';/);
  assert.match(appRoutesSource, /{isDesktopShell \? \(/);
  assert.match(appRoutesSource, /function DesktopOrdinaryShellGate/);
  // Wave 1 route-admission single-point: the gate routes the anonymous
  // renderer to /login via an imperative navigate inside an effect rather
  // than render-time `<Navigate>`. Render-time `<Navigate>` re-fires
  // history.replaceState on every gate re-render (react-router uses a
  // no-deps effect), which is what tripped the Electron throttle when
  // paired with LoginPage's reverse-Navigate.
  assert.match(appRoutesSource, /if \(authStatus === 'anonymous'\) \{\s*navigate\('\/login', \{ replace: true \}\);/);
  assert.match(appRoutesSource, /const decision = projectNimiProductControlAdmission\(projection\.state\);/);
  assert.ok(appRoutesSource.includes('<Route path="/" element={<DesktopOrdinaryShellGate />} />'));
  assert.match(appRoutesSource, /path="\/login"/);
  assert.match(appRoutesSource, /<Route path="\*" element={<Navigate to="\/" replace \/>} \/>/);
});

test('Gate 7 ready entry: root gate consumes product control readiness', () => {
  assert.match(appRoutesSource, /desktopBridge\.getProductControlRecord\(\)/);
  assert.match(appRoutesSource, /const decision = projectNimiProductControlAdmission\(projection\.state\);/);
  assert.match(appRoutesSource, /<DesktopFirstRunGate onReadyForUse=\{\(\) => setFirstRunReady\(true\)\} \/>/);
});

test('Gate 7 ready entry: legacy topbar login id remains a selector only', () => {
  assert.match(e2eIdsSource, /topbarLoginButton: 'topbar-login-button',/);
});

test('Gate 7 ready entry: login page does not expose return-to-chat', () => {
  assert.doesNotMatch(loginPageSource, /data-testid=\{E2E_IDS\.loginBackButton\}/);
  assert.doesNotMatch(loginPageSource, /setActiveTab\('chat'\);/);
  assert.doesNotMatch(loginPageSource, /Auth\.backToChat/);
  assert.match(e2eIdsSource, /loginBackButton: 'login-back-button',/);
});
