#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';

import { normalizeDesktopUpdaterPublicKey } from './lib/desktop-updater-public-key.mjs';

function writeGithubEnv(name, value) {
  const outputPath = process.env.GITHUB_ENV;
  if (!outputPath) {
    throw new Error('GITHUB_ENV is required when --write-github-env is set');
  }
  fs.appendFileSync(
    outputPath,
    `${name}<<__NIMI_DESKTOP_UPDATER_PUBLIC_KEY__\n${value}\n__NIMI_DESKTOP_UPDATER_PUBLIC_KEY__\n`,
    'utf8',
  );
}

function main() {
  const normalized = normalizeDesktopUpdaterPublicKey(process.env.NIMI_DESKTOP_UPDATER_PUBLIC_KEY || '');
  if (process.argv.includes('--write-github-env')) {
    writeGithubEnv('NIMI_DESKTOP_UPDATER_PUBLIC_KEY', normalized);
    process.stdout.write('[normalize-updater-public-key] normalized updater public key for tauri updater config\n');
    return;
  }
  process.stdout.write(`${normalized}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[normalize-updater-public-key] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

