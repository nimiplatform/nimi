#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ssotRoot = path.join(repoRoot, 'ssot');
const matrixPath = path.join(ssotRoot, '_meta', 'traceability-matrix.md');

const EXCLUDED_FILES = new Set(['README.md', '_meta/template.md', '_meta/traceability-matrix.md']);

function isMarkdownFile(name) {
  return name.endsWith('.md');
}

async function listMarkdownFiles(dir, baseDir = dir) {
  const output = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listMarkdownFiles(fullPath, baseDir)));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      output.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return output;
}

function parseTargets(matrixContent) {
  const targets = new Set();
  const re = /\|\s*`([^`]+\.md)`\s*\|/g;
  let match;
  while ((match = re.exec(matrixContent)) !== null) {
    targets.add(match[1].replace(/\\/g, '/'));
  }
  return targets;
}

async function main() {
  const violations = [];

  let matrixContent = '';
  try {
    matrixContent = await fs.readFile(matrixPath, 'utf8');
  } catch {
    process.stderr.write(`SSOT traceability check failed: missing ${path.relative(repoRoot, matrixPath)}\n`);
    process.exit(1);
  }

  const expected = (await listMarkdownFiles(ssotRoot))
    .filter((rel) => !EXCLUDED_FILES.has(rel))
    .sort();
  const listed = [...parseTargets(matrixContent)].sort();
  const listedSet = new Set(listed);

  for (const rel of expected) {
    if (!listedSet.has(rel)) {
      violations.push(`missing matrix target: ${rel}`);
    }
  }

  for (const rel of listed) {
    if (!expected.includes(rel)) {
      violations.push(`matrix contains unexpected or missing file: ${rel}`);
      continue;
    }
    const abs = path.join(ssotRoot, rel);
    try {
      await fs.access(abs);
    } catch {
      violations.push(`matrix target does not exist: ${rel}`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SSOT traceability check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `SSOT traceability check passed (${expected.length} expected targets, ${listed.length} listed)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`check-ssot-traceability failed: ${String(error)}\n`);
  process.exitCode = 1;
});
