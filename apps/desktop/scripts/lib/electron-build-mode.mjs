import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function resolveDevKernelElectronBuildMode(env = process.env) {
  const value = String(env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || 'fresh').trim().toLowerCase();
  if (value !== 'fresh' && value !== 'reuse') {
    throw new Error(`NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE must be fresh or reuse, got ${value || '<empty>'}`);
  }
  return value;
}

export function requireReusableElectronArtifacts(files, binding = undefined) {
  const resolved = requireArtifactFiles(files);
  if (!binding) return resolved;
  const manifestPath = path.resolve(String(binding.manifestPath || ''));
  const sourceDigest = requireSourceDigest(binding.sourceDigest);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('reusable Electron artifact binding is missing or invalid');
  }
  if (manifest?.schemaVersion !== 'nimi.dev-kernel-electron-artifact-binding/v1'
    || manifest?.posture !== 'diagnostic_reuse_only'
    || manifest?.acceptanceEligible !== false
    || manifest?.sourceDigest !== sourceDigest
    || !Array.isArray(manifest?.artifacts)
    || manifest.artifacts.length !== resolved.length) {
    throw new Error('reusable Electron artifact binding is stale');
  }
  for (const file of resolved) {
    const key = path.relative(path.resolve(binding.repoRoot), file).replaceAll('\\', '/');
    const row = manifest.artifacts.find((entry) => entry?.path === key);
    if (!row || row.sha256 !== fileSha256(file)) {
      throw new Error(`reusable Electron artifact binding drifted: ${key}`);
    }
  }
  return resolved;
}

export function writeReusableElectronArtifactBinding(files, binding) {
  const resolved = requireArtifactFiles(files);
  const repoRoot = path.resolve(String(binding.repoRoot || ''));
  const manifestPath = path.resolve(String(binding.manifestPath || ''));
  const sourceDigest = requireSourceDigest(binding.sourceDigest);
  const artifacts = resolved.map((file) => ({
    path: path.relative(repoRoot, file).replaceAll('\\', '/'),
    sha256: fileSha256(file),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schemaVersion: 'nimi.dev-kernel-electron-artifact-binding/v1',
    posture: 'diagnostic_reuse_only',
    acceptanceEligible: false,
    sourceDigest,
    artifacts,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function requireArtifactFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('reusable Electron artifacts must be a non-empty file list');
  }
  const resolved = files.map((file) => path.resolve(String(file || '')));
  const missing = resolved.filter((file) => !fs.existsSync(file) || !fs.statSync(file).isFile());
  if (missing.length > 0) {
    throw new Error(`reusable Electron artifacts are missing: ${missing.join(', ')}`);
  }
  return resolved;
}

function requireSourceDigest(value) {
  const digest = String(value || '').trim();
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error('reusable Electron artifacts require an exact source digest');
  }
  return digest;
}

function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
