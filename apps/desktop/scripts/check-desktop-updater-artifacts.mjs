#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';

import { collectDesktopUpdaterArtifactViolations } from './lib/desktop-updater-artifacts.mjs';

function parseArgs(argv) {
  const args = {
    artifactsFile: '',
    artifactsJson: '',
    expectedBundle: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--artifacts-file') {
      args.artifactsFile = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--artifacts-json') {
      args.artifactsJson = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--expected-bundle') {
      args.expectedBundle = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
let artifactPathsRaw = args.artifactsJson || process.env.NIMI_ARTIFACT_PATHS_JSON || '';
if (!artifactPathsRaw && args.artifactsFile) {
  artifactPathsRaw = fs.readFileSync(args.artifactsFile, 'utf8');
}

if (!artifactPathsRaw) {
  process.stderr.write(
    '[check-desktop-updater-artifacts] provide NIMI_ARTIFACT_PATHS_JSON or --artifacts-file/--artifacts-json\n',
  );
  process.exit(1);
}

let artifacts;
try {
  artifacts = JSON.parse(artifactPathsRaw);
} catch (error) {
  process.stderr.write(
    `[check-desktop-updater-artifacts] failed to parse NIMI_ARTIFACT_PATHS_JSON: ${String(error)}\n`,
  );
  process.exit(1);
}

const expectedBundle = args.expectedBundle || String(process.env.NIMI_EXPECTED_BUNDLE || '').trim();
const violations = collectDesktopUpdaterArtifactViolations({
  artifacts,
  expectedBundle,
});

if (violations.length > 0) {
  process.stderr.write(`${violations.map((line) => `- ${line}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  `[check-desktop-updater-artifacts] validated ${artifacts.length} tauri artifact(s)\n`,
);
