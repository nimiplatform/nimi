#!/usr/bin/env node

// check-runtime-local-verified-asset-hardcut
//
// Guards the K-LOCAL-010 / K-LOCAL-011 hard-cut: verified local-asset truth is a
// projection of the K-MCAT `local` catalog (K-MCAT-032 local-plane rows). No
// in-process Go-literal verified-asset catalog may be reintroduced under
// runtime/internal/services/localservice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const localServiceDir = path.join(repoRoot, 'runtime', 'internal', 'services', 'localservice');

// Forbidden Go-literal verified-asset constructor names. These previously held a
// parallel hardcoded verified-asset catalog; the hard-cut removed them.
const forbiddenSymbols = ['defaultVerifiedAssets', 'defaultVerifiedPassiveAssets'];

let failed = false;

function fail(message) {
  failed = true;
  console.error(`ERROR: ${message}`);
}

function walkGoFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkGoFiles(full);
      }
      return entry.name.endsWith('.go') ? [full] : [];
    });
}

if (!fs.existsSync(localServiceDir)) {
  fail(`localservice directory not found: ${localServiceDir}`);
} else {
  for (const file of walkGoFiles(localServiceDir)) {
    if (file.endsWith('_test.go')) {
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const symbol of forbiddenSymbols) {
      // A function declaration reintroduces the parallel literal catalog.
      if (new RegExp(`func\\s+${symbol}\\s*\\(`).test(text)) {
        fail(`${path.relative(repoRoot, file)} declares ${symbol}: verified local-asset truth must derive from the K-MCAT local catalog (K-LOCAL-010/011), not a Go literal.`);
      }
    }
  }
}

if (failed) {
  console.error('runtime local verified-asset hard-cut check failed');
  process.exit(1);
}
console.log('runtime local verified-asset hard-cut check passed');
