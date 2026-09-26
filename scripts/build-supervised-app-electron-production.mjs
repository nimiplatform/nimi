#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withWorkspaceSurfaces } from './lib/workspace-surfaces.mjs';
import { buildSupervisedAppElectronProduction } from './lib/supervised-app-electron-production.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const [flag, consumer, ...extra] = process.argv.slice(2);
  if (flag !== '--consumer' || !['nimigo', 'nimiday'].includes(consumer) || extra.length) {
    throw new Error('usage: build-supervised-app-electron-production.mjs --consumer nimigo|nimiday');
  }
  await withWorkspaceSurfaces({ repoRoot, label: `${consumer} production package` }, () => (
    buildSupervisedAppElectronProduction({ repoRoot, consumer })
  ));
} catch (error) {
  process.stderr.write(`[supervised-app production] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
