#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectStaticVersionSyncViolations, readJson } from './lib/desktop-release-sync.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const args = {
    expected: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--expected') {
      args.expected = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const desktopPackage = readJson(path.join(desktopRoot, 'package.json'));
  const expected = args.expected || String(desktopPackage.version || '').trim();
  const violations = collectStaticVersionSyncViolations(desktopRoot, expected);

  if (violations.length > 0) {
    process.stderr.write(`${violations.map((line) => `- ${line}`).join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write(`[check-version-sync] version=${expected}\n`);
}

main();
