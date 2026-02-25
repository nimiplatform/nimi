#!/usr/bin/env node
/* global console, process */

import { resolveModsRoot, resolveRuntimeModsDir, sameNormalizedPath } from './mod-paths.mjs';

const args = new Set(process.argv.slice(2));
const requireModsRoot = args.has('--require-mods-root');
const requireRuntimeModsDir = args.has('--require-runtime-mods-dir');
const expectRuntimeEqualsRoot = args.has('--expect-runtime-equals-root');

if (!requireModsRoot && !requireRuntimeModsDir) {
  console.error(
    'Usage: node scripts/dev-env-check.mjs --require-mods-root [--require-runtime-mods-dir] [--expect-runtime-equals-root]',
  );
  process.exit(1);
}

try {
  const modsRoot = requireModsRoot
    ? resolveModsRoot({ required: true, mustExist: true })
    : resolveModsRoot({ required: false, mustExist: true });
  const runtimeModsDir = requireRuntimeModsDir
    ? resolveRuntimeModsDir({ required: true, mustExist: true })
    : resolveRuntimeModsDir({ required: false, mustExist: true });

  if (expectRuntimeEqualsRoot && modsRoot && runtimeModsDir) {
    if (!sameNormalizedPath(modsRoot, runtimeModsDir)) {
      throw new Error(
        `NIMI_RUNTIME_MODS_DIR must equal NIMI_MODS_ROOT in local dev.\nNIMI_MODS_ROOT=${modsRoot}\nNIMI_RUNTIME_MODS_DIR=${runtimeModsDir}`,
      );
    }
  }

  if (modsRoot) {
    console.log(`[dev-env-check] NIMI_MODS_ROOT=${modsRoot}`);
  }
  if (runtimeModsDir) {
    console.log(`[dev-env-check] NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev-env-check] ${message}`);
  process.exit(1);
}
