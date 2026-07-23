import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { loadSimulatorConfig } from './config.mjs';
import { GENERATED_ROOT, CONFIG_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';
import { buildPublicWebIsolationProof } from './public-web-isolation.mjs';
import { writeQualificationCache } from './qualification-cache.mjs';
import { qualifySelectedModules } from './registry.mjs';

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

export function loadQualificationInputs() {
  const config = loadSimulatorConfig(CONFIG_ROOT);
  return {
    ...config,
    publicWebIsolation: buildPublicWebIsolationProof({ repoRoot: REPO_ROOT }),
  };
}

export function runFreshQualification(inputs = loadQualificationInputs(), { release = true } = {}) {
  const stagedRoot = mkdtempSync(path.join(SIMULATOR_ROOT, '.generated-stage-'));
  try {
    const registry = qualifySelectedModules({
      descriptors: inputs.descriptors,
      repositoryCatalog: inputs.repositoryCatalog,
      scenario: inputs.scenario,
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
      generatedRoot: stagedRoot,
      release,
    });
    mkdirSync(path.join(stagedRoot, 'evidence'), { recursive: true });
    writeFileSync(
      path.join(stagedRoot, 'evidence', 'public-web-isolation.json'),
      `${JSON.stringify(inputs.publicWebIsolation, null, 2)}\n`,
    );
    writeQualificationCache({
      ...inputs,
      generatedRoot: stagedRoot,
      repoRoot: REPO_ROOT,
      simulatorRoot: SIMULATOR_ROOT,
    });
    replaceGeneratedRoot(stagedRoot);
    return registry;
  } catch (error) {
    if (existsSync(stagedRoot)) rmSync(stagedRoot, { recursive: true, force: true });
    throw error;
  }
}
