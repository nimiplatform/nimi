import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseWindowsDevSigningIdentity } from './lib/windows-dev-signing.mjs';
import {
  parseFirstJsonDocument,
  parsePowerShellJsonResult,
  resolveWindowsPowerShell7,
} from './lib/windows-powershell.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

test('Windows development signer identity requires exact certificate and SPKI digests', () => {
  const payload = {
    certificate: {
      status: 'present',
      subject: 'CN=Nimi Local Development Code Signing',
      thumbprint: 'ABCDEF',
      certificateSha256: '1'.repeat(64),
      spkiSha256: 'ab'.repeat(32),
      stores: {
        currentUserMy: true,
        currentUserRoot: true,
        currentUserTrustedPublisher: true,
      },
    },
  };
  assert.deepEqual(parseWindowsDevSigningIdentity(payload), {
    subject: payload.certificate.subject,
    thumbprint: payload.certificate.thumbprint,
    certificateSha256: payload.certificate.certificateSha256,
    spkiSha256: payload.certificate.spkiSha256,
  });
  assert.throws(
    () => parseWindowsDevSigningIdentity({
      certificate: { ...payload.certificate, spkiSha256: payload.certificate.spkiSha256.toUpperCase() },
    }),
    /not fully provisioned/u,
  );
  assert.throws(
    () => parseWindowsDevSigningIdentity({
      certificate: { ...payload.certificate, spkiSha256: undefined },
    }),
    /not fully provisioned/u,
  );
});

test('Windows protected-local production build rejects retired and malformed SPKI inputs', {
  skip: process.platform !== 'win32',
}, () => {
  const scriptPath = path.join(
    repoRoot,
    'kit',
    'shell',
    'protected-local-node',
    'scripts',
    'build-windows-x64-package.mjs',
  );
  const inputs = [
    {
      NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256: 'a'.repeat(64),
      NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256: undefined,
    },
    {
      NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256: undefined,
      NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256: 'A'.repeat(64),
    },
  ];
  for (const input of inputs) {
    const env = { ...process.env };
    for (const [name, value] of Object.entries(input)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stderr}\n${result.stdout}`,
      /NIMI_WINDOWS_PRODUCTION_SIGNER_SPKI_SHA256 must be an exact lowercase SHA-256 SubjectPublicKeyInfo identity/u,
    );
  }
});
