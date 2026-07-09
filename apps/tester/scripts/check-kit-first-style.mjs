#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
const testerRoot = fileURLToPath(new URL('../src/tester/', import.meta.url));
const shellRoot = fileURLToPath(new URL('../src/shell/', import.meta.url));
const CSS_LINE_BUDGET = 950;
const KIT_ACTION_SURFACE_ROOTS = [testerRoot, shellRoot];
const failures = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }
    if (entry.endsWith('.css')) out.push(abs);
  }
  return out;
}

function walkTsx(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...walkTsx(abs));
      continue;
    }
    if (entry.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

const testerCssFiles = walk(testerRoot);
const allCssFiles = walk(srcRoot);
let totalLines = 0;

function scanCssFile(file, options) {
  const rel = relative(repoRoot, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/u);

  lines.forEach((line, index) => {
    const location = `${rel}:${index + 1}`;
    if (/(^|[,{]\s*)\.nimi-[^{,{]+[{,{]/u.test(line)) {
      failures.push(`${location}: tester CSS must not target kit .nimi-* internals`);
    }
    if (/(^|[,{]\s*)(button|input|textarea|select)([.#:[\s,{]|$)/u.test(line)) {
      failures.push(`${location}: tester CSS must not style raw form/action controls; use kit primitives`);
    }
    if (options.checkStrictPrimitiveFamilies && /\.([_a-zA-Z-][\w-]*(?:card|badge|button|field|select|nav|panel|alert|timeline)[\w-]*)/u.test(line)) {
      failures.push(`${location}: tester CSS must not define reusable primitive-family class names`);
    }
    if (
      options.checkGlobalPrimitiveFamilies &&
      /\.((?:workbench-card|workbench-grid|gallery-[\w-]+|kit-gallery[\w-]*|tester-nav[\w-]*|tester-layout|tester-panel[\w-]*|tester-detail-list|tester-main|tester-diagnostics|setting-row|panel-section|panel-heading|side-panel)[\w-]*)/u.test(line)
    ) {
      failures.push(`${location}: global tester CSS must not reintroduce local primitive/shell class families`);
    }
  });
}

for (const file of testerCssFiles) {
  const text = readFileSync(file, 'utf8');
  totalLines += text.split(/\r?\n/u).length;
}

for (const file of allCssFiles) {
  scanCssFile(file, { checkGlobalPrimitiveFamilies: true });
}

for (const file of testerCssFiles) {
  scanCssFile(file, { checkStrictPrimitiveFamilies: true });
}

for (const abs of KIT_ACTION_SURFACE_ROOTS.flatMap((root) => walkTsx(root))) {
  const text = readFileSync(abs, 'utf8');
  const rel = relative(repoRoot, abs);
  text.split(/\r?\n/u).forEach((line, index) => {
    if (/<\/?button\b/u.test(line)) {
      failures.push(`${rel}:${index + 1}: tester UI surfaces must compose Kit Button/IconButton instead of raw <button>`);
    }
  });
}

if (totalLines > CSS_LINE_BUDGET) {
  failures.push(`apps/tester/src/tester CSS has ${totalLines} lines; budget is ${CSS_LINE_BUDGET}`);
}

if (failures.length > 0) {
  console.error('[tester-kit-first-style] failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[tester-kit-first-style] passed (${totalLines}/${CSS_LINE_BUDGET} CSS lines)`);
