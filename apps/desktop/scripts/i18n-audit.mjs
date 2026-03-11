#!/usr/bin/env node
/* global console, process */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'scripts', 'i18n.config.json');

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Missing config: ${CONFIG_PATH}`);
  }
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const audit = parsed?.audit ?? {};
  return {
    scopeDirs: Array.isArray(audit.scopeDirs) ? audit.scopeDirs : [],
    extensions: Array.isArray(audit.extensions) ? audit.extensions : ['.ts', '.tsx'],
    excludePathPatterns: Array.isArray(audit.excludePathPatterns) ? audit.excludePathPatterns : [],
    allowTextPatterns: Array.isArray(audit.allowTextPatterns) ? audit.allowTextPatterns : [],
  };
}

function toPosixPath(pathLike) {
  return pathLike.replaceAll('\\', '/');
}

function shouldExcludeFile(input, excludePatterns) {
  const normalized = toPosixPath(input);
  return excludePatterns.some((pattern) => normalized.includes(String(pattern)));
}

function collectFiles(input) {
  const files = [];
  const stack = [input];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const stats = statSync(current);
    if (stats.isDirectory()) {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        stack.push(join(current, entry.name));
      }
      continue;
    }
    files.push(current);
  }
  return files;
}

function extractCandidatesFromLine(line, isTsxFile) {
  const candidates = [];
  const jsxTextRegex = />\s*([^<>{]+?)\s*</g;
  const attrRegex = /\b(?:aria-label|placeholder|title|label|description)\s*=\s*["'`]([^"'`]+)["'`]/g;

  const regexes = isTsxFile
    ? [jsxTextRegex, attrRegex]
    : [attrRegex];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(line))) {
      const text = String(match[1] || '').trim();
      if (text) {
        candidates.push(text);
      }
    }
  }
  return candidates;
}

function isLikelyTranslationKey(text) {
  return /^[A-Za-z0-9_.-]+$/.test(text) && text.includes('.');
}

function isTelemetryCode(text) {
  return /^[a-z0-9-]+(?::[a-z0-9-]+)+$/.test(text);
}

function isReasonCode(text) {
  return /^[A-Z0-9_]+$/.test(text);
}

function isUserVisibleLiteral(text) {
  if (!text) return false;
  if (!/[A-Za-z\u4E00-\u9FFF]/.test(text)) return false;
  if (text.includes('${')) return false;
  if (isLikelyTranslationKey(text)) return false;
  if (isTelemetryCode(text)) return false;
  if (isReasonCode(text)) return false;
  return true;
}

function isLikelyCodeFragment(text, line) {
  if (!text || !line) return false;
  if (text.includes(' as ')) return true;
  if (text.includes('&&') || text.includes('||') || text.includes('=>')) return true;
  if (/^[=<>!&|]/.test(text)) return true;
  if (text === 'Promise' && line.includes('Promise<')) return true;
  return false;
}

function runAudit() {
  const config = loadConfig();
  if (config.scopeDirs.length === 0) {
    console.log('i18n:audit skipped (no scopeDirs configured)');
    return true;
  }
  const allowRegexes = config.allowTextPatterns.map((pattern) => new RegExp(pattern));
  const violations = [];
  const seenFiles = new Set();

  for (const scopeDir of config.scopeDirs) {
    const absolute = join(ROOT, scopeDir);
    if (!existsSync(absolute)) {
      continue;
    }
    for (const filePath of collectFiles(absolute)) {
      const ext = extname(filePath);
      if (!config.extensions.includes(ext)) {
        continue;
      }
      const rel = toPosixPath(relative(ROOT, filePath));
      if (seenFiles.has(rel)) {
        continue;
      }
      seenFiles.add(rel);
      if (shouldExcludeFile(rel, config.excludePathPatterns)) {
        continue;
      }

      const source = readFileSync(filePath, 'utf8');
      const lines = source.split('\n');
      const isTsxFile = extname(filePath) === '.tsx';
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('//')) return;
        if (line.includes('t(\'') || line.includes('i18n.t(') || line.includes('defaultValue:')) return;

        const candidates = extractCandidatesFromLine(line, isTsxFile);
        for (const candidate of candidates) {
          if (!isUserVisibleLiteral(candidate)) continue;
          if (isLikelyCodeFragment(candidate, line)) continue;
          if (line.includes('message:') && isTelemetryCode(candidate)) continue;
          if (allowRegexes.some((regex) => regex.test(candidate))) continue;
          violations.push({
            file: rel,
            line: index + 1,
            text: candidate,
          });
        }
      });
    }
  }

  if (violations.length === 0) {
    console.log('✅ i18n:audit passed');
    return true;
  }

  console.error(`❌ i18n:audit found ${violations.length} hardcoded user-facing literal(s):`);
  for (const violation of violations.slice(0, 120)) {
    console.error(` - ${violation.file}:${violation.line} -> ${violation.text}`);
  }
  if (violations.length > 120) {
    console.error(` ... and ${violations.length - 120} more`);
  }
  return false;
}

try {
  const passed = runAudit();
  process.exit(passed ? 0 : 1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`❌ i18n:audit failed: ${message}`);
  process.exit(1);
}
