#!/usr/bin/env node
/* global console, process */

import { resolveModsRoot, resolveRuntimeModsDir, sameNormalizedPath } from './mod-paths.mjs';

try {
  const modsRoot = resolveModsRoot();
  const runtimeModsDir = resolveRuntimeModsDir({ required: true, mustExist: true });
  if (!sameNormalizedPath(runtimeModsDir, `${modsRoot}/runtime`)) {
    throw new Error(
      `NIMI_RUNTIME_MODS_DIR must equal ${modsRoot}/runtime. Received: ${runtimeModsDir}`,
    );
  }
  console.log(`[env-check-mods-root] NIMI_MODS_ROOT=${modsRoot}`);
  console.log(`[env-check-mods-root] NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}`);
} catch (error) {
  console.error(`[env-check-mods-root] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
