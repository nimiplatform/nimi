#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildDesktopE2EEvidence,
  writeDesktopE2EEvidence,
} from './lib/desktop-e2e-evidence.mjs';

function parseArgs(argv) {
  const args = {
    platform: '',
    workflowRef: '',
    workflowRunId: '',
    commit: '',
    smokeOutcome: '',
    journeysOutcome: '',
    nativeDriver: '',
    tauriDriver: '',
    appMode: '',
    artifactRoot: '',
    artifactUploadPath: '',
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--platform') {
      args.platform = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--workflow-ref') {
      args.workflowRef = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--workflow-run-id') {
      args.workflowRunId = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--commit') {
      args.commit = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--smoke-outcome') {
      args.smokeOutcome = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--journeys-outcome') {
      args.journeysOutcome = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--native-driver') {
      args.nativeDriver = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--tauri-driver') {
      args.tauriDriver = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--app-mode') {
      args.appMode = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--artifact-root') {
      args.artifactRoot = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--artifact-upload-path') {
      args.artifactUploadPath = String(argv[index + 1] || '').trim();
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
const outputDir = path.resolve(args.outputDir || path.join(desktopRoot, 'reports', 'e2e', 'evidence'));
const evidence = buildDesktopE2EEvidence({
  desktopRoot,
  platform: args.platform,
  workflowRef: args.workflowRef,
  workflowRunId: args.workflowRunId,
  commit: args.commit,
  smokeOutcome: args.smokeOutcome,
  journeysOutcome: args.journeysOutcome,
  nativeDriver: args.nativeDriver,
  tauriDriver: args.tauriDriver,
  appMode: args.appMode,
  artifactRoot: args.artifactRoot,
  artifactUploadPath: args.artifactUploadPath,
});

const safePlatform = args.platform.replace(/[^A-Za-z0-9._-]+/g, '-');
const jsonPath = path.join(outputDir, `desktop-e2e-evidence-${safePlatform}.json`);
const markdownPath = path.join(outputDir, `desktop-e2e-evidence-${safePlatform}.md`);
writeDesktopE2EEvidence(jsonPath, markdownPath, evidence);

process.stdout.write(
  `[generate-desktop-e2e-evidence] wrote ${path.relative(desktopRoot, jsonPath)} and ${path.relative(desktopRoot, markdownPath)}\n`,
);
