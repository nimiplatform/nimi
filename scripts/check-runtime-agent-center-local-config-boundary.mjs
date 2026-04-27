#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const sourceExtensions = new Set(['.go', '.ts', '.tsx', '.js', '.mjs', '.json', '.yaml', '.yml', '.toml']);

const forbiddenPatterns = [
  { label: 'Agent Center local layout', regex: /agent-center\//gu },
  { label: 'legacy avatar package layout', regex: /avatar-packages\//gu },
  { label: 'Agent Center avatar package module layout', regex: /modules\/avatar_package\//gu },
  { label: 'Agent Center operation record', regex: /agent-center-local-resources\.jsonl/gu },
  { label: 'legacy avatar operation record', regex: /avatar-local-resources\.jsonl/gu },
  { label: 'Agent Center background field', regex: /\bbackground_asset_id\b/gu },
  { label: 'Agent Center selected package field', regex: /\bselected_package\b/gu },
  { label: 'Agent Center loader compatibility field', regex: /\bloader_min_version\b/gu },
  { label: 'Agent Center manifest path field', regex: /\bmanifest_path\b/gu },
  { label: 'Agent Center Live2D package id literal', regex: /\blive2d_[a-f0-9]{12}\b/gu },
  { label: 'Agent Center VRM package id literal', regex: /\bvrm_[a-f0-9]{12}\b/gu },
  { label: 'Agent Center background id literal', regex: /\bbg_[a-f0-9]{12}\b/gu },
];

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectFiles(dirPath) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'gen' || entry.name === 'generated' || entry.name === 'target') {
        continue;
      }
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
      continue;
    }
    if (entry.name === 'README.md') {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function collectViolations(source, relPath) {
  const violations = [];
  for (const { label, regex } of forbiddenPatterns) {
    regex.lastIndex = 0;
    let match = regex.exec(source);
    while (match) {
      const { line, column } = getLineColumn(source, match.index);
      violations.push(`${relPath}:${line}:${column} ${label}`);
      match = regex.exec(source);
    }
  }
  return violations;
}

async function main() {
  const files = await collectFiles(runtimeRoot);
  if (files.length === 0) {
    process.stderr.write('runtime Agent Center local config boundary check failed: no runtime files found\n');
    process.exitCode = 1;
    return;
  }

  const violations = [];
  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8');
    violations.push(...collectViolations(source, toRepoRelative(filePath)));
  }

  if (violations.length > 0) {
    process.stderr.write('runtime Agent Center local config boundary check failed\n');
    process.stderr.write('runtime must not read or model desktop-local Agent Center config/resources\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`runtime Agent Center local config boundary check passed (${files.length} files scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-runtime-agent-center-local-config-boundary failed: ${String(error)}\n`);
  process.exitCode = 1;
});
