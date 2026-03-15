import { readFileSync, writeFileSync } from 'node:fs';
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

function countBraceDelta(line) {
  const text = String(line || '');
  const opened = (text.match(/\{/g) || []).length;
  const closed = (text.match(/\}/g) || []).length;
  return opened - closed;
}

export function normalizeOperationsInterfaceInSchema(repoRoot) {
  const schemaPath = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH, 'schema.ts');
  const source = readFileSync(schemaPath, 'utf8');
  const lines = source.split('\n');
  let start = -1;
  let end = -1;
  let depth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (start < 0) {
      if (/^\s*export interface operations \{/.test(line)) {
        start = index;
        depth = countBraceDelta(line);
        if (depth <= 0) {
          end = index;
          break;
        }
      }
      continue;
    }

    depth += countBraceDelta(line);
    if (depth <= 0) {
      end = index;
      break;
    }
  }

  if (start < 0 || end < 0) {
    return;
  }

  const replacement = [
    'export interface operations {',
    '    [key: string]: unknown;',
    '}',
  ];
  const output = [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(end + 1),
  ];
  const normalized = `${output.join('\n')}\n`;
  if (source !== normalized) {
    writeFileSync(schemaPath, normalized, 'utf8');
  }
}
