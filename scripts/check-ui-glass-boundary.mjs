#!/usr/bin/env node
// check:ui-glass-boundary
//
// CI gate for the canonical Nimi UI glass material contract.
//
// Fail-closes on any non-kit source that bypasses the admitted glass material
// contract. Bypass patterns scanned across `apps/**/src/**`, excluding
// `kit/ui/**`:
//
//   1. named Tailwind blur tokens outside kit utilities:
//        backdrop-blur, backdrop-blur-sm, backdrop-blur-md, backdrop-blur-lg,
//        backdrop-blur-xl, backdrop-blur-2xl, backdrop-blur-3xl,
//        backdrop-blur-0 / backdrop-blur-none
//   2. Tailwind arbitrary-value blur tokens with non-token values:
//        backdrop-blur-[4px], backdrop-blur-[56px], etc.
//   3. inline `backdropFilter` / `WebkitBackdropFilter` in JSX style props
//   4. CSS declarations `backdrop-filter` / `-webkit-backdrop-filter`
//
// Allowed-set:
//   - `backdrop-blur-[var(--nimi-backdrop-blur-*)]` token-backed utility at a
//     site whose owning JSX tag carries the matching `nimi-material-glass-*`
//     marker class for that exact blur token
//   - kit-emitted CSS inside `kit/ui/**` may author marker-backed
//     `backdrop-filter: var(--nimi-backdrop-blur-*)`, but this script never
//     scans `kit/ui/**`; every app-local CSS `backdrop-filter` remains a
//     violation and must be allowlisted until migrated
//
// Known-debt register:
//   - scripts/ui-glass-boundary.allowlist.txt
//   - Segment A (time-bounded migration deferrals).
//   - Segment B (pinned known debt); each entry requires an exact canonical
//     authority reference.
//
// Spec companion: .nimi/spec/platform/kernel/nimi-ui-material-contract.md
//
// Exit 0 on green. Exit 1 with a per-file violation report otherwise.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const ALLOWLIST_FILE = 'scripts/ui-glass-boundary.allowlist.txt';

// Scan roots: all apps; kit/ui is excluded by construction (never under apps/)
const SCAN_ROOTS = ['apps'];

// File extensions considered
const EXT_JSX = new Set(['.ts', '.tsx', '.js', '.jsx']);
const EXT_CSS = new Set(['.css', '.scss']);

// Directories skipped during walk
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.turbo', 'target',
  '__generated__', 'generated', 'gen', 'e2e-results', 'playwright-report',
  'src-tauri', // Rust layer — not in scope
  '_archive', 'archive',
  'test', 'tests', '__tests__', 'e2e', 'fixtures',
]);

// Filename patterns skipped (test/spec files may embed literal bypass strings
// as regex assertions against other files' content, which are not real bypass).
const SKIP_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.test.js', '.test.mjs', '.spec.ts', '.spec.tsx', '.spec.js'];

// ---------- Allowlist loader ----------

function loadAllowlist() {
  const abs = path.join(repoRoot, ALLOWLIST_FILE);
  if (!fs.existsSync(abs)) return { entries: new Set(), errors: [] };
  const raw = fs.readFileSync(abs, 'utf8');
  const entries = new Set();
  const errors = [];
  for (const [index, line] of raw.split('\n').entries()) {
    const stripped = line.replace(/#.*$/, '').trim();
    if (!stripped) continue;
    // Accept either "path:line" or "path:line  # comment"
    const m = stripped.match(/^([^\s]+:\d+)/);
    if (!m) continue;
    const key = m[1];
    entries.add(key);
    const lineNo = index + 1;
    if (line.includes('segment-B')) {
      const authorityMatch = line.match(/\bauthority:\s+(\S+)/);
      if (!authorityMatch) {
        errors.push(`${ALLOWLIST_FILE}:${lineNo} ${key} is segment-B but has no authority reference`);
        continue;
      }
      const authority = authorityMatch[1];
      const authorityError = validateAuthorityRef(authority);
      if (authorityError) {
        errors.push(`${ALLOWLIST_FILE}:${lineNo} ${key} has invalid authority "${authority}": ${authorityError}`);
      }
    }
  }
  return { entries, errors };
}

function validateAuthorityRef(authority) {
  if (/^(?:FOLLOWON-|TBD$|TODO$|PLACEHOLDER$)/i.test(authority)) {
    return 'placeholder authority references are forbidden';
  }
  if (!authority.startsWith('.nimi/spec/')) {
    return 'authority must resolve to a canonical .nimi/spec artifact';
  }
  const [fileRef, anchor] = authority.split('#', 2);
  if (!/^\.nimi\/spec\/.+/.test(fileRef)) {
    return 'authority must point inside .nimi/spec/';
  }
  const abs = path.join(repoRoot, fileRef);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return 'target file does not exist';
  }
  if (anchor && !markdownAnchorExists(abs, anchor)) {
    return 'target markdown anchor does not exist';
  }
  return null;
}

