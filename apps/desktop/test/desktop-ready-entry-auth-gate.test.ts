import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appRoutesSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const loginPageSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/auth/login-page.tsx'),
  'utf8',
);
const uiSliceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts'),
  'utf8',
);
const anonymousE2eSource = readFileSync(
  resolve(import.meta.dirname, '../e2e/specs/boot.anonymous.login-screen.e2e.mjs'),
  'utf8',
);
const smokeScenarioSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke-scenarios.ts'),
  'utf8',
);

test('Gate 7: Desktop root route is guarded by auth and product ready_for_use', () => {
  assert.match(appRoutesSource, /function DesktopOrdinaryShellGate/);
  assert.ok(appRoutesSource.includes("authStatus !== 'authenticated'"));
  assert.ok(appRoutesSource.includes('<Navigate to="/login" replace />'));
  assert.match(appRoutesSource, /desktopBridge\.getProductControlRecord\(\)/);
  assert.match(appRoutesSource, /projection\.state === 'ready_for_use'/);
  assert.ok(appRoutesSource.includes('<Route path="/" element={<DesktopOrdinaryShellGate />} />'));
});

test('Gate 7: ready Desktop shell lands at Chat -> Nimi Chat', () => {
  assert.match(uiSliceSource, /activeTab:\s*'chat'/);
  assert.match(uiSliceSource, /chatMode:\s*'ai'/);
  assert.match(appRoutesSource, /function ReadyDesktopShell/);
  assert.match(appRoutesSource, /setActiveTab\('chat'\)/);
  assert.doesNotMatch(appRoutesSource, /setChatMode\('ai'\)/);
});

test('Gate 7: logged-out Desktop login no longer exposes back-to-chat or Runtime shortcuts', () => {
  assert.doesNotMatch(loginPageSource, /loginBackButton/);
  assert.doesNotMatch(loginPageSource, /backToChat/);
  assert.doesNotMatch(loginPageSource, /navigateToTab\('runtime'\)/);
});

test('Gate 7: anonymous E2E and macOS smoke reject ordinary chat shell', () => {
  assert.match(anonymousE2eSource, /boots into login without rendering ordinary shell/);
  assert.doesNotMatch(anonymousE2eSource, /await waitForTestId\(E2E_IDS\.mainShell\)/);
  assert.doesNotMatch(anonymousE2eSource, /await waitForTestId\(E2E_IDS\.panel\('chat'\)\)/);
  assert.match(smokeScenarioSource, /verify-anonymous-main-shell-absent/);
  assert.match(smokeScenarioSource, /verify-anonymous-chat-panel-absent/);
});
