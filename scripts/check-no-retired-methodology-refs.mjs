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
  'nimi-coding/',
];

const RETIRED_METHOD_SEGMENTS = ['nimi', 'coding'];
const RETIRED_METHOD_NAME = RETIRED_METHOD_SEGMENTS.join('-');
const RETIRED_CHECK_NAME = `check:${RETIRED_METHOD_NAME}-module`;
const RETIRED_LOCAL_ROOT = `${RETIRED_METHOD_NAME}/.local`;
const RETIRED_CONFIG_ROOT = `${RETIRED_METHOD_NAME}/config`;

const FORBIDDEN_TEXT_PATTERNS = [
  {
    label: 'retired methodology command',
    regex: new RegExp(`\\bpnpm ${RETIRED_METHOD_NAME}:[\\w-]+\\b`, 'g'),
  },
  {
    label: 'retired methodology script wrapper',
    regex: new RegExp(`node ${RETIRED_METHOD_NAME}/(?:cli/cli\\.mjs|scripts/[^\\s\\\`"']+)`, 'g'),
  },
  {
    label: 'retired methodology local workspace path',
    regex: new RegExp(`(^|[^/\\\\w-])${RETIRED_LOCAL_ROOT}(?:/|(?=[\\\`"' \\t)\\]},.:;]))`, 'gm'),
  },
  {
    label: 'retired methodology config path',
    regex: new RegExp(`(^|[^/\\\\w-])${RETIRED_CONFIG_ROOT}(?:/|(?=[\\\`"' \\t)\\]},.:;]))`, 'gm'),
  },
  {
    label: 'retired methodology module check',
    regex: new RegExp(`\\b${RETIRED_CHECK_NAME}\\b`, 'g'),
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
  process.stdout.write('retired methodology reference check: OK\n');
}

main();
