#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildDesktopVrmWave4Evidence,
  writeDesktopVrmWave4Evidence,
} from './lib/desktop-vrm-wave4-evidence.mjs';

function parseArgs(argv) {
  const args = {
    smokeRoot: '',
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--smoke-root') {
      args.smokeRoot = String(argv[index + 1] || '').trim();
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
const outputDir = path.resolve(args.outputDir || path.join(desktopRoot, 'reports', 'vrm-wave4'));
const evidence = buildDesktopVrmWave4Evidence({
  desktopRoot,
  smokeRoot: args.smokeRoot || undefined,
});
const jsonPath = path.join(outputDir, 'desktop-vrm-wave4-evidence.json');
const markdownPath = path.join(outputDir, 'desktop-vrm-wave4-evidence.md');
writeDesktopVrmWave4Evidence(jsonPath, markdownPath, evidence);

process.stdout.write(
  `[generate-desktop-vrm-wave4-evidence] wrote ${path.relative(desktopRoot, jsonPath)} and ${path.relative(desktopRoot, markdownPath)}\n`,
);