function markdownAnchorExists(abs, anchor) {
  const src = fs.readFileSync(abs, 'utf8');
  for (const line of src.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    if (markdownSlug(match[1]) === anchor) return true;
  }
  return false;
}

function markdownSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ---------- Walk ----------

function* walk(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      if (SKIP_FILE_SUFFIXES.some((s) => e.name.endsWith(s))) continue;
      yield full;
    }
  }
}

// ---------- Violation detectors ----------

// A site is considered "pair-valid" only when a token blur utility is emitted
// inside the same opening JSX tag as the marker class for the exact admitted
// tier/blur pairing. For CSS under apps/** there is no admitted app-local
// allowance: any authored `backdrop-filter` remains a violation.

const RX_JSX_NAMED_BLUR = /\bbackdrop-blur(?:-(?:sm|md|lg|xl|2xl|3xl|0|none))?\b/g;
const RX_JSX_ARBITRARY_BLUR = /backdrop-blur-\[([^\]]+)\]/g;
const RX_JSX_INLINE_FILTER = /\b(?:backdropFilter|WebkitBackdropFilter)\s*:/g;
const RX_CSS_FILTER = /(?:^|[\s;{])(?:-webkit-)?backdrop-filter\s*:/g;
const RX_MARKER = /\bnimi-material-glass-(thin|regular|thick|chrome)\b/g;

const RX_ALLOWED_ARBITRARY = /^var\(--nimi-backdrop-blur-[a-z-]+\)$/;
const RX_ALLOWED_CSS_VALUE = /var\(--nimi-backdrop-blur-[a-z-]+\)/;
const BLUR_TOKEN_TO_TIER = new Map([
  ['var(--nimi-backdrop-blur-thin)', 'thin'],
  ['var(--nimi-backdrop-blur-regular)', 'regular'],
  ['var(--nimi-backdrop-blur-strong)', 'thick'],
  ['var(--nimi-backdrop-blur-chrome)', 'chrome'],
]);

function contextWindow(src, idx, radius = 400) {
  const from = Math.max(0, idx - radius);
  const to = Math.min(src.length, idx + radius);
  return src.slice(from, to);
}

function jsxTagWindow(src, idx, radius = 2400) {
  const floor = Math.max(0, idx - radius);
  const ceil = Math.min(src.length, idx + radius);
  const start = src.lastIndexOf('<', idx);
  const end = src.indexOf('>', idx);
  if (start >= floor && end >= idx && end <= ceil) {
    return src.slice(start, end + 1);
  }
  return contextWindow(src, idx, 400);
}

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function scanJsx(rel, src) {
  const out = [];

  // (1) named blur
  let m;
  RX_JSX_NAMED_BLUR.lastIndex = 0;
  while ((m = RX_JSX_NAMED_BLUR.exec(src)) !== null) {
    // Skip if matched inside a CSS variable name like `--nimi-backdrop-blur-*`
    // (char before the match is `-` → part of `--var-name`).
    const prev = m.index > 0 ? src.charCodeAt(m.index - 1) : 0;
    if (prev === 45 /* '-' */) continue;
    // Skip if this hit is the bare prefix of `backdrop-blur-[...]` (arbitrary form).
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (tail.startsWith('-[')) continue;
    out.push({
      file: rel,
      line: lineOf(src, m.index),
      kind: 'named-blur',
      excerpt: extractExcerpt(src, m.index),
    });
  }

  // (2) arbitrary blur
  RX_JSX_ARBITRARY_BLUR.lastIndex = 0;
  while ((m = RX_JSX_ARBITRARY_BLUR.exec(src)) !== null) {
    const valueRaw = m[1].trim();
    if (RX_ALLOWED_ARBITRARY.test(valueRaw)) {
      const ctx = jsxTagWindow(src, m.index);
      const markers = [...ctx.matchAll(RX_MARKER)].map((hit) => hit[1]);
      const expectedTier = BLUR_TOKEN_TO_TIER.get(valueRaw);
      if (markers.length === 0) {
        out.push({
          file: rel,
          line: lineOf(src, m.index),
          kind: 'token-blur-without-marker',
          excerpt: extractExcerpt(src, m.index),
        });
      } else if (expectedTier && !markers.includes(expectedTier)) {
        out.push({
          file: rel,
          line: lineOf(src, m.index),
          kind: 'token-blur-tier-mismatch',
          value: `${valueRaw} :: markers=${markers.join(',')}`,
          excerpt: extractExcerpt(src, m.index),
        });
      }
      continue;
    }
    out.push({
      file: rel,
      line: lineOf(src, m.index),
      kind: 'arbitrary-blur',
      value: valueRaw,
      excerpt: extractExcerpt(src, m.index),
    });
  }

  // (3) inline JSX filter
  RX_JSX_INLINE_FILTER.lastIndex = 0;
  while ((m = RX_JSX_INLINE_FILTER.exec(src)) !== null) {
    out.push({
      file: rel,
      line: lineOf(src, m.index),
      kind: 'inline-filter',
      excerpt: extractExcerpt(src, m.index),
    });
  }

  return out;
}

function scanCss(rel, src) {
  const out = [];
  let m;
  RX_CSS_FILTER.lastIndex = 0;
  while ((m = RX_CSS_FILTER.exec(src)) !== null) {
    // Extract value up to next ;
    const start = m.index + m[0].length;
    const end = src.indexOf(';', start);
    const value = (end >= 0 ? src.slice(start, end) : src.slice(start, start + 120)).trim();
    out.push({
      file: rel,
      line: lineOf(src, m.index),
      kind: RX_ALLOWED_CSS_VALUE.test(value) ? 'css-token-backdrop-filter' : 'css-backdrop-filter',
      value,
      excerpt: extractExcerpt(src, m.index),
    });
  }
  return out;
}

function extractExcerpt(src, idx) {
  const lineStart = src.lastIndexOf('\n', idx - 1) + 1;
  const lineEnd = src.indexOf('\n', idx);
  const raw = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim();
  return raw.length > 160 ? raw.slice(0, 157) + '...' : raw;
}

// ---------- Main ----------

function main() {
  const { entries: allowlist, errors: allowlistErrors } = loadAllowlist();
  if (allowlistErrors.length > 0) {
    process.stderr.write(`check:ui-glass-boundary — FAIL (${allowlistErrors.length} allowlist ticket errors)\n\n`);
    for (const error of allowlistErrors) {
      process.stderr.write(`  ${error}\n`);
    }
    process.stderr.write(`\nAllowlist: ${ALLOWLIST_FILE}\n`);
    process.exit(1);
  }
  const violations = [];

  for (const root of SCAN_ROOTS) {
    const absRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absRoot)) continue;
    for (const abs of walk(absRoot)) {
      const ext = path.extname(abs);
      const rel = path.relative(repoRoot, abs);
      let res = [];
      if (EXT_JSX.has(ext)) {
        const src = fs.readFileSync(abs, 'utf8');
        res = scanJsx(rel, src);
      } else if (EXT_CSS.has(ext)) {
        const src = fs.readFileSync(abs, 'utf8');
        res = scanCss(rel, src);
      }
      for (const v of res) {
        const key = `${v.file}:${v.line}`;
        if (allowlist.has(key)) continue;
        violations.push(v);
      }
    }
  }

  if (violations.length === 0) {
    process.stdout.write('check:ui-glass-boundary — OK (zero unallowlisted bypass sites)\n');
    process.exit(0);
  }

  process.stderr.write(`check:ui-glass-boundary — FAIL (${violations.length} violations)\n\n`);
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }
  for (const [file, vs] of [...byFile.entries()].sort()) {
    process.stderr.write(`${file}\n`);
    for (const v of vs) {
      const detail = v.value ? ` (${v.value})` : '';
      process.stderr.write(`  :${v.line}  ${v.kind}${detail}\n    ${v.excerpt}\n`);
    }
  }
  process.stderr.write(`\nAllowlist: ${ALLOWLIST_FILE}\n`);
  process.stderr.write(`Spec: .nimi/spec/platform/kernel/nimi-ui-material-contract.md\n`);
  process.exit(1);
}

main();
