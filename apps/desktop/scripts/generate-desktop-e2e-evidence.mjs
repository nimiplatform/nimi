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
    suiteOutcome: '',
    nativeDriver: '',
    tauriDriver: '',
    appMode: '',
    artifactRoot: '',
    artifactUploadPath: '',
    outputDir: '',
  };

  const optionFields = new Map([
    ['--platform', 'platform'],
    ['--workflow-ref', 'workflowRef'],
    ['--workflow-run-id', 'workflowRunId'],
    ['--commit', 'commit'],
    ['--suite-outcome', 'suiteOutcome'],
    ['--native-driver', 'nativeDriver'],
    ['--tauri-driver', 'tauriDriver'],
    ['--app-mode', 'appMode'],
    ['--artifact-root', 'artifactRoot'],
    ['--artifact-upload-path', 'artifactUploadPath'],
    ['--output-dir', 'outputDir'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const field = optionFields.get(token);
    if (!field) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || String(value).startsWith('--')) {
      throw new Error(`${token} requires a value`);
    }
    args[field] = String(value).trim();
    index += 1;
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
  suiteOutcome: args.suiteOutcome,
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
if (!evidence.ok) {
  process.stderr.write('[generate-desktop-e2e-evidence] evidence verdict is FAIL\n');
  process.exitCode = 1;
}
