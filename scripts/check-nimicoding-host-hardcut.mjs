#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectHostHardcut,
  loadHostHardcutManifest,
} from './lib/nimicoding-host-hardcut.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.slice(2).includes('--json');

try {
  const manifest = await loadHostHardcutManifest(projectRoot);
  const report = await inspectHostHardcut(projectRoot, manifest);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `nimicoding host boundary hardcut: PASS (package ${report.packageVersion}; ${report.workspaceConsumerCount} workspace consumers aligned; ${report.retiredProjectionCount} retired projections absent; ${report.forbiddenInstalledSurfaceCount} retired package surfaces absent)\n`,
    );
  } else {
    process.stderr.write('nimicoding host boundary hardcut: FAIL\n');
    for (const failure of report.failures) {
      process.stderr.write(`- ${failure}\n`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`nimicoding host boundary hardcut: FAIL\n- ${error.message}\n`);
  process.exitCode = 1;
}
