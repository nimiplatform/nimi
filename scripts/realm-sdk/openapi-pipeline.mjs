import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OPENAPI_TYPESCRIPT_VERSION, REALM_GENERATED_RELATIVE_PATH } from './constants.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function runCommand(repoRoot, label, args) {
  const command = ['pnpm', ...args].join(' ');
  process.stdout.write(`\n[generate:realm-sdk] ${label}\n$ ${command}\n`);
  const result = spawnSync(PNPM_BIN, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const status = result.status ?? -1;
    throw new Error(`${label} failed (exit code ${status})`);
  }
}

function hasLocalOpenApiTypescriptBinary(repoRoot) {
  const result = spawnSync(PNPM_BIN, ['exec', 'openapi-typescript', '--version'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

export function runOpenApiTypescript(repoRoot, inputPath) {
  const outputPath = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH, 'schema.ts');

  if (hasLocalOpenApiTypescriptBinary(repoRoot)) {
    runCommand(repoRoot, 'OpenAPI schema generation (local openapi-typescript)', [
      'exec',
      'openapi-typescript',
      inputPath,
      '--output',
      outputPath,
      '--export-type',
    ]);
    return;
  }

  runCommand(repoRoot, 'OpenAPI schema generation (pnpm dlx fallback)', [
    'dlx',
    `openapi-typescript@${OPENAPI_TYPESCRIPT_VERSION}`,
    inputPath,
    '--output',
    outputPath,
    '--export-type',
  ]);
}
