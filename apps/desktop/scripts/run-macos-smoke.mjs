#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { selectScenarios } from '../e2e/helpers/registry.mjs';
import {
  buildApplication,
  ensureSupportedPlatform,
  makeRunRoot,
  parseArgs,
  repoRoot,
  runScenario,
} from './run-macos-smoke-support.mjs';

async function main() {const options = parseArgs(process.argv.slice(2));
  ensureSupportedPlatform();
  const selectedScenarios = selectScenarios(options);
  if (!options.skipBuild) {
    await buildApplication();
  }
  const run = makeRunRoot();
  let runIndex = 0;
  for (const scenarioId of selectedScenarios) {
    runIndex += 1;
    await runScenario({
      scenarioId,
      runIndex,
      runRoot: run.root,
      timeoutMs: options.timeoutMs,
    });
  }
  process.stdout.write(`[desktop-macos-smoke] wrote ${path.relative(repoRoot, run.root)}\n`);
}

main().catch((error) => {
  process.stderr.write(`[desktop-macos-smoke] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
