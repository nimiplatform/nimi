/* global process */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
const rootEnvPath = path.resolve(workspaceRoot, '.env');
let envLoaded = false;

function loadDesktopEnvFiles() {
  if (envLoaded) {
    return;
  }
  envLoaded = true;
  if (typeof process.loadEnvFile !== 'function') {
    return;
  }

  if (!existsSync(rootEnvPath)) {
    return;
  }
  try {
    process.loadEnvFile(rootEnvPath);
  } catch {
    // Ignore malformed/unreadable optional env files and continue with explicit env.
  }
}

function ensureAbsoluteDir(envName, rawValue, options = {}) {
  loadDesktopEnvFiles();
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

export function resolveModsRoot() {
  loadDesktopEnvFiles();
  return ensureAbsoluteDir('NIMI_MODS_ROOT', process.env.NIMI_MODS_ROOT, {
    required: true,
    mustExist: true,
  });
}

export function resolveRuntimeModsDir(options = {}) {
  loadDesktopEnvFiles();
  return ensureAbsoluteDir('NIMI_RUNTIME_MODS_DIR', process.env.NIMI_RUNTIME_MODS_DIR, options);
}

export function sameNormalizedPath(left, right) {
  const leftPath = path.resolve(String(left || ''));
  const rightPath = path.resolve(String(right || ''));
  return leftPath === rightPath;
}
