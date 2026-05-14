#!/usr/bin/env node

import process from 'node:process';

import { writeDesktopUpdaterTauriConfig } from './lib/desktop-updater-tauri-config.mjs';

function readOutputPath(argv) {
  const outputFlagIndex = argv.indexOf('--output');
  if (outputFlagIndex < 0) {
    throw new Error('--output is required');
  }
  const outputPath = argv[outputFlagIndex + 1];
  if (!outputPath) {
    throw new Error('--output requires a path');
  }
  return outputPath;
}

function main() {
  const outputPath = readOutputPath(process.argv.slice(2));
  const writtenPath = writeDesktopUpdaterTauriConfig(outputPath, {
    publicKey: process.env.NIMI_DESKTOP_UPDATER_PUBLIC_KEY || '',
    endpoint: process.env.NIMI_DESKTOP_UPDATER_ENDPOINT || '',
  });
  process.stdout.write(`[write-updater-tauri-config] wrote ${writtenPath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[write-updater-tauri-config] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
