import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const runtimeBootstrapSource = source(
  '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts',
);
const desktopAuthAdapterSource = source(
  '../src/shell/renderer/features/auth/desktop-auth-adapter.ts',
);
const desktopBridgeSource = source(
  '../src/shell/renderer/bridge/runtime-bridge.ts',
);
const protectedCarrierSource = source(
  '../../../kit/shell/protected-local/src/carrier.rs',
);
const tauriCapabilitiesSource = source(
  '../../../kit/shell/tauri/src/capabilities/mod.rs',
);
const desktopBootstrapHostSource = source(
  '../src-tauri/src/main_parts/app_bootstrap.rs',
);

test('Desktop account status uses one exact native carrier operation', () => {
  assert.match(protectedCarrierSource, /fn get_account_session_status\(/);
  assert.match(tauriCapabilitiesSource, /fn runtime_account_session_status\(\s*\)/s);
  assert.match(desktopBootstrapHostSource, /runtime_account_session_status/);
  assert.match(desktopBridgeSource, /getRuntimeAccountSessionStatus/);
});

test('renderer account status cannot select caller or generic Runtime method', () => {
  assert.match(runtimeBootstrapSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.match(desktopAuthAdapterSource, /desktopBridge\.getRuntimeAccountSessionStatus\(\)/);
  assert.doesNotMatch(
    runtimeBootstrapSource,
    /accountRuntime\.account\.getAccountSessionStatus|createNimiDesktopShellRuntimeAccountCaller/,
  );
  assert.doesNotMatch(
    desktopAuthAdapterSource,
    /getDesktopAccountRuntime\(\)\.account\.getAccountSessionStatus/,
  );
  assert.ok(
    runtimeBootstrapSource.indexOf('desktopBridge.getRuntimeAccountSessionStatus()')
      < runtimeBootstrapSource.indexOf('if (runtimeUnavailable) {'),
    'protected account status must not depend on generic daemon readiness',
  );
});

test('renderer-safe account projection contains no protected material', () => {
  const combined = [protectedCarrierSource, tauriCapabilitiesSource].join('\n');
  assert.match(combined, /DesktopAccountSessionStatus/);
  assert.doesNotMatch(
    combined,
    /DesktopAccount(?:SessionStatus|Projection)[\s\S]{0,500}\b(?:access_token|refresh_token|session_id|session_token|ticket|credential)\b/i,
  );
});
