#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const desktopSrcRoot = path.join(repoRoot, 'apps/desktop/src');

const scanRoots = [
  path.join(desktopSrcRoot, 'runtime'),
  path.join(desktopSrcRoot, 'shell/renderer'),
];

const violations = [];

function walk(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath);
      continue;
    }
    if (!/\.(ts|tsx)$/u.test(entry.name)) {
      continue;
    }
    const relPath = path.relative(repoRoot, entryPath).replace(/\\/g, '/');
    const content = fs.readFileSync(entryPath, 'utf8');
    if (
      content.includes('/e2e/profile')
      || content.includes('/e2e/window-hook')
      || content.includes('getDesktopE2EFixture')
      || content.includes('__NIMI_E2E__')
    ) {
      violations.push(relPath);
    }
  }
}

for (const root of scanRoots) {
  walk(root);
}

if (violations.length > 0) {
  process.stderr.write(
    `desktop E2E bypass is forbidden in production renderer/runtime code:\n${violations.map((item) => `- ${item}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write('desktop-no-e2e-bypass: OK\n');
