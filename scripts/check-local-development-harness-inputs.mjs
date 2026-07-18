#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT_PATTERN = /NIMI_LOCAL_AGENT_PRODUCT_[A-Z0-9_]+|--nimi-dev-agent-id/gu;
const TRIAL_ROOT_INPUT = 'NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT';
const CHECKPOINT_GATE_PATTERN = /NIMI_DEV_KERNEL_CHECKPOINT|dev-kernel-checkpoint/u;
const EXACT_PRODUCT_ALLOWLIST = new Set([
  'apps/desktop/src-electron/dev-kernel-external-url-capture.ts',
  'apps/desktop/src-electron/local-development-host.ts',
  'apps/desktop/src-electron/local-development-host-arguments.ts',
  'apps/desktop/src-tauri/src/desktop_local_development/supervisor.rs',
  'apps/zhiyu/src-electron/main.ts',
  'apps/zhiyu/src-electron/preload.cts',
  'kit/shell/protected-local/src/windows_checkpoint_browser_capture.rs',
]);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.go', '.js', '.jsx', '.mjs', '.rs', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set(['.cache', '.git', 'dist', 'generated', 'node_modules', 'target']);

export function collectHarnessInputViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    const matches = [...entry.source.matchAll(INPUT_PATTERN)];
    if (matches.length === 0) continue;
    if (EXACT_PRODUCT_ALLOWLIST.has(entry.relativePath)) {
      const trialRoot = matches.find((match) => match[0] === TRIAL_ROOT_INPUT);
      if (trialRoot && !CHECKPOINT_GATE_PATTERN.test(entry.source)) {
        const line = entry.source.slice(0, trialRoot.index).split('\n').length;
        violations.push(`${entry.relativePath}:${line}: trial-root harness input requires a same-file checkpoint gate`);
      }
      continue;
    }
    for (const match of matches) {
      const line = entry.source.slice(0, match.index).split('\n').length;
      violations.push(`${entry.relativePath}:${line}: harness input ${match[0]} is outside the product allowlist`);
    }
  }
  return violations;
}

export function isProductSourcePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const name = path.posix.basename(normalized);
  if (/(?:^|\.)test\.[^.]+$/u.test(name) || name.endsWith('_test.go') || name.endsWith('_test.rs')) return false;
  if (normalized.startsWith('apps/')) {
    return normalized.includes('/src/')
      || normalized.includes('/src-electron/')
      || normalized.includes('/src-tauri/src/');
  }
  if (normalized.startsWith('kit/')) return normalized.includes('/src/');
  if (normalized.startsWith('runtime/')) return name.endsWith('.go');
  if (normalized.startsWith('sdks/')) return !normalized.includes('/test/');
  return false;
}

async function collectProductSources() {
  const files = [];
  for (const root of ['apps', 'kit', 'runtime', 'sdks']) {
    await walk(path.join(repoRoot, root), files);
  }
  return Promise.all(files.map(async (filePath) => ({
    relativePath: path.relative(repoRoot, filePath).replaceAll(path.sep, '/'),
    source: await readFile(filePath, 'utf8'),
  })));
}

async function walk(directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(target, output);
      continue;
    }
    const relativePath = path.relative(repoRoot, target).replaceAll(path.sep, '/');
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && isProductSourcePath(relativePath)) {
      output.push(target);
    }
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const violations = collectHarnessInputViolations(await collectProductSources());
  if (violations.length > 0) {
    process.stderr.write(`Local-development harness input violations:\n- ${violations.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Local-development harness input check passed\n');
  }
}
