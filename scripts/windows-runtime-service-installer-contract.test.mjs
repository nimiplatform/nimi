import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveWindowsPowerShell7 } from './lib/windows-powershell.mjs';

test('protected existing state root is taken over before any create attempt', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const escapedInstallerPath = installerPath.replaceAll("'", "''");
  const command = [
    `. '${escapedInstallerPath}'`,
    `$StateRoot = 'C:\\protected-existing'`,
    `$calls = [System.Collections.Generic.List[string]]::new()`,
    `function Invoke-NativeCommand { param([string] $FilePath, [string[]] $Arguments); $calls.Add($FilePath + ' ' + ($Arguments -join ' ')); [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } }`,
    `function New-Item { throw 'create must not run for an existing protected root' }`,
    `Grant-InstallerStateAccess`,
    `$calls | ConvertTo-Json -Compress`,
  ].join('; ');
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    'takeown.exe /F C:\\protected-existing /A',
    'icacls.exe C:\\protected-existing /grant:r *S-1-5-32-544:(OI)(CI)F',
  ]);
});

test('protected installation state is taken over before any access-sensitive existence probe', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-state-access-test-'));
  const statePath = path.join(tempRoot, 'installation.json');
  writeFileSync(statePath, '{}\n', 'utf8');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedStatePath = statePath.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeInstallationState = '${escapedStatePath}'`,
      `$calls = [System.Collections.Generic.List[string]]::new()`,
      `function Test-Path { throw 'access-sensitive preflight probe must not run' }`,
      `function Invoke-NativeCommand { param([string] $FilePath, [string[]] $Arguments); $calls.Add($FilePath + ' ' + ($Arguments -join ' ')); [pscustomobject]@{ ExitCode = 0; StdOut = ''; StdErr = '' } }`,
      `$granted = Grant-InstallerRuntimeInstallationStateAccess`,
      `[ordered]@{ granted = $granted; calls = $calls } | ConvertTo-Json -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      granted: true,
      calls: [
        `takeown.exe /F ${statePath} /A`,
        `icacls.exe ${statePath} /grant:r *S-1-5-32-544:F`,
      ],
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('missing installation state is distinguished from denied access after takeown fails', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-state-missing-test-'));
  const statePath = path.join(tempRoot, 'installation.json');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedStatePath = statePath.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeInstallationState = '${escapedStatePath}'`,
      `$calls = [System.Collections.Generic.List[string]]::new()`,
      `function Test-Path { throw 'access-sensitive absence probe must not run' }`,
      `function Invoke-NativeCommand { param([string] $FilePath, [string[]] $Arguments); $calls.Add($FilePath + ' ' + ($Arguments -join ' ')); [pscustomobject]@{ ExitCode = 1; StdOut = ''; StdErr = 'not found' } }`,
      `$granted = Grant-InstallerRuntimeInstallationStateAccess`,
      `[ordered]@{ granted = $granted; calls = $calls } | ConvertTo-Json -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      granted: false,
      calls: [`takeown.exe /F ${statePath} /A`],
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('existing installation state fails closed when takeown fails', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-state-takeown-test-'));
  const statePath = path.join(tempRoot, 'installation.json');
  writeFileSync(statePath, '{}\n', 'utf8');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedStatePath = statePath.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeInstallationState = '${escapedStatePath}'`,
      `function Invoke-NativeCommand { [pscustomobject]@{ ExitCode = 1; StdOut = ''; StdErr = 'denied' } }`,
      `try { Grant-InstallerRuntimeInstallationStateAccess; throw 'expected failure' } catch { $_.Exception.Message }`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /Unable to take temporary installer ownership of the Runtime installation state\./u,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('offline repair invokes only the fixed installed helper once in idempotent apply mode', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-offline-repair-test-'));
  const databasePath = path.join(tempRoot, 'memory.db');
  const backupPath = `${databasePath}.pre-local-agent-chat-repair-20260731T020845.9306546Z-0123456789abcdef0123456789abcdef.sqlite`;
  writeFileSync(databasePath, 'database', 'utf8');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedTempRoot = tempRoot.replaceAll("'", "''");
    const escapedDatabasePath = databasePath.replaceAll("'", "''");
    const escapedBackupPath = backupPath.replaceAll("'", "''");
    const installedHelper = path.join(tempRoot, 'installed', 'resources', 'repair-local-agent-chat.exe');
    const escapedInstalledHelper = installedHelper.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeStateRoot = '${escapedTempRoot}'`,
      `$RuntimeDatabase = '${escapedDatabasePath}'`,
      `$InstalledLocalAgentChatRepairHelper = '${escapedInstalledHelper}'`,
      `$calls = [System.Collections.Generic.List[string]]::new()`,
      `function Assert-LocalAgentChatRepairHelper { param([string] $Path, [string] $ExpectedSignerCertificateSha256); if ($Path -ne $InstalledLocalAgentChatRepairHelper) { throw 'unexpected helper path' } }`,
      `function Invoke-NativeCommand { param([string] $FilePath, [string[]] $Arguments); $calls.Add($FilePath + ' ' + ($Arguments -join ' ')); [pscustomobject]@{ ExitCode = 0; StdOut = '{"schemaVersion":1,"status":"no-change","duplicateGroups":0,"reactivatedAnchors":0,"rewrittenAnchorRefs":0,"originalVersion":176,"repairedVersion":176,"rewrittenFollowUpRefs":0,"rewrittenAvatarRefs":0}'; StdErr = '' } }`,
      `$repair = Invoke-LocalAgentChatOfflineRepair -ExpectedSignerCertificateSha256 ('aa' * 32) -BackupPath '${escapedBackupPath}'`,
      `[ordered]@{ repair = $repair; calls = $calls } | ConvertTo-Json -Depth 4 -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      repair: {
        status: 'no-change',
        skipReason: null,
        duplicateGroups: 0,
        reactivatedAnchors: 0,
        rewrittenAnchorRefs: 0,
        originalVersion: 176,
        repairedVersion: 176,
        backupPath: null,
      },
      calls: [
        `${installedHelper} --db ${databasePath} --backup ${backupPath} --confirm-runtime-stopped --apply --installer-preinstall --json`,
      ],
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('offline repair accepts only its verified same-directory backup for an applied result', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-offline-backup-test-'));
  const databasePath = path.join(tempRoot, 'memory.db');
  const backupPath = `${databasePath}.pre-local-agent-chat-repair-20260731T020845.9306546Z-0123456789abcdef0123456789abcdef.sqlite`;
  writeFileSync(databasePath, 'database', 'utf8');
  writeFileSync(backupPath, 'backup', 'utf8');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedTempRoot = tempRoot.replaceAll("'", "''");
    const escapedDatabasePath = databasePath.replaceAll("'", "''");
    const escapedBackupPath = backupPath.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeStateRoot = '${escapedTempRoot}'`,
      `$RuntimeDatabase = '${escapedDatabasePath}'`,
      `$InstalledLocalAgentChatRepairHelper = 'C:\\Program Files\\Nimi\\Runtime\\versions\\fixed\\resources\\repair-local-agent-chat.exe'`,
      `function Assert-LocalAgentChatRepairHelper { }`,
      `function Invoke-NativeCommand { [pscustomobject]@{ ExitCode = 0; StdOut = ('{"schemaVersion":1,"status":"applied","duplicateGroups":2,"reactivatedAnchors":0,"rewrittenAnchorRefs":0,"originalVersion":175,"repairedVersion":176,"rewrittenFollowUpRefs":0,"rewrittenAvatarRefs":0,"backupPath":"' + '${escapedBackupPath}'.Replace('\\', '\\\\') + '"}'); StdErr = '' } }`,
      `Invoke-LocalAgentChatOfflineRepair -ExpectedSignerCertificateSha256 ('aa' * 32) -BackupPath '${escapedBackupPath}' | ConvertTo-Json -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      status: 'applied',
      skipReason: null,
      duplicateGroups: 2,
      reactivatedAnchors: 0,
      rewrittenAnchorRefs: 0,
      originalVersion: 175,
      repairedVersion: 176,
      backupPath,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('offline repair custody restoration covers only fixed database paths and its verified backup', {
  skip: process.platform !== 'win32',
}, () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const escapedInstallerPath = installerPath.replaceAll("'", "''");
  const command = [
    `. '${escapedInstallerPath}'`,
    `$RuntimeDatabase = 'C:\\protected\\runtime\\memory.db'`,
    `$RuntimeInstallationState = 'C:\\protected\\runtime\\installation.json'`,
    `$RuntimeStateRoot = 'C:\\protected\\runtime'`,
    `$calls = [System.Collections.Generic.List[string]]::new()`,
    `function Set-ServiceOnlyFileAcl { param([string] $Path); $calls.Add('file ' + $Path); return $true }`,
    `function Set-RuntimeInstallationStateAcl { $calls.Add('installation ' + $RuntimeInstallationState) }`,
    `function Set-RuntimeStateRootAcl { $calls.Add('directory ' + $RuntimeStateRoot); return $true }`,
    `Set-RuntimeRepairStateAcl -BackupPath 'C:\\protected\\runtime\\memory.db.pre-local-agent-chat-repair-fixed.sqlite'`,
    `$calls | ConvertTo-Json -Compress`,
  ].join('; ');
  const result = spawnSync(resolveWindowsPowerShell7(), [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [
    'file C:\\protected\\runtime\\memory.db',
    'file C:\\protected\\runtime\\memory.db-wal',
    'file C:\\protected\\runtime\\memory.db-shm',
    'file C:\\protected\\runtime\\memory.db-journal',
    'file C:\\protected\\runtime\\memory.db.pre-local-agent-chat-repair-fixed.sqlite',
    'installation C:\\protected\\runtime\\installation.json',
    'directory C:\\protected\\runtime',
  ]);
});

test('installer stops the service before opening protected Runtime state custody', () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const source = readFileSync(installerPath, 'utf8');
  const installService = source.slice(source.indexOf('function Install-Service {'));
  const stop = installService.indexOf('Stop-Service -Name $ServiceName');
  const grant = installService.indexOf('Grant-InstallerStateAccess');
  assert.ok(stop >= 0 && grant > stop, 'Install-Service must stop the service before temporary ACL access');
  assert.equal(
    installService.match(/Set-RuntimeRepairStateAcl -BackupPath \$plannedRepairBackupPath/gu)?.length,
    2,
    'success and rollback must both restore the installer-planned backup path',
  );
});

test('service recovery is bounded and explicit stop cannot restart forever', () => {
  const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
  const source = readFileSync(installerPath, 'utf8');
  assert.match(source, /'failureflag', \$ServiceName, '1'/u);
  assert.match(
    source,
    /'failure', \$ServiceName, 'reset=', '300', 'actions=', 'restart\/1000\/restart\/3000\/restart\/10000\/none\/0'/u,
  );
});

test('version retention keeps only current and last-known-good candidates', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-version-retention-test-'));
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedTempRoot = tempRoot.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$InstallRoot = '${escapedTempRoot}'`,
      `$versions = Join-Path $InstallRoot 'versions'`,
      `$current = Join-Path $versions 'current'`,
      `$previous = Join-Path $versions 'previous'`,
      `$stale = Join-Path $versions 'stale'`,
      `New-Item -ItemType Directory -Path $current, $previous, $stale -Force | Out-Null`,
      `$previousServicePath = ('"' + (Join-Path $previous 'nimi.exe') + '" serve')`,
      `$resolvedPrevious = Resolve-InstalledVersionRootFromServicePath -ServiceBinaryPath $previousServicePath`,
      `$removed = @(Remove-StaleInstalledVersions -KeepRoots @($current, $resolvedPrevious))`,
      `[ordered]@{ removed = $removed; current = (Test-Path -LiteralPath $current); previous = (Test-Path -LiteralPath $previous); stale = (Test-Path -LiteralPath $stale) } | ConvertTo-Json -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      removed: ['stale'],
      current: true,
      previous: true,
      stale: false,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('signed installer migrates existing Runtime state to the fixed local-development profile', {
  skip: process.platform !== 'win32',
}, () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-profile-test-'));
  const statePath = path.join(tempRoot, 'installation.json');
  writeFileSync(statePath, '{"schemaVersion":1,"runtimeId":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}\n', 'utf8');
  try {
    const installerPath = fileURLToPath(new URL('./install-windows-runtime-service.ps1', import.meta.url));
    const escapedInstallerPath = installerPath.replaceAll("'", "''");
    const escapedStatePath = statePath.replaceAll("'", "''");
    const command = [
      `. '${escapedInstallerPath}'`,
      `$RuntimeInstallationState = '${escapedStatePath}'`,
      `$DeploymentProfile = 'local-development'`,
      `$changed = Set-RuntimeDeploymentProfile`,
      `[ordered]@{ changed = $changed; state = (Get-Content -LiteralPath $RuntimeInstallationState -Raw -Encoding UTF8 | ConvertFrom-Json) } | ConvertTo-Json -Depth 4 -Compress`,
    ].join('; ');
    const result = spawnSync(resolveWindowsPowerShell7(), [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      changed: true,
      state: {
        schemaVersion: 2,
        runtimeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        deploymentProfile: 'local-development',
        realmOrigin: 'http://127.0.0.1:3002',
      },
    });
    assert.match(readFileSync(statePath, 'utf8'), /"deploymentProfile":"local-development"/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
