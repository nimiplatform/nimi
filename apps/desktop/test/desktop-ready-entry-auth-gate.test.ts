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
const productControlBridgeSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/product-control.ts'),
  'utf8',
);
const finalizationSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/first-run-finalization.tsx'),
  'utf8',
);
const workflowSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/first-run/product-control-workflow.tsx'),
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

test('Gate 7: ordinary shell admission stays gated strictly on backend ready_for_use', () => {
  // useDesktopOrdinaryShellAdmission must not relax to any non-ready_for_use
  // projection. ready_for_use is the only state that mounts ReadyDesktopShell.
  assert.match(appRoutesSource, /projection\.state === 'ready_for_use' \? 'ready' : 'not-ready'/);
  assert.doesNotMatch(appRoutesSource, /state === 'local_ai_ready'\s*\?\s*'ready'/);
});

test('Wave 7: bridge exposes a backend-only admitProductReadyForUse request', () => {
  // The renderer requests admission; the backend admission op is the sole
  // authority that writes ready_for_use (cold-start P-COLD-016).
  assert.match(productControlBridgeSource, /export async function admitProductReadyForUse\(\): Promise<ProductControlRecordProjection>/);
  assert.match(productControlBridgeSource, /invokeChecked\('product_control_record_admit_ready_for_use', \{\}, parseProjection\)/);
  // Fails closed when the Tauri runtime is unavailable.
  assert.match(productControlBridgeSource, /product_control_record_admit_ready_for_use requires Tauri runtime/);
  // setProductFirstRunSetupState keeps ready_for_use and local_ai_ready out of
  // its Exclude<...> input type — the renderer cannot write either state.
  assert.match(
    productControlBridgeSource,
    /setProductFirstRunSetupState[\s\S]*?Exclude<ProductControlState, 'ready_for_use' \| 'local_ai_ready'/,
  );
});

test('Wave 7: first-run finalization requests admission and routes on the projection', () => {
  // At local_ai_ready the finalization surface calls the admission command and
  // feeds the returned projection back into onProjectionChange so the gate
  // re-evaluates: ready_for_use on success, earliest-failed state on failure.
  assert.match(finalizationSource, /desktopBridge\.admitProductReadyForUse\(\)/);
  assert.match(finalizationSource, /notifyProjectionChange\(next\)/);
  assert.match(finalizationSource, /next\.state !== 'ready_for_use'/);
  // Failure exposes a Retry finalization affordance.
  assert.match(finalizationSource, /data-testid="product-first-run-finalization-retry"/);
  assert.match(finalizationSource, /FirstRun\.finalizationRetry/);
  // Finalization surface shows progress only — no data-root/install-level controls.
  assert.doesNotMatch(finalizationSource, /selectProductDataRoot|setProductFirstRunInstallLevel/);
});

test('Wave 7: workflow mounts the finalization branch only at local_ai_ready', () => {
  assert.match(workflowSource, /state === 'local_ai_ready' && projection \? \(\s*<FirstRunFinalization/);
  // The Runtime materialization progress block is not rendered at local_ai_ready.
  assert.match(workflowSource, /materialization && state !== 'local_ai_ready'/);
  // Product copy keeps per-state semantics; no generic ready/done collapse.
  assert.match(workflowSource, /FirstRun\.states\.\$\{state\}\.title/);
});

test('Gate 7: anonymous E2E and macOS smoke reject ordinary chat shell', () => {
  assert.match(anonymousE2eSource, /boots into login without rendering ordinary shell/);
  assert.doesNotMatch(anonymousE2eSource, /await waitForTestId\(E2E_IDS\.mainShell\)/);
  assert.doesNotMatch(anonymousE2eSource, /await waitForTestId\(E2E_IDS\.panel\('chat'\)\)/);
  assert.match(smokeScenarioSource, /verify-anonymous-main-shell-absent/);
  assert.match(smokeScenarioSource, /verify-anonymous-chat-panel-absent/);
});
