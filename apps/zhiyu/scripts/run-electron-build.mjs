#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSyncCommand } from '../../../scripts/lib/command-runner.mjs';
import {
  assessWorkspaceSurfaceFreshness,
  captureWorkspaceSurfaceSnapshot,
  readWorkspaceSurfaceStamp,
  workspaceSurfaceBuildDiagnostic,
} from '../../../scripts/lib/dev-workspace-surfaces.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

let result = spawnSyncCommand(pnpmBin, ['exec', 'tsc', '-p', 'tsconfig.electron.json'], {
  cwd: appRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.status === 0) {
  result = spawnSyncCommand(process.execPath, ['scripts/bundle-electron-preload.mjs'], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  });
}

if (result.status !== 0) {
  const stamp = await readWorkspaceSurfaceStamp(repoRoot);
  const diagnostics = [];
  for (const surface of ['sdk', 'kit']) {
    const snapshot = await captureWorkspaceSurfaceSnapshot(repoRoot, surface);
    const stamped = assessWorkspaceSurfaceFreshness(stamp, surface, snapshot);
    const diagnostic = workspaceSurfaceBuildDiagnostic(surface, stamped, snapshot);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  if (diagnostics.length > 0) {
    process.stderr.write(
      `[zhiyu build:electron] SDK/Kit dist freshness is not proven (${diagnostics.join(', ')}). `
      + 'Run pnpm dev:prepare:watch at the workspace root; the supervisor will not rebuild shared surfaces.\n',
    );
  }
}

process.exit(result.status ?? 1);
