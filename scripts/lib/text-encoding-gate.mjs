import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { TextDecoder } from 'node:util';

export const DEFAULT_MAX_FILE_BYTES = 2_000_000;
export const DEFAULT_MAX_REPORTED_VIOLATIONS = 100;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const SKIP_DIRS = new Set([
  '.cache',
  '.git',
  '.iterate',
  '_external',
  'archive',
  'build',
  'coverage',
  'dist',
  'gen',
  'generated',
  'node_modules',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.env',
  '.example',
  '.go',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.proto',
  '.properties',
  '.ps1',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsv',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_BASENAMES = new Set([
  '.editorconfig',
  '.gitignore',
  '.markdownlint-cli2.jsonc',
  '.npmrc',
  'AGENTS.md',
  'CLAUDE.md',
  'Dockerfile',
  'LICENSE',
  'Makefile',
  'README.md',
]);

export const DEFAULT_ALLOWLIST = [
  {
    path: 'apps/zhiyu/test/electron-acceptance.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7f01\u56e9\u7a98',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-acceptance.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7f02\u4f78\u6d28',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-acceptance.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7ed0',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-live-runtime-agent-center-helpers.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7f01\u56e9\u7a98',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-live-runtime-agent-center-helpers.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7f02\u4f78\u6d28',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-live-runtime-agent-center-helpers.mjs',
    ruleId: 'mojibake_utf8_as_gbk',
    value: '\u7ed0',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes a mojibake token.',
  },
  {
    path: 'apps/zhiyu/test/electron-live-runtime-agent-center-helpers.mjs',
    ruleId: 'replacement_character',
    value: '\uFFFD',
    lineIncludes: 'assert.doesNotMatch',
    reason: 'Negative acceptance assertion intentionally includes replacement character token.',
  },
];

export const SUSPICIOUS_PATTERNS = [
  {
    ruleId: 'replacement_character',
    pattern: /\uFFFD/gu,
    message: 'Unicode replacement character usually means earlier decode loss.',
  },
  {
    ruleId: 'mojibake_gbk_replacement',
    pattern: /\u951f\u65a4\u62f7|\u951f/gu,
    message: 'GBK replacement mojibake token detected.',
  },
  {
    ruleId: 'mojibake_windows_punctuation',
    pattern: /\u9225[\u003F\uFFFD]?|\u00C3[\u0080-\u00FF]?|\u00C2[\u0080-\u00FF]?|\u00E6[\u0080-\u00FF]?/gu,
    message: 'Windows/codepage punctuation mojibake token detected.',
  },
  {
    ruleId: 'mojibake_utf8_as_gbk',
    pattern: /\u7f01\u56e9\u7a98|\u7f02\u4f78\u6d28|\u7ed0|\u93c8|\u9366|\u6769|\u59af|\u7035|\u7d1d|\u9286|\u9365|\u85c9|\u59cf|\u7b1f|\u56ad|\u58d2|\u6f70|\u6b91/gu,
    message: 'UTF-8 text decoded as GBK mojibake token detected.',
  },
];

export function normalizeRepoPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '');
}

export function shouldScanRepoPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized || normalized === 'pnpm-lock.yaml') return false;

  const segments = normalized.split('/');
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return false;

  const basename = segments.at(-1) ?? '';
  if (TEXT_BASENAMES.has(basename)) return true;
  return TEXT_EXTENSIONS.has(path.extname(basename).toLowerCase());
}

export function scanBuffer({
  relativePath,
  buffer,
  allowlist = DEFAULT_ALLOWLIST,
}) {
  const normalizedPath = normalizeRepoPath(relativePath);
  const allowlistHits = new Set();
  const violations = [];
  let text;

  try {
    text = UTF8_DECODER.decode(buffer);
  } catch {
    violations.push({
      relativePath: normalizedPath,
      line: 1,
      col: 1,
      ruleId: 'invalid_utf8',
      value: 'invalid UTF-8 byte sequence',
      message: 'File is not valid UTF-8.',
      snippet: '',
    });
    return { violations, allowlistHits, bytes: buffer.length };
  }

  for (const rule of SUSPICIOUS_PATTERNS) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = String(match[0] ?? '');
      const index = match.index ?? 0;
      const location = locate(text, index);
      const lineText = getLine(text, location.line);
      const allowlistKey = findAllowlistKey({
        allowlist,
        relativePath: normalizedPath,
        ruleId: rule.ruleId,
        value,
        lineText,
      });
      if (allowlistKey) {
        allowlistHits.add(allowlistKey);
        continue;
      }
      violations.push({
        relativePath: normalizedPath,
        line: location.line,
        col: location.col,
        ruleId: rule.ruleId,
        value,
        message: rule.message,
        snippet: lineText.trim().slice(0, 240),
      });
    }
  }

  return { violations, allowlistHits, bytes: buffer.length };
}

