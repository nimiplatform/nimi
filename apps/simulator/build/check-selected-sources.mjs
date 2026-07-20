#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSimulatorConfig } from './config.mjs';
import { materializeDescriptor } from './materialize.mjs';
import { CONFIG_ROOT, REPO_ROOT } from './paths.mjs';

const stagingRoot = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-selected-sources-'));
try {
  const { descriptors, repositoryCatalog } = loadSimulatorConfig(CONFIG_ROOT);
  const materialized = descriptors.map((descriptor) => materializeDescriptor(descriptor, repositoryCatalog, {
    workspaceRoot: REPO_ROOT,
    workspaceRepositoryKey: 'nimi',
    stagingRoot,
    release: true,
  }));
  const scriptExecutions = materialized.flatMap((entry) => entry.sourceLocations).reduce(
    (sum, entry) => sum + entry.sourceInstallScriptsExecuted + entry.sourceBuildScriptsExecuted,
    0,
  );
  if (scriptExecutions !== 0) throw new Error(`source materialization executed ${scriptExecutions} source scripts`);
  process.stdout.write(`simulator-selected-sources: OK (${descriptors.length} modules, ${materialized.flatMap((entry) => entry.sourceLocations).length} source locations, 0 source scripts)\n`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
