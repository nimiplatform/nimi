#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, relative } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scanRoots = [
  'runtime/internal',
  'runtime/cmd',
  'apps/desktop/src',
  'sdk/src',
  'proto',
];

const allowedFiles = new Set([
  'runtime/cmd/runtime-compliance/main.go',
  'runtime/internal/config/config.go',
  'runtime/internal/nimillm/cloud_provider_probe.go',
  'apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts',
  'runtime/internal/config/config_test.go',
  'runtime/internal/services/ai/service_probe_test.go',
]);

const allowedExtensions = new Set([
  '.go',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.proto',
]);

const legacyPattern = /\b(?:litellm|cloudlitellm|cloudai)\b/ig;
const failures = [];

function walk(absPath) {
  const entryStat = statSync(absPath);
  if (entryStat.isDirectory()) {
    for (const name of readdirSync(absPath)) {
      walk(resolve(absPath, name));
    }
    return;
  }

  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  if (allowedFiles.has(relPath)) {
    return;
  }
  if (!allowedExtensions.has(extname(absPath))) {
    return;
  }

  const content = readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    legacyPattern.lastIndex = 0;
    if (!legacyPattern.test(line)) {
      continue;
    }
    failures.push(`${relPath}:${i + 1}: ${line.trim()}`);
  }
}

for (const root of scanRoots) {
  walk(resolve(repoRoot, root));
}

if (failures.length > 0) {
  process.stderr.write(`legacy cloud provider naming is forbidden:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('legacy cloud provider naming check passed\n');
}
