#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const baselinePath = path.join(scriptDir, 'bundle-size-baseline.json');
const TARGET_DIR_CANDIDATES = {
  desktop: ['apps/desktop', 'desktop'],
  web: ['apps/web', 'web'],
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function parseEntryScriptPath(indexHtml) {
  const scriptMatch = indexHtml.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"[^>]*>/i);
  if (!scriptMatch || !scriptMatch[1]) {
    throw new Error('entry script not found in index.html');
  }
  return scriptMatch[1];
}

async function readEntryChunkSize(targetName) {
  const distDir = await resolveTargetDistDir(targetName);
  const indexPath = path.join(distDir, 'index.html');
  const html = await fs.readFile(indexPath, 'utf8');
  const entryScript = parseEntryScriptPath(html);
  const scriptPath = entryScript.startsWith('/')
    ? path.join(distDir, entryScript.slice(1))
    : path.resolve(distDir, entryScript);
  const stats = await fs.stat(scriptPath);
  return {
    scriptPath,
    bytes: stats.size,
  };
}

async function readLargestAppChunk(targetName) {
  const distDir = await resolveTargetDistDir(targetName);
  const distAssetsDir = path.join(distDir, 'assets');
  const entries = await fs.readdir(distAssetsDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);

  let largest = null;
  for (const fileName of jsFiles) {
    // Vendor chunks are tracked independently by Vite warnings and not part of app-budget gate.
    if (fileName.startsWith('vendor-')) {
      continue;
    }
    const filePath = path.join(distAssetsDir, fileName);
    const stats = await fs.stat(filePath);
    if (!largest || stats.size > largest.bytes) {
      largest = {
        filePath,
        bytes: stats.size,
      };
    }
  }

  if (!largest) {
    throw new Error(`no non-vendor app chunk found under ${path.relative(repoRoot, distAssetsDir)}`);
  }

  return largest;
}

async function resolveTargetDistDir(targetName) {
  const candidates = TARGET_DIR_CANDIDATES[targetName] || [targetName];
  for (const relativeDir of candidates) {
    const distDir = path.join(repoRoot, relativeDir, 'dist');
    try {
      const stat = await fs.stat(distDir);
      if (stat.isDirectory()) {
        return distDir;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(`dist directory not found for target "${targetName}"`);
}

async function main() {
  const baselineRaw = await fs.readFile(baselinePath, 'utf8');
  const baseline = JSON.parse(baselineRaw);
  const minReductionPercent = Number(baseline.minimumReductionPercent || 20);
  const targets = baseline.targets || {};
  const failures = [];

  for (const targetName of ['desktop', 'web']) {
    const targetBaseline = targets[targetName];
    if (!targetBaseline || !Number.isFinite(targetBaseline.entryChunkBytes)) {
      failures.push(`${targetName}: missing baseline entryChunkBytes`);
      continue;
    }

    const baselineBytes = Number(targetBaseline.entryChunkBytes);
    const budgetBytes = Math.floor(baselineBytes * (1 - minReductionPercent / 100));
    const current = await readEntryChunkSize(targetName);
    const largestAppChunk = await readLargestAppChunk(targetName);
    const maxLargestAppChunkBytes = Number(targetBaseline.maxLargestAppChunkBytes || 0);
    const reductionPercent = ((baselineBytes - current.bytes) / baselineBytes) * 100;
    const pass = current.bytes <= budgetBytes;
    const appChunkWithinLimit =
      Number.isFinite(maxLargestAppChunkBytes) && maxLargestAppChunkBytes > 0
        ? largestAppChunk.bytes <= maxLargestAppChunkBytes
        : true;

    process.stdout.write(
      [
        `[bundle-size] ${targetName}`,
        `entry=${formatBytes(current.bytes)}`,
        `baseline=${formatBytes(baselineBytes)}`,
        `budget=${formatBytes(budgetBytes)}`,
        `reduction=${reductionPercent.toFixed(2)}%`,
        `file=${path.relative(repoRoot, current.scriptPath).replace(/\\/g, '/')}`,
      ].join(' '),
    );
    process.stdout.write('\n');
    if (Number.isFinite(maxLargestAppChunkBytes) && maxLargestAppChunkBytes > 0) {
      process.stdout.write(
        [
          `[bundle-size] ${targetName}`,
          `largest-app=${formatBytes(largestAppChunk.bytes)}`,
          `max=${formatBytes(maxLargestAppChunkBytes)}`,
          `file=${path.relative(repoRoot, largestAppChunk.filePath).replace(/\\/g, '/')}`,
        ].join(' '),
      );
      process.stdout.write('\n');
    }

    if (!pass) {
      failures.push(
        `${targetName}: entry chunk ${current.bytes} exceeds budget ${budgetBytes} (${minReductionPercent}% reduction target)`,
      );
    }
    if (!appChunkWithinLimit) {
      failures.push(
        `${targetName}: largest app chunk ${largestAppChunk.bytes} exceeds max ${maxLargestAppChunkBytes}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write('bundle-size check failed:\n');
    for (const failure of failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('bundle-size check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-bundle-size failed: ${String(error)}\n`);
  process.exitCode = 1;
});
