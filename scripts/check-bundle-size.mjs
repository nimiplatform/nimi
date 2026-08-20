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
  lab: ['apps/lab'],
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
  return readLargestChunk(targetName, ({ fileName }) => !fileName.startsWith('vendor-'), 'non-vendor app chunk');
}

async function readLargestVendorChunk(targetName) {
  return readLargestChunk(targetName, ({ fileName }) => fileName.startsWith('vendor-'), 'vendor chunk');
}

async function readLargestChunk(targetName, include, label) {
  const distDir = await resolveTargetDistDir(targetName);
  const distAssetsDir = path.join(distDir, 'assets');
  const entries = await fs.readdir(distAssetsDir, { withFileTypes: true });
  const jsFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);

  let largest = null;
  for (const fileName of jsFiles) {
    if (!include({ fileName })) {
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
    throw new Error(`no ${label} found under ${path.relative(repoRoot, distAssetsDir)}`);
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
  const targetNames = ['desktop', 'web', 'lab'].filter((targetName) => Object.hasOwn(targets, targetName));

  for (const targetName of targetNames) {
    const targetBaseline = targets[targetName];
    const baselineBytes = Number(targetBaseline?.entryChunkBytes || 0);
    const explicitBudgetBytes = Number(targetBaseline?.entryBudgetBytes || 0);
    if (!targetBaseline || (!Number.isFinite(baselineBytes) || baselineBytes <= 0) && (!Number.isFinite(explicitBudgetBytes) || explicitBudgetBytes <= 0)) {
      failures.push(`${targetName}: missing entryChunkBytes or entryBudgetBytes`);
      continue;
    }

    const budgetBytes = Number.isFinite(explicitBudgetBytes) && explicitBudgetBytes > 0
      ? explicitBudgetBytes
      : Math.floor(baselineBytes * (1 - minReductionPercent / 100));
    const current = await readEntryChunkSize(targetName);
    const largestAppChunk = await readLargestAppChunk(targetName);
    const maxLargestAppChunkBytes = Number(targetBaseline.maxLargestAppChunkBytes || 0);
    const maxLargestVendorChunkBytes = Number(targetBaseline.maxLargestVendorChunkBytes || 0);
    const largestVendorChunk =
      Number.isFinite(maxLargestVendorChunkBytes) && maxLargestVendorChunkBytes > 0
        ? await readLargestVendorChunk(targetName)
        : null;
    const hasBaseline = Number.isFinite(baselineBytes) && baselineBytes > 0;
    const reductionPercent = hasBaseline ? ((baselineBytes - current.bytes) / baselineBytes) * 100 : null;
    const pass = current.bytes <= budgetBytes;
    const appChunkWithinLimit =
      Number.isFinite(maxLargestAppChunkBytes) && maxLargestAppChunkBytes > 0
        ? largestAppChunk.bytes <= maxLargestAppChunkBytes
        : true;
    const vendorChunkWithinLimit =
      Number.isFinite(maxLargestVendorChunkBytes) && maxLargestVendorChunkBytes > 0
        ? Boolean(largestVendorChunk && largestVendorChunk.bytes <= maxLargestVendorChunkBytes)
        : true;

    process.stdout.write(
      [
        `[bundle-size] ${targetName}`,
        `entry=${formatBytes(current.bytes)}`,
        hasBaseline ? `baseline=${formatBytes(baselineBytes)}` : 'baseline=n/a',
        `budget=${formatBytes(budgetBytes)}`,
        reductionPercent === null ? 'reduction=n/a' : `reduction=${reductionPercent.toFixed(2)}%`,
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
    if (largestVendorChunk && Number.isFinite(maxLargestVendorChunkBytes) && maxLargestVendorChunkBytes > 0) {
      process.stdout.write(
        [
          `[bundle-size] ${targetName}`,
          `largest-vendor=${formatBytes(largestVendorChunk.bytes)}`,
          `max=${formatBytes(maxLargestVendorChunkBytes)}`,
          `file=${path.relative(repoRoot, largestVendorChunk.filePath).replace(/\\/g, '/')}`,
        ].join(' '),
      );
      process.stdout.write('\n');
    }

    if (!pass) {
      failures.push(
        `${targetName}: entry chunk ${current.bytes} exceeds budget ${budgetBytes}`,
      );
    }
    if (!appChunkWithinLimit) {
      failures.push(
        `${targetName}: largest app chunk ${largestAppChunk.bytes} exceeds max ${maxLargestAppChunkBytes}`,
      );
    }
    if (!vendorChunkWithinLimit) {
      failures.push(
        `${targetName}: largest vendor chunk ${largestVendorChunk.bytes} exceeds max ${maxLargestVendorChunkBytes}`,
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
