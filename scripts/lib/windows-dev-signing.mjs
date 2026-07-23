import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parsePowerShellJsonResult,
  resolveWindowsPowerShell7,
} from './windows-powershell.mjs';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'windows-dev-signing.ps1',
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function runSigningHelper(mode, paths = [], options = {}) {
  if (process.platform !== 'win32') {
    throw new Error('Windows development signing is available only on Windows');
  }
  if (paths.length > 1) {
    const payloads = paths.map((filePath) => runSigningHelper(mode, [filePath], options));
    return {
      ...payloads[0],
      signatures: payloads.flatMap((payload) => payload.signatures || []),
      applicationControlEvents: payloads.flatMap((payload) => payload.applicationControlEvents || []),
    };
  }
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Mode',
    mode,
    ...(paths.length > 0 ? ['-Path', ...paths.map((filePath) => path.resolve(filePath))] : []),
    '-Json',
  ];
  const powershellPath = resolveWindowsPowerShell7(options);
  const result = spawnSync(powershellPath, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`failed to start Windows signing helper with PowerShell 7: ${result.error.message}`);
  }
  const detail = [result.stderr, result.stdout]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  if (result.status !== 0) {
    throw new Error(`Windows signing helper ${mode} failed${detail ? `:\n${detail}` : ''}`);
  }
  try {
    return parsePowerShellJsonResult(result, 'windows-dev-signing-json-invalid');
  } catch (error) {
    throw new Error(`Windows signing helper returned invalid JSON: ${error.message}`);
  }
}

export function requireWindowsDevSigningIdentity(options = {}) {
  const payload = runSigningHelper('Diagnose', [], options);
  const certificate = payload?.certificate;
  const sha256 = String(certificate?.certificateSha256 || '').trim();
  if (
    certificate?.status !== 'present'
    || !SHA256_PATTERN.test(sha256)
    || certificate?.stores?.currentUserMy !== true
    || certificate?.stores?.currentUserRoot !== true
    || certificate?.stores?.currentUserTrustedPublisher !== true
  ) {
    throw new Error(
      'Windows E2E signing identity is not fully provisioned; run `pnpm provision:windows-dev-trust`.',
    );
  }
  return Object.freeze({
    subject: String(certificate.subject),
    thumbprint: String(certificate.thumbprint),
    certificateSha256: sha256,
  });
}

export function signWindowsDevFiles(paths, options = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('at least one Windows development signing path is required');
  }
  const payload = runSigningHelper('Sign', paths, options);
  const sha256 = String(payload?.certificateSha256 || '').trim();
  if (payload?.status !== 'signed' || !SHA256_PATTERN.test(sha256)) {
    throw new Error('Windows signing helper did not return a verified signer identity');
  }
  return payload;
}

export function requireWindowsDevSignedFiles(paths, expectedCertificateSha256, options = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('at least one Windows signed-file path is required');
  }
  const expected = String(expectedCertificateSha256 || '').trim();
  if (!SHA256_PATTERN.test(expected)) {
    throw new Error('expected Windows signer identity must be an exact lowercase SHA-256 digest');
  }
  const payload = runSigningHelper('Diagnose', paths, options);
  const signatures = Array.isArray(payload?.signatures) ? payload.signatures : [];
  if (payload?.status !== 'diagnosed' || signatures.length !== paths.length) {
    throw new Error('Windows signing helper did not return every requested signature');
  }
  for (const signature of signatures) {
    if (signature?.exists !== true
      || signature?.status !== 'Valid'
      || signature?.signerCertificateSha256 !== expected) {
      throw new Error(`Windows executable is not signed by the admitted identity: ${signature?.path || '<unknown>'}`);
    }
  }
  return Object.freeze(signatures.map((signature) => Object.freeze({ ...signature })));
}
