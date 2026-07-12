import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateInteractivePeerResult } from './check-windows-protected-e2e-peer.mjs';
import { candidateCommands } from './check-windows-protected-e2e-candidate.mjs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

function powershellEncodedCommand(source) {
  return Buffer.from(source, 'utf16le').toString('base64');
}

test('Windows protected E2E Runtime is a separately tagged and signed service fixture', () => {
  const build = read('./build-windows-protected-e2e.mjs');
  const installer = read('./install-windows-protected-e2e.ps1');
  const fileLockDiagnostics = read('./lib/windows-file-lock-diagnostics.ps1');
  const serviceGate = read('./check-windows-protected-e2e-service.mjs');
  const signing = read('./lib/windows-dev-signing.mjs');
  const pipe = read('../runtime/internal/protectedlocal/windows_pipe_windows.go');
  const activeSession = read('../runtime/internal/protectedlocal/windows_active_session_windows.go');
  const process = read('../runtime/internal/protectedlocal/windows_process_windows.go');
  const processPrincipal = read('../runtime/internal/protectedlocal/windows_principal_windows.go');
  const tokenSecurity = read('../runtime/internal/protectedlocal/windows_token_security_windows.go');
  const grpcStatus = read('../kit/shell/protected-local/src/grpc_status.rs');
  const localDevelopmentContract = read('../kit/shell/protected-local/src/local_development.rs');
  const localDevelopmentProjection = read('../kit/shell/protected-local/src/windows_local_development.rs');
  const runtimeServiceControl = read('../kit/shell/tauri/src/runtime_bridge/service_control.rs');
  const desktopLocalDevelopment = read('../apps/desktop/src-tauri/src/desktop_local_development/mod.rs');
  const desktopLocalDevelopmentSupervisor = read('../apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs');
  const listener = read('../runtime/internal/protectedlocal/windows_verified_listener_windows.go');
  const windowsService = read('../runtime/internal/entrypoint/runtime_production_windows.go');
  const peerProbe = read('../runtime/cmd/windows-protected-peer-probe/main_windows.go');
  const interactivePeerGate = read('./check-windows-protected-e2e-peer.mjs');
  assert.match(build, /nimi_runtime_e2e/);
  assert.match(build, /nimi_runtime_e2e_virtual/);
  assert.match(build, /windows-protected-peer-probe/);
  assert.match(build, /nimiplatform-desktop-dev-run\.exe/);
  assert.match(build, /WindowsRuntimeSignerCertSHA256/);
  assert.match(build, /signWindowsDevFiles/);
  assert.match(signing, /windows-dev-signing\.ps1/);
  assert.match(installer, /NimiRuntimeE2E/);
  assert.match(installer, /NimiRuntimeE2EVirtual/);
  assert.match(installer, /StartName = \$ServiceHostAccount[\s\S]*StartPassword = \$null/);
  assert.match(installer, /sidtype[\s\S]*restricted/i);
  assert.match(installer, /\$ServiceAccount = "NT SERVICE\\\$ServiceName"/);
  assert.match(installer, /ProgramData[\s\S]*Nimi[\s\S]*Runtime[\s\S]*E2E/);
  assert.match(installer, /E2E-Virtual/);
  assert.match(serviceGate, /desktopPipePresent/);
  assert.match(serviceGate, /installedPipePresent/);
  assert.match(serviceGate, /restrictedSid/);
  assert.match(installer, /sc\.exe @Arguments 2>&1/);
  assert.match(installer, /sc\.exe exit \$exitCode/);
  assert.match(installer, /New-Service[\s\S]*-BinaryPathName \$BinaryPathName/);
  assert.match(installer, /Invoke-CimMethod[\s\S]*-MethodName Change/);
  assert.ok(installer.includes('SERVICE_EXIT_CODE') && installer.includes('runtimeStartupStage'));
  assert.match(installer, /42522 = 'principal-token-user'/);
  assert.match(installer, /42523 = 'principal-service-host-account'/);
  assert.match(installer, /42778 = 'process-tuple'/);
  assert.match(installer, /42779 = 'process-open-access-denied'/);
  assert.match(installer, /42780 = 'process-token-isolation-harden'/);
  assert.match(installer, /42781 = 'process-token-isolation-validation'/);
  assert.match(installer, /43029 = 'security-desktop-identity'/);
  assert.match(installer, /43265 = 'custody-secret-name'/);
  assert.match(installer, /43281 = 'custody-protect'/);
  assert.match(installer, /43298 = 'custody-delete'/);
  assert.match(installer, /43521 = 'pipe-context'/);
  assert.match(installer, /43539 = 'pipe-create'/);
  assert.match(installer, /43545 = 'pipe-acl-principals'/);
  assert.match(installer, /43546 = 'pipe-active-token-privilege'/);
  assert.match(installer, /43548 = 'pipe-create-access'/);
  assert.match(installer, /43551 = 'pipe-acl-read-access'/);
  assert.match(installer, /43552 = 'pipe-active-session-info'/);
  assert.match(installer, /43555 = 'pipe-active-session-info-access'/);
  assert.match(installer, /43556 = 'pipe-active-logon-data'/);
  assert.match(installer, /43557 = 'pipe-active-logon-data-access'/);
  assert.match(installer, /43558 = 'pipe-active-logon-correlation'/);
  assert.match(installer, /43560 = 'pipe-client-process-open'/);
  assert.match(installer, /43561 = 'pipe-client-token-open'/);
  assert.doesNotMatch(pipe, /WTSQueryUserToken/);
  assert.doesNotMatch(activeSession, /LsaEnumerateLogonSessions/);
  assert.match(activeSession, /WTSSessionInfo[\s\S]*LsaGetLogonSessionData/);
  assert.doesNotMatch(pipe, /windowsLogonSIDFromLUID/);
  assert.match(pipe, /SE_GROUP_LOGON_ID/);
  assert.match(pipe, /GetNamedPipeClientProcessId/);
  assert.match(pipe, /TokenStatistics[\s\S]*AuthenticationID/u);
  assert.match(process, /inspectWindowsDesktopToken/);
  assert.ok(listener.indexOf('verifyAndBindClientProcess') < listener.indexOf('nativeConnection.NetConn'));
  assert.ok(peerProbe.indexOf('VerifyWindowsProductionPipeServer') < peerProbe.indexOf('connection.Write(http2ClientPrefaceAndSettings)'));
  assert.match(peerProbe, /ServerVerified[\s\S]*ServerProcessID[\s\S]*ServerTrustSetID/);
  assert.match(installer, /Invoke-ProtectedPeerProbe[\s\S]*stop[\s\S]*start[\s\S]*Invoke-ProtectedPeerProbe/);
  assert.match(installer, /stateAclConfiguredByInstaller/);
  assert.match(installer, /stateAclRuntimeReadbackVerified/);
  assert.match(installer, /Recover-StaleFixtureStop[\s\S]*Status -ne 'StopPending'[\s\S]*PathName -ne \$expectedBinaryPath[\s\S]*Stop-Process -Id \$processId -Force/);
  assert.match(installer, /Wait-FixtureProcessExit[\s\S]*Get-Process -Id \$ProcessId[\s\S]*remained alive after SCM reported Stopped/);
  assert.match(fileLockDiagnostics, /rstrtmgr\.dll[\s\S]*RmStartSession[\s\S]*RmRegisterResources[\s\S]*RmGetList[\s\S]*RmEndSession/);
  assert.match(installer, /Assert-NoExternalFixtureBinaryLock[\s\S]*Get-WindowsFileLockOwners[\s\S]*Refusing to stop/);
  assert.match(installer, /Stop-FixtureForUpdate[\s\S]*Assert-NoExternalFixtureBinaryLock -ServiceProcessId \$processId[\s\S]*Invoke-ServiceControl -Arguments @\('stop'/);
  assert.match(installer, /Wait-FixtureBinaryReplaceable[\s\S]*FileShare\]::None[\s\S]*Get-FixtureBinaryLockOwnerDetail[\s\S]*did not become exclusively replaceable/);
  assert.ok(installer.indexOf('Stop-FixtureForUpdate') < installer.indexOf('Copy-Item -LiteralPath $source -Destination $InstalledBinary -Force'));
  assert.match(installer, /forcedStaleStopRecovery/);
  assert.match(installer, /42480 = 'shutdown-timeout'/);
  assert.match(installer, /Assert-GracefulFixtureStop/);
  assert.match(windowsService, /StopPending[\s\S]*CheckPoint[\s\S]*WaitHint/);
  assert.match(windowsService, /windowsRuntimeServiceStopTimeoutCode/);
  assert.match(windowsService, /initiateWindowsRuntimeServiceStop\(cancel, runtimeDaemon, installedListener, desktopListener\)/);
  assert.match(process, /verifyWindowsRuntimeProcessHandle\(ctx, pid, windows\.CurrentProcess\(\), principal, verifier\)/);
  assert.match(processPrincipal, /LABEL_SECURITY_INFORMATION/);
  assert.match(processPrincipal, /system_integrity_no_write_up_only/);
  assert.match(tokenSecurity, /windowsRuntimeTokenVerificationAccess/);
  assert.match(tokenSecurity, /TOKEN_QUERY/);
  assert.match(tokenSecurity, /validateWindowsRuntimeTokenIsolationHandle/);
  assert.match(peerProbe, /ClientElevated/);
  assert.match(peerProbe, /WindowsPrincipalStartupExitCode/);
  assert.ok(peerProbe.indexOf('WindowsPrincipalStartupExitCode') < peerProbe.indexOf('WindowsProcessTrustStartupExitCode'));
  assert.match(grpcStatus, /windows-e2e-fixture[\s\S]*runtime_error_info\(status\)[\s\S]*diagnostic_stage[\s\S]*status\.code\(\)/);
  assert.doesNotMatch(grpcStatus, /e2e[^\n]*status\.message\(\)/i);
  assert.match(localDevelopmentProjection, /windows-e2e-fixture[\s\S]*stage[\s\S]*confirmation_required/);
  assert.doesNotMatch(localDevelopmentProjection, /e2e[^\n]*(?:error|status|response)\.to_string\(\)/i);
  assert.match(localDevelopmentContract, /LOCAL_DEVELOPMENT_TRUST_CLASS[^\n]*"local-development-installed-admission"/);
  assert.match(desktopLocalDevelopment, /protected-local-e2e-fixture[\s\S]*stage[\s\S]*reason_code/);
  assert.doesNotMatch(desktopLocalDevelopment, /e2e[^\n]*(?:error|status)\.to_string\(\)/i);
  assert.match(desktopLocalDevelopmentSupervisor, /GetSystemDirectoryW[\s\S]*taskkill\.exe/);
  assert.match(desktopLocalDevelopmentSupervisor, /\/pid[\s\S]*\/t[\s\S]*\/f/);
  assert.ok(desktopLocalDevelopmentSupervisor.indexOf('tree_kill') < desktopLocalDevelopmentSupervisor.indexOf('child.kill().await'));
  assert.match(runtimeServiceControl, /windows-e2e-fixture[\s\S]*stage[\s\S]*reason_code/);
  assert.doesNotMatch(runtimeServiceControl, /e2e[^\n]*(?:error|status)\.to_string\(\)/i);
  assert.match(interactivePeerGate, /clientElevated[\s\S]*false/);
  assert.match(interactivePeerGate, /interactivePeerProbeVerified/);
  assert.match(installer, /elevatedPeerProbeVerified/);
  assert.match(installer, /interactivePeerProbeRequired/);
  assert.match(installer, /run-from-non-elevated-active-desktop-session/);
  assert.match(installer, /interactivePeerProbeCommand/);
  assert.doesNotMatch(installer, /\$status\['peerProbeVerified'\]/);
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

test('Windows fixture lock diagnostics identify the exact external owner', {
  skip: process.platform !== 'win32',
  timeout: 15_000,
}, async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'nimi-file-lock-probe-'));
  const lockedPath = path.join(tempRoot, 'locked.bin');
  writeFileSync(lockedPath, 'nimi-lock-probe', 'utf8');
  const escapedLockedPath = lockedPath.replaceAll("'", "''");
  const holderSource = [
    `$stream = [IO.File]::Open('${escapedLockedPath}', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)`,
    "[Console]::Out.WriteLine('ready')",
    'Start-Sleep -Seconds 12',
  ].join('; ');
  const holder = spawn(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', powershellEncodedCommand(holderSource)],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  );

  try {
    const [ready] = await once(holder.stdout, 'data');
    assert.equal(String(ready).trim(), 'ready');
    const helperPath = fileURLToPath(
      new URL('./lib/windows-file-lock-diagnostics.ps1', import.meta.url),
    ).replaceAll("'", "''");
    const probeSource = [
      `. '${helperPath}'`,
      `$owners = @(Get-WindowsFileLockOwners -Path '${escapedLockedPath}')`,
      "[pscustomobject]@{ owners = $owners } | ConvertTo-Json -Depth 5 -Compress",
    ].join('; ');
    const probe = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-EncodedCommand', powershellEncodedCommand(probeSource)],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const result = JSON.parse(probe.stdout.trim());
    assert.equal(result.owners.length, 1);
    assert.equal(result.owners[0].ProcessId, holder.pid);
    assert.equal(result.owners[0].ProcessName, 'powershell');
  } finally {
    if (holder.exitCode === null) {
      holder.kill();
      await once(holder, 'exit');
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('interactive peer evidence rejects elevated probes and admits only the unelevated signed transport result', () => {
  const base = {
    status: 'connected',
    serverVerified: true,
    serverProcessId: 42,
    serverTrustSetId: 'nimi-runtime-e2e-fixture-v1',
    serverSettings: true,
  };
  assert.throws(
    () => validateInteractivePeerResult({ ...base, clientElevated: true }),
    /unelevated interactive caller/,
  );
  const accepted = validateInteractivePeerResult({ ...base, clientElevated: false });
  assert.equal(accepted.interactivePeerProbeVerified, true);
  assert.equal(accepted.principalProfile, 'LocalSystem');
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
  assert.equal(packageJson.scripts['check:windows-protected-e2e-candidate'], 'node scripts/check-windows-protected-e2e-candidate.mjs');
  assert.equal(typeof packageJson.scripts['build:windows-protected-e2e-virtual'], 'string');
  assert.equal(typeof packageJson.scripts['install:windows-protected-e2e'], 'string');
  assert.equal(typeof packageJson.scripts['install:windows-protected-e2e-virtual'], 'string');
  assert.equal(typeof packageJson.scripts['check:windows-protected-e2e-service'], 'string');
  assert.equal(typeof packageJson.scripts['check:windows-protected-e2e-peer'], 'string');
  assert.equal(typeof packageJson.scripts['dev:desktop:protected-e2e'], 'string');
});

test('Windows protected candidate gate batches every non-admin preinstall boundary', () => {
  const commandText = candidateCommands.map((step) => `${step.command} ${step.args.join(' ')}`).join('\n');
  assert.match(commandText, /windows-protected-e2e-fixture\.test\.mjs/);
  assert.match(commandText, /go test \.\/internal\/protectedlocal \.\/internal\/services\/app -count=1/);
  assert.match(commandText, /go build \.\/\.\.\./);
  assert.match(commandText, /cargo test --manifest-path kit\/shell\/protected-local\/Cargo\.toml --features windows-e2e-fixture/);
  assert.match(commandText, /cargo check --manifest-path apps\/desktop\/src-tauri\/Cargo\.toml --no-default-features --features protected-local-e2e-fixture/);
  assert.match(commandText, /build-windows-protected-e2e\.mjs/);
  assert.match(commandText, /git diff --check/);
});
