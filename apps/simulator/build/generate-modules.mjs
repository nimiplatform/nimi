#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadSimulatorConfig } from './config.mjs';
import { GENERATED_ROOT, CONFIG_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';
import { generateSelectedModuleRegistry } from './registry.mjs';

function replaceGeneratedRoot(stagedRoot) {
  const backupRoot = `${GENERATED_ROOT}-backup-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    if (existsSync(GENERATED_ROOT)) {
      renameSync(GENERATED_ROOT, backupRoot);
      movedExisting = true;
    }
    renameSync(stagedRoot, GENERATED_ROOT);
    if (movedExisting) rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(GENERATED_ROOT) && movedExisting && existsSync(backupRoot)) {
      renameSync(backupRoot, GENERATED_ROOT);
    }
    throw error;
  } finally {
    if (existsSync(stagedRoot)) rmSync(stagedRoot, { recursive: true, force: true });
  }
}

export function generateSelectedModules() {
  const inputs = loadSimulatorConfig(CONFIG_ROOT);
  const stagedRoot = mkdtempSync(path.join(SIMULATOR_ROOT, '.generated-stage-'));
  try {
    const generated = generateSelectedModuleRegistry({
      descriptors: inputs.descriptors,
      scenario: inputs.scenario,
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      generatedRoot: stagedRoot,
    });
    replaceGeneratedRoot(stagedRoot);
    return generated;
  } catch (error) {
    if (existsSync(stagedRoot)) rmSync(stagedRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('generate-modules does not accept command-line options');
  const generated = generateSelectedModules();
  process.stdout.write(`simulator-modules: generated ${generated.moduleCount} modules\n`);
}
