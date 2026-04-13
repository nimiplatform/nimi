#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildDesktopMacosSmokeEvidence,
  writeDesktopMacosSmokeEvidence,
} from './lib/desktop-macos-smoke-evidence.mjs';

function parseArgs(argv) {
  const args = {
    runRoot: '',
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--run-root') {
      args.runRoot = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--output-dir') {
      args.outputDir = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const outputDir = path.resolve(args.outputDir || path.join(desktopRoot, 'reports', 'desktop-macos-smoke'));
const evidence = buildDesktopMacosSmokeEvidence({
  desktopRoot,
  runRoot: args.runRoot || undefined,
});
const jsonPath = path.join(outputDir, 'desktop-macos-smoke-evidence.json');
const markdownPath = path.join(outputDir, 'desktop-macos-smoke-evidence.md');
writeDesktopMacosSmokeEvidence(jsonPath, markdownPath, evidence);

process.stdout.write(
  `[generate-desktop-macos-smoke-evidence] wrote ${path.relative(desktopRoot, jsonPath)} and ${path.relative(desktopRoot, markdownPath)}\n`,
);
