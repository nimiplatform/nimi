import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('Windows protected E2E Runtime is a separately tagged and signed service fixture', () => {
  const build = read('./build-windows-protected-e2e.mjs');
  const installer = read('./install-windows-protected-e2e.ps1');
  const signing = read('./lib/windows-dev-signing.mjs');
  assert.match(build, /nimi_runtime_e2e/);
  assert.match(build, /WindowsRuntimeSignerCertSHA256/);
  assert.match(build, /signWindowsDevFiles/);
  assert.match(signing, /windows-dev-signing\.ps1/);
  assert.match(installer, /NimiRuntimeE2E/);
  assert.match(installer, /sidtype[\s\S]*restricted/i);
  assert.match(installer, /NT SERVICE\\NimiRuntimeE2E/);
  assert.match(installer, /ProgramData[\s\S]*Nimi[\s\S]*Runtime[\s\S]*E2E/);
  assert.match(installer, /sc\.exe @Arguments 2>&1/);
  assert.match(installer, /sc\.exe exit \$exitCode/);
  assert.match(installer, /New-Service[\s\S]*-BinaryPathName \$BinaryPathName/);
  assert.match(installer, /Invoke-CimMethod[\s\S]*-MethodName Change/);
  assert.ok(installer.includes('SERVICE_EXIT_CODE') && installer.includes('runtimeStartupStage'));
  assert.match(installer, /42522 = 'principal-token-user'/);
  assert.match(installer, /ContainsKey\(\$stageKey\)/);
  assert.doesNotMatch(installer, /Invoke-ServiceControl -Arguments @\('(?:create|config)'/);
  assert.doesNotMatch(installer, /sc(?:\.exe)?\s+(?:delete|stop)\s+NimiRuntime(?:\s|$)/i);
  const validationRecovery = installer.indexOf("'actions=', 'none/0'");
  const start = installer.indexOf("@('start', $ServiceName)");
  const durableRecovery = installer.indexOf("'actions=', 'restart/2000/restart/5000/none/0'");
  assert.ok(validationRecovery > 0 && validationRecovery < start);
  assert.ok(start < durableRecovery);
});

test('Windows E2E carriers use a feature-gated fixed service, pipes, and signer', () => {
  const protectedCargo = read('../kit/shell/protected-local/Cargo.toml');
  const nodeCargo = read('../kit/shell/protected-local-node/Cargo.toml');
  const tauriCargo = read('../kit/shell/tauri/Cargo.toml');
  const desktopCargo = read('../apps/desktop/src-tauri/Cargo.toml');
  const service = read('../kit/shell/protected-local/src/windows_service_control.rs');
  const installed = read('../kit/shell/protected-local/src/windows_installed_session.rs');
  const peer = read('../kit/shell/protected-local/src/windows_peer_trust.rs');

  assert.match(protectedCargo, /windows-e2e-fixture\s*=\s*\[\]/);
  assert.match(nodeCargo, /windows-e2e-fixture[\s\S]*nimi-shell-protected-local\/windows-e2e-fixture/);
  assert.match(tauriCargo, /windows-e2e-fixture[\s\S]*nimi-shell-protected-local\/windows-e2e-fixture/);
  assert.match(desktopCargo, /protected-local-e2e-fixture[\s\S]*nimi-shell-tauri\/windows-e2e-fixture/);
  assert.match(service, /NimiRuntimeE2E/);
  assert.match(service, /nimi-runtime-e2e-protected-v1/);
  assert.match(installed, /nimi-runtime-e2e-installed-v1/);
  assert.match(peer, /NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256/);
});

test('Desktop and Node fixture launchers build the E2E carrier without changing app-owned commands', () => {
  const protectedDesktopRunner = read('../apps/desktop/scripts/run-protected-e2e-desktop.mjs');
  const desktopRunner = read('../apps/desktop/scripts/tauri-dev-runner.mjs');
  const nodeBuilder = read('../kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs');
  const signing = read('./lib/windows-dev-signing.mjs');
  const packageJson = JSON.parse(read('../package.json'));

  assert.match(desktopRunner, /protected-local-e2e-fixture/);
  assert.match(desktopRunner, /signWindowsDevFiles/);
  assert.match(protectedDesktopRunner, /build-windows-x64-package\.mjs/);
  assert.match(protectedDesktopRunner, /--e2e-fixture/);
  assert.match(signing, /windows-dev-signing\.ps1/);
  assert.match(nodeBuilder, /--e2e-fixture/);
  assert.match(nodeBuilder, /windows-e2e-fixture/);
  assert.equal(typeof packageJson.scripts['build:windows-protected-e2e'], 'string');
  assert.equal(typeof packageJson.scripts['install:windows-protected-e2e'], 'string');
  assert.equal(typeof packageJson.scripts['dev:desktop:protected-e2e'], 'string');
});
