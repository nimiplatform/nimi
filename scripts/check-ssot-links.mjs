#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ssotRoot = path.join(repoRoot, 'ssot');

const LINK_PATTERN = /\[[^\]]*]\(([^)]+)\)/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const INLINE_SSOT_PATH_PATTERN = /(?:@nimiplatform\/nimi\/)?ssot\/[a-zA-Z0-9._/-]+\.md/g;
const ALLOWED_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'realm']);

function isMarkdownFile(name) {
  return name.endsWith('.md');
}

async function listMarkdownFiles(dir, baseDir = dir) {
  const files = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath, baseDir)));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return files;
}

function normalizeLinkTarget(rawTarget) {
  const trimmed = String(rawTarget || '').trim().replace(/^<|>$/g, '');
  if (!trimmed) return { target: '', violation: '' };
  const firstToken = trimmed.split(/\s+/)[0] || '';
  if (!firstToken) return { target: '', violation: '' };
  if (firstToken.startsWith('#')) return { target: '', violation: '' };

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(firstToken);
  if (schemeMatch) {
    const scheme = String(schemeMatch[1] || '').toLowerCase();
    if (ALLOWED_EXTERNAL_SCHEMES.has(scheme)) {
      return { target: '', violation: '' };
    }
    return {
      target: '',
      violation: `unsupported link scheme "${scheme}:" (allowed: ${[...ALLOWED_EXTERNAL_SCHEMES].join(', ')})`,
    };
  }

  const withoutQuery = firstToken.split('?')[0] || '';
  const withoutHash = withoutQuery.split('#')[0] || '';
  return { target: withoutHash, violation: '' };
}

function resolveTargetPath(filePath, target) {
  if (target.startsWith('/')) {
    return path.join(repoRoot, target.slice(1));
  }
  if (target.startsWith('@nimiplatform/nimi/')) {
    return path.join(repoRoot, target.slice('@nimiplatform/nimi/'.length));
  }
  if (target.startsWith('ssot/')) {
    return path.join(repoRoot, target);
  }
  return path.resolve(path.dirname(filePath), target);
}

async function main() {
  const violations = [];
  const files = await listMarkdownFiles(ssotRoot);

  for (const relPath of files) {
    const absPath = path.join(ssotRoot, relPath);
    const content = await fs.readFile(absPath, 'utf8');
    let match;
    while ((match = LINK_PATTERN.exec(content)) !== null) {
      const rawTarget = match[1];
      const normalized = normalizeLinkTarget(rawTarget);
      if (normalized.violation) {
        violations.push(`${relPath}: ${normalized.violation}`);
        continue;
      }
      const target = normalized.target;
      if (!target) {
        continue;
      }
      const resolved = resolveTargetPath(absPath, target);
      try {
        await fs.access(resolved);
      } catch {
        violations.push(`${relPath}: broken link "${target}"`);
      }
    }

    let codeMatch;
    while ((codeMatch = INLINE_CODE_PATTERN.exec(content)) !== null) {
      const code = String(codeMatch[1] || '');
      const inlinePaths = code.match(INLINE_SSOT_PATH_PATTERN) || [];
      for (const inlinePath of inlinePaths) {
        const resolved = resolveTargetPath(absPath, inlinePath);
        try {
          await fs.access(resolved);
        } catch {
          violations.push(`${relPath}: broken inline ssot path "${inlinePath}"`);
        }
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SSOT link check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`SSOT link check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-ssot-links failed: ${String(error)}\n`);
  process.exitCode = 1;
});
