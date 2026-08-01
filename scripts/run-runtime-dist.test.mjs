import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWindowsRunAsCommands,
  runtimeCommandArgs,
  shouldElevateWindowsRuntimeCommand,
} from './run-runtime-dist.mjs';

test('Windows stop preserves graceful service-control arguments and requests elevation', () => {
  assert.deepEqual(runtimeCommandArgs(['stop']), ['stop']);
  assert.deepEqual(
    runtimeCommandArgs(['stop', '--timeout', '20s', '--json']),
    ['stop', '--timeout', '20s', '--json'],
  );
  assert.equal(shouldElevateWindowsRuntimeCommand(['stop'], 'win32'), true);
  assert.equal(shouldElevateWindowsRuntimeCommand(['status'], 'win32'), false);
  assert.equal(shouldElevateWindowsRuntimeCommand(['stop'], 'linux'), false);
});

test('Windows elevated command uses RunAs, redirects output, and propagates the child exit code', () => {
  const { innerCommand, outerCommand } = buildWindowsRunAsCommands({
    powershellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    executablePath: "D:\\Nimi's Runtime\\nimi.exe",
    args: ['stop', '--timeout', '20s'],
    stdoutPath: 'C:\\Temp\\runtime-stdout.txt',
    stderrPath: 'C:\\Temp\\runtime-stderr.txt',
  });

  assert.match(outerCommand, /Start-Process/);
  assert.match(outerCommand, /-Verb RunAs/);
  assert.match(outerCommand, /C:\\Program Files\\PowerShell\\7\\pwsh\.exe/);
  assert.match(outerCommand, /exit \$process\.ExitCode/);
  assert.doesNotMatch(outerCommand, /RedirectStandard/);

  assert.match(innerCommand, /D:\\Nimi''s Runtime\\nimi\.exe/);
  assert.match(innerCommand, /'stop' '--timeout' '20s'/);
  assert.match(innerCommand, /1> 'C:\\Temp\\runtime-stdout\.txt'/);
  assert.match(innerCommand, /2> 'C:\\Temp\\runtime-stderr\.txt'/);
  assert.match(innerCommand, /exit \$LASTEXITCODE/);
  assert.doesNotMatch(innerCommand, /--force/);
});
