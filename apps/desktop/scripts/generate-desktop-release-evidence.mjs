#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildDesktopReleaseEvidence,
  writeDesktopReleaseEvidence,
} from './lib/desktop-release-evidence.mjs';

function parseArgs(argv) {
  const args = {
    expectedVersion: '',
    expectedBundle: '',
    platform: '',
    artifactPathsFile: '',
    outputDir: '',
    workflowRef: '',
    commit: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--expected-version') {
      args.expectedVersion = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--expected-bundle') {
      args.expectedBundle = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--platform') {
      args.platform = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--artifact-paths-file') {
      args.artifactPathsFile = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--output-dir') {
      args.outputDir = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--workflow-ref') {
      args.workflowRef = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--commit') {
      args.commit = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, '..');
const outputDir = path.resolve(args.outputDir || path.join(desktopRoot, 'reports'));

const artifactPathsRaw = args.artifactPathsFile
  ? fs.readFileSync(args.artifactPathsFile, 'utf8')
  : process.env.NIMI_ARTIFACT_PATHS_JSON || '';
if (!artifactPathsRaw) {
  process.stderr.write('[generate-desktop-release-evidence] artifact paths are required\n');
  process.exit(1);
}

let artifactPaths;
try {
  artifactPaths = JSON.parse(artifactPathsRaw);
} catch (error) {
  process.stderr.write(`[generate-desktop-release-evidence] failed to parse artifact paths: ${String(error)}\n`);
  process.exit(1);
}

const evidence = buildDesktopReleaseEvidence({
  desktopRoot,
  artifactPaths,
  expectedVersion: args.expectedVersion,
  expectedBundle: args.expectedBundle,
  platform: args.platform,
  workflowRef: args.workflowRef,
  commit: args.commit,
});

const safePlatform = args.platform.replace(/[^A-Za-z0-9._-]+/g, '-');
const jsonPath = path.join(outputDir, `desktop-release-evidence-${safePlatform}.json`);
const markdownPath = path.join(outputDir, `desktop-release-evidence-${safePlatform}.md`);
writeDesktopReleaseEvidence(jsonPath, markdownPath, evidence);

process.stdout.write(
  `[generate-desktop-release-evidence] wrote ${path.relative(desktopRoot, jsonPath)} and ${path.relative(desktopRoot, markdownPath)}\n`,
);
