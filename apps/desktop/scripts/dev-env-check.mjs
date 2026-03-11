#!/usr/bin/env node
/* global console, process */

import { resolveRuntimeModsDir } from './mod-paths.mjs';

const args = new Set(process.argv.slice(2));
const requireRuntimeModsDir = args.has('--require-runtime-mods-dir');

if (!requireRuntimeModsDir) {
  console.error(
    'Usage: node scripts/dev-env-check.mjs --require-runtime-mods-dir',
  );
  process.exit(1);
}

try {
  const runtimeModsDir = resolveRuntimeModsDir({ required: true, mustExist: true });
  if (runtimeModsDir) {
    console.log(`[dev-env-check] NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-env-check] ${message}`);
  process.exit(1);
}
