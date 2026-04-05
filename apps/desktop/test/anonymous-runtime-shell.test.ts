import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const uiSliceSource = readWorkspaceFile('src/shell/renderer/app-shell/providers/ui-slice.ts');
const appRoutesSource = readWorkspaceFile('src/shell/renderer/app-shell/routes/app-routes.tsx');
const mainLayoutSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout.tsx');
const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
const mainLayoutTopbarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const loginPageSource = readWorkspaceFile('src/shell/renderer/features/auth/login-page.tsx');
const e2eIdsSource = readWorkspaceFile('src/shell/renderer/testability/e2e-ids.ts');

test('anonymous chat shell: default app tab is chat', () => {
  assert.match(uiSliceSource, /activeTab: 'chat',/);
  assert.match(uiSliceSource, /const target = state\.previousTab \|\| 'chat';/);
});

test('anonymous runtime shell: desktop router mounts main layout at root even when anonymous', () => {
  assert.match(appRoutesSource, /const isDesktopShell = flags\.mode === 'desktop';/);
  assert.match(appRoutesSource, /{isDesktopShell \? \(/);
  assert.match(appRoutesSource, /<Route path="\/" element=\{\(/);
  assert.match(appRoutesSource, /path="\/login"/);
  assert.match(appRoutesSource, /<Route path="\*" element={<Navigate to="\/" replace \/>} \/>/);
});

test('anonymous chat shell: main layout no longer forces desktop anonymous users back to runtime', () => {
  assert.doesNotMatch(mainLayoutSource, /authStatus !== 'authenticated' && activeTab !== 'runtime'/);
  assert.match(mainLayoutSource, /state: \{ returnToChat: true },/);
  assert.match(mainLayoutSource, /setActiveTab\('chat'\);/);
});

test('anonymous runtime shell: topbar exposes login action and main rail hides while anonymous', () => {
  assert.match(mainLayoutViewSource, /const isAnonymousShell = props\.authStatus !== 'authenticated';/);
  assert.match(mainLayoutViewSource, /\{hidePrimaryRail \|\| isAnonymousShell \? null : \(/);
  assert.match(mainLayoutTopbarSource, /data-testid=\{E2E_IDS\.topbarLoginButton\}/);
  assert.match(mainLayoutTopbarSource, /onClick=\{props\.onLogin\}/);
  assert.match(e2eIdsSource, /topbarLoginButton: 'topbar-login-button',/);
});

test('anonymous chat shell: login page exposes a return-to-chat button', () => {
  assert.match(loginPageSource, /data-testid=\{E2E_IDS\.loginBackButton\}/);
  assert.match(loginPageSource, /setActiveTab\('chat'\);/);
  assert.match(loginPageSource, /navigate\('\/', \{ replace: true \}\);/);
  assert.match(loginPageSource, /Auth\.backToChat/);
  assert.match(e2eIdsSource, /loginBackButton: 'login-back-button',/);
});
