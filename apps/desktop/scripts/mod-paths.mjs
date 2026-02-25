/* global process */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

function ensureAbsoluteDir(envName, rawValue, options = {}) {
  const { required = true, mustExist = true } = options;
  const normalized = String(rawValue || '').trim();

  if (!normalized) {
    if (required) {
      throw new Error(`Missing required env ${envName}.`);
    }
    return null;
  }

  if (!path.isAbsolute(normalized)) {
    throw new Error(`${envName} must be an absolute path. Received: ${normalized}`);
  }

  const resolved = path.resolve(normalized);
  if (mustExist) {
    if (!existsSync(resolved)) {
      throw new Error(`${envName} directory does not exist: ${resolved}`);
    }
    if (!statSync(resolved).isDirectory()) {
      throw new Error(`${envName} must point to a directory: ${resolved}`);
    }
  }

  return resolved;
}

export function resolveModsRoot(options = {}) {
  return ensureAbsoluteDir('NIMI_MODS_ROOT', process.env.NIMI_MODS_ROOT, options);
}

export function resolveRuntimeModsDir(options = {}) {
  return ensureAbsoluteDir('NIMI_RUNTIME_MODS_DIR', process.env.NIMI_RUNTIME_MODS_DIR, options);
}

export function sameNormalizedPath(left, right) {
  const leftPath = path.resolve(String(left || ''));
  const rightPath = path.resolve(String(right || ''));
  return leftPath === rightPath;
}
