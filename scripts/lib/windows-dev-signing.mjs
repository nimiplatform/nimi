import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'windows-dev-signing.ps1',
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function runSigningHelper(mode, paths = [], options = {}) {
  if (process.platform !== 'win32') {
    throw new Error('Windows development signing is available only on Windows');
  }
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Mode',
    mode,
    ...paths.flatMap((filePath) => ['-Path', path.resolve(filePath)]),
    '-Json',
  ];
  const result = spawnSync('powershell.exe', args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(`failed to start Windows signing helper: ${result.error.message}`);
  }
  const output = String(result.stdout || '').trim();
  const detail = [result.stderr, output]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  if (result.status !== 0) {
    throw new Error(`Windows signing helper ${mode} failed${detail ? `:\n${detail}` : ''}`);
  }
  try {
    return JSON.parse(output || '{}');
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
