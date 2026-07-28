import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
