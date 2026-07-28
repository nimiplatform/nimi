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
