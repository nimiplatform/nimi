#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ssotRoot = path.join(repoRoot, 'ssot');

const REQUIRED_KEYS = ['title', 'status', 'updated_at', 'rules'];
const SKIP_RELATIVE = new Set(['_meta/template.md']);

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

function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return match[1];
}

function hasKey(frontmatter, key) {
  const re = new RegExp(`^${key}:`, 'm');
  return re.test(frontmatter);
}

function hasRulesItems(frontmatter) {
  const rulesBlock = frontmatter.match(/^rules:\s*\n([\s\S]*?)(?:^\w[\w-]*:|\s*$)/m);
  if (!rulesBlock) return false;
  return /^\s*-\s+\S+/m.test(rulesBlock[1]);
}

async function main() {
  const violations = [];
  const files = await listMarkdownFiles(ssotRoot);

  if (files.length === 0) {
    violations.push('ssot/ has no markdown files');
  }

  for (const relPath of files) {
    if (SKIP_RELATIVE.has(relPath)) continue;
    const absPath = path.join(ssotRoot, relPath);
    const content = await fs.readFile(absPath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    if (!frontmatter) {
      violations.push(`${relPath}: missing YAML frontmatter`);
      continue;
    }

    for (const key of REQUIRED_KEYS) {
      if (!hasKey(frontmatter, key)) {
        violations.push(`${relPath}: missing frontmatter key "${key}"`);
      }
    }
    if (hasKey(frontmatter, 'rules') && !hasRulesItems(frontmatter)) {
      violations.push(`${relPath}: frontmatter "rules" must include at least one list item`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SSOT frontmatter check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`SSOT frontmatter check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-ssot-frontmatter failed: ${String(error)}\n`);
  process.exitCode = 1;
});
