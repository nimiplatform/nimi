import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFirstJsonDocument,
  parsePowerShellJsonResult,
  resolveWindowsPowerShell7,
} from './lib/windows-powershell.mjs';

test('PowerShell JSON result separates localized diagnostics from the receipt', () => {
  const stdout = '\ufeff警告: optional formatting data was unavailable\r\n'
    + '{"status":"signed","message":"quoted \\"value\\" with } inside"}\r\n'
    + 'VERBOSE: cleanup completed';
  const parsed = parseFirstJsonDocument(stdout, 'test-json-invalid');
  assert.deepEqual(parsed.value, {
    status: 'signed',
    message: 'quoted "value" with } inside',
  });
  assert.equal(
    parsed.diagnostics,
    '警告: optional formatting data was unavailable\nVERBOSE: cleanup completed',
  );

  const diagnostics = [];
  assert.deepEqual(parsePowerShellJsonResult({ stdout, stderr: 'native warning' }, 'test-json-invalid', {
    writeDiagnostics: (value) => diagnostics.push(value),
  }), parsed.value);
  assert.deepEqual(diagnostics, [
    'native warning\n警告: optional formatting data was unavailable\nVERBOSE: cleanup completed\n',
  ]);
  assert.throws(
    () => parseFirstJsonDocument('warning without receipt', 'test-json-invalid'),
    (error) => error.reasonCode === 'test-json-invalid'
      && error.actionHint === 'inspect_powershell_command_output',
  );
});

test('Windows signing helper uses the explicit absolute PowerShell 7 path', () => {
  const expected = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  assert.equal(resolveWindowsPowerShell7({
    env: { NIMI_PWSH_PATH: expected },
    existsSync: (candidate) => candidate === expected,
  }), expected);
});

test('Windows signing helper resolves the standard PowerShell 7 installation', () => {
  const expected = 'D:\\Tools\\PowerShell\\7\\pwsh.exe';
  assert.equal(resolveWindowsPowerShell7({
    env: { ProgramW6432: 'D:\\Tools' },
    existsSync: (candidate) => candidate === expected,
  }), expected);
});

test('Windows signing helper rejects a missing explicit PowerShell path', () => {
  assert.throws(
    () => resolveWindowsPowerShell7({
      env: { NIMI_PWSH_PATH: 'pwsh.exe' },
      existsSync: () => false,
    }),
    /existing absolute PowerShell 7 executable/u,
  );
});
