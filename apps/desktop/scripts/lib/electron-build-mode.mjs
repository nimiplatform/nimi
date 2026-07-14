import fs from 'node:fs';
import path from 'node:path';

export function resolveDevKernelElectronBuildMode(env = process.env) {
  const value = String(env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || 'fresh').trim().toLowerCase();
  if (value !== 'fresh' && value !== 'reuse') {
    throw new Error(`NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE must be fresh or reuse, got ${value || '<empty>'}`);
  }
  return value;
}

export function requireReusableElectronArtifacts(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('reusable Electron artifacts must be a non-empty file list');
  }
  const missing = files
    .map((file) => path.resolve(String(file || '')))
    .filter((file) => !fs.existsSync(file) || !fs.statSync(file).isFile());
  if (missing.length > 0) {
    throw new Error(`reusable Electron artifacts are missing: ${missing.join(', ')}`);
  }
  return files.map((file) => path.resolve(file));
}
