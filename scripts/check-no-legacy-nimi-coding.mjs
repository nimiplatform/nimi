#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.yaml',
  '.yml',
  '.json',
  '.jsonc',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.go',
  '.rs',
  '.sh',
  '.env',
]);

const TEXT_BASENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'ONBOARDING.md',
  'PROMPT.md',
  'SKILL.md',
  'package.json',
  '.gitignore',
  '.markdownlint-cli2.jsonc',
]);

const EXCLUDED_PREFIXES = [
  '.iterate/',
  '.cache/',
  '.openclaw/',
  'docs/_archive/',
  'archive/',
];

const FORBIDDEN_PATH_PATTERNS = [
  /^nimi-coding\//,
];

const FORBIDDEN_TEXT_PATTERNS = [
  {
    label: 'legacy nimi-coding command',
    regex: /\bpnpm nimi-coding:[\w-]+\b/g,
  },
  {
    label: 'legacy nimi-coding script wrapper',
    regex: /node nimi-coding\/(?:cli\/cli\.mjs|scripts\/[^\s`"']+)/g,
  },
  {
    label: 'legacy nimi-coding local workspace path',
    regex: /(^|[^/\w-])nimi-coding\/\.local(?:\/|(?=[`"' \t)\]},.:;]))/gm,
  },
  {
    label: 'legacy nimi-coding config path',
    regex: /(^|[^/\w-])nimi-coding\/config(?:\/|(?=[`"' \t)\]},.:;]))/gm,
  },
  {
    label: 'legacy nimi-coding module check',
    regex: /\bcheck:nimi-coding-module\b/g,
  },
];

function listWorkingTreeFiles(cwd) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout || '')
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((relativePath) => fs.existsSync(path.join(cwd, relativePath)));
}

function shouldSkip(relativePath) {
  return EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function shouldScanText(relativePath) {
  const basename = path.basename(relativePath);
  if (TEXT_BASENAMES.has(basename)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(relativePath));
}

function lineNumberForIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

function collectLegacyFailures(cwd) {
  const failures = [];
  const trackedFiles = listWorkingTreeFiles(cwd);

  for (const relativePath of trackedFiles) {
    if (shouldSkip(relativePath)) {
      continue;
    }

    for (const pattern of FORBIDDEN_PATH_PATTERNS) {
      if (pattern.test(relativePath)) {
        failures.push(`legacy nimi-coding path tracked: ${relativePath}`);
        break;
      }
    }

    if (!shouldScanText(relativePath)) {
      continue;
    }

    const absolutePath = path.join(cwd, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }

    let source;
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      continue;
    }

    for (const { label, regex } of FORBIDDEN_TEXT_PATTERNS) {
      regex.lastIndex = 0;
      const match = regex.exec(source);
      if (!match) {
        continue;
      }
      const index = match.index + (match[1] ? match[1].length : 0);
      failures.push(`${label} in ${relativePath}:${lineNumberForIndex(source, index)}`);
    }
  }

  return failures;
}

function main() {
  const failures = collectLegacyFailures(process.cwd());
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`ERROR: ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('legacy nimi-coding cleanup check: OK\n');
}

main();
