#!/usr/bin/env node

// Strict gate for Kit UI consistency audit findings.
//
// Scans kit/features/** and kit/ui/src/components/** and fails on every
// occurrence of the banned pattern families below:
//
//   hex-color                      literal hex colors (use --nimi-* tokens)
//   backdrop-filter-inline         inline backdrop-filter / backdropBlur style
//   backdrop-blur-arbitrary-literal  backdrop-blur-[<literal>] (token form
//                                  backdrop-blur-[var(--nimi-*)] stays legal)
//   blur-arbitrary-literal         blur-[<literal>] (blur-[var(--nimi-*)] legal)
//   blur-named-utility             blur-sm..blur-3xl / backdrop-blur-sm..3xl
//   text-literal-px                text-[<N>px] / text-[length:<N>px]
//                                  (text-[length:var(--nimi-*)] and
//                                  text-[var(--nimi-*)] stay legal)
//   transition-all                catch-all transitions
//   duration-literal-utility      duration-<N> instead of a motion token
//   motion-cubic-bezier           feature-local cubic-bezier curves
//   pressed-scale-literal         literal active scale instead of the shared
//                                 pressed-scale token
//
// Test/tooling files are exempt: assertions and fixtures legitimately quote
// class-name strings.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const violations = [];

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function listFilesRecursively(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ['dist', 'node_modules', 'target'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(abs, predicate));
    } else if (!predicate || predicate(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function isTestOrToolingFile(fileRel) {
  return /(?:^|\/)(?:test|tests|__tests__)\//u.test(fileRel)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(fileRel)
    || /\/(?:vitest|vite|eslint)\.config\.[cm]?[jt]s$/u.test(fileRel);
}

const RULES = [
  {
    id: 'hex-color',
    pattern: /#[0-9a-fA-F]{3,8}\b/gu,
    guidance: 'use --nimi-* color tokens instead of literal hex colors',
  },
  {
    id: 'backdrop-filter-inline',
    pattern: /\bbackdropBlur\b|\bbackdrop-filter\s*:/gu,
    guidance: 'use an admitted Surface material instead of inline backdrop-filter',
  },
  {
    id: 'backdrop-blur-arbitrary-literal',
    pattern: /backdrop-blur-\[(?!var\(--nimi-)/gu,
    guidance: 'use an admitted Surface material (backdrop-blur-[var(--nimi-*)] stays legal)',
  },
  {
    id: 'blur-arbitrary-literal',
    pattern: /(?<![a-z-])blur-\[(?!var\(--nimi-)/gu,
    guidance: 'no arbitrary blur values outside Kit surfaces (blur-[var(--nimi-*)] stays legal)',
  },
  {
    id: 'blur-named-utility',
    pattern: /\b(?:backdrop-)?blur-(?:sm|md|lg|2xl|3xl|xl)\b/gu,
    guidance: 'replace named blur utilities with an admitted material or token-driven radial treatment',
  },
  {
    id: 'text-literal-px',
    pattern: /\btext-\[(?:length:)?\d+(?:\.\d+)?px\]/gu,
    guidance: 'use text-[length:var(--nimi-type-*)] type tokens instead of literal px font sizes',
  },
  {
    id: 'transition-all',
    pattern: /\btransition-all\b/gu,
    guidance: 'list the transitioned properties explicitly',
  },
  {
    id: 'duration-literal-utility',
    pattern: /\bduration-\d+\b/gu,
    guidance: 'use duration-[var(--nimi-motion-*)] instead of a literal duration utility',
  },
  {
    id: 'motion-cubic-bezier',
    pattern: /\bcubic-bezier\(/gu,
    guidance: 'use one of the admitted --nimi-motion-ease-* tokens',
  },
  {
    id: 'pressed-scale-literal',
    pattern: /\bactive:scale-\[(?!var\(--nimi-motion-pressed-scale\))[^\]]+\]/gu,
    guidance: 'use active:scale-[var(--nimi-motion-pressed-scale)]',
  },
];

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const sourceFiles = ['kit/features', 'kit/ui/src/components']
  .map((entry) => path.join(repoRoot, entry))
  .flatMap((root) => listFilesRecursively(root, (absPath) => /\.(?:ts|tsx|cts|mts|css)$/u.test(absPath)));

for (const rule of RULES) {
  for (const absPath of sourceFiles) {
    const fileRel = rel(absPath);
    if (isTestOrToolingFile(fileRel)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    const matches = [...content.matchAll(rule.pattern)]
      .map((match) => ({ text: match[0], index: match.index ?? 0 }));
    if (matches.length > 0) {
      const locations = matches
        .map((match) => `    ${fileRel}:${lineNumberAt(content, match.index)}: ${match.text}`)
        .join('\n');
      violations.push(
        `${fileRel}: ${rule.id}; ${rule.guidance}\n${locations}`,
      );
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`kit-ui-consistency check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('kit-ui-consistency check passed\n');