export function scanFileRecords(records, {
  allowlist = DEFAULT_ALLOWLIST,
  enforceAllowlistCoverage = false,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  const started = performance.now();
  const violations = [];
  const allowlistHits = new Set();
  let scannedFiles = 0;
  let skippedFiles = 0;
  let bytes = 0;

  for (const record of records) {
    const relativePath = normalizeRepoPath(record.relativePath);
    if (!shouldScanRepoPath(relativePath)) {
      skippedFiles += 1;
      continue;
    }
    if (record.buffer.length > maxFileBytes) {
      skippedFiles += 1;
      continue;
    }

    scannedFiles += 1;
    bytes += record.buffer.length;
    const result = scanBuffer({ relativePath, buffer: record.buffer, allowlist });
    violations.push(...result.violations);
    for (const key of result.allowlistHits) allowlistHits.add(key);
  }

  if (enforceAllowlistCoverage) {
    for (const entry of allowlist) {
      const key = allowlistEntryKey(entry);
      if (allowlistHits.has(key)) continue;
      violations.push({
        relativePath: normalizeRepoPath(entry.path),
        line: 1,
        col: 1,
        ruleId: 'stale_allowlist',
        value: entry.value,
        message: `Encoding gate allowlist entry was not used: ${entry.reason}`,
        snippet: entry.lineIncludes,
      });
    }
  }

  return {
    violations,
    scannedFiles,
    skippedFiles,
    bytes,
    elapsedMs: performance.now() - started,
  };
}

export function scanRepo({
  cwd = process.cwd(),
  stagedOnly = false,
  allowlist = DEFAULT_ALLOWLIST,
  enforceAllowlistCoverage = !stagedOnly,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  const started = performance.now();
  const files = listGitFiles(cwd, stagedOnly);
  const violations = [];
  const allowlistHits = new Set();
  let scannedFiles = 0;
  let skippedFiles = 0;
  let bytes = 0;

  for (const file of files) {
    const relativePath = normalizeRepoPath(file);
    if (!shouldScanRepoPath(relativePath)) {
      skippedFiles += 1;
      continue;
    }

    const absolutePath = path.resolve(cwd, relativePath);
    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      skippedFiles += 1;
      continue;
    }
    if (!stat.isFile() || stat.size > maxFileBytes) {
      skippedFiles += 1;
      continue;
    }

    const buffer = readFileSync(absolutePath);
    scannedFiles += 1;
    bytes += buffer.length;
    const result = scanBuffer({ relativePath, buffer, allowlist });
    violations.push(...result.violations);
    for (const key of result.allowlistHits) allowlistHits.add(key);
  }

  if (enforceAllowlistCoverage) {
    for (const entry of allowlist) {
      const key = allowlistEntryKey(entry);
      if (allowlistHits.has(key)) continue;
      violations.push({
        relativePath: normalizeRepoPath(entry.path),
        line: 1,
        col: 1,
        ruleId: 'stale_allowlist',
        value: entry.value,
        message: `Encoding gate allowlist entry was not used: ${entry.reason}`,
        snippet: entry.lineIncludes,
      });
    }
  }

  return {
    violations,
    files: files.length,
    scannedFiles,
    skippedFiles,
    bytes,
    elapsedMs: performance.now() - started,
  };
}

export function formatViolation(violation) {
  const location = `${violation.relativePath}:${violation.line}:${violation.col}`;
  const suffix = violation.snippet ? `\n    ${violation.snippet}` : '';
  return `${location} [${violation.ruleId}] ${violation.message} (${JSON.stringify(violation.value)})${suffix}`;
}

export function formatSummary(result) {
  const mb = (result.bytes / 1024 / 1024).toFixed(2);
  return `${result.scannedFiles} file(s), ${mb} MB, ${result.elapsedMs.toFixed(1)} ms`;
}

function listGitFiles(cwd, stagedOnly) {
  const args = stagedOnly
    ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
    : ['ls-files', '-z'];
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function locate(text, index) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function getLine(text, lineNumber) {
  return text.split(/\r?\n/u)[lineNumber - 1] ?? '';
}

function findAllowlistKey({ allowlist, relativePath, ruleId, value, lineText }) {
  for (const entry of allowlist) {
    if (normalizeRepoPath(entry.path) !== relativePath) continue;
    if (entry.ruleId !== ruleId) continue;
    if (entry.value !== value) continue;
    if (!lineText.includes(entry.lineIncludes)) continue;
    return allowlistEntryKey(entry);
  }
  return '';
}

function allowlistEntryKey(entry) {
  return [
    normalizeRepoPath(entry.path),
    entry.ruleId,
    entry.value,
    entry.lineIncludes,
  ].join('\0');
}
