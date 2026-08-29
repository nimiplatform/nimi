import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveProductControlDataRoot } from '../../../scripts/lib/product-control-data-root.mjs';

function normalize(value) {
  return String(value || '').trim();
}

class SmokePreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokePreflightError';
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertSafeRelativeFileRef(root, ref, label) {
  if (!ref || ref.includes('\0') || isAbsolute(ref)) {
    throw new Error(`${label} must be a relative file ref: ${ref}`);
  }
  const resolved = resolve(root, ref);
  const rel = relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`${label} escapes asset root: ${ref}`);
  }
  return resolved;
}

function avatarAssetsRoot(dataRoot) {
  return join(dataRoot, 'avatar-assets');
}

function live2dPackageDir(dataRoot, avatarAssetRef) {
  return join(avatarAssetsRoot(dataRoot), 'packages', 'live2d', avatarAssetRef);
}

function live2dSmokeRepairMessage(root) {
  return [
    `[avatar-live2d-smoke] missing Kit Shell Agent Center Live2D data under: ${root}`,
    '[avatar-live2d-smoke] Fix one of:',
    '  - complete or repair Product Control in Desktop',
    '  - import a Live2D Avatar asset through Agent Center, then rerun this smoke',
    '  - set NIMI_AVATAR_SMOKE_AVATAR_ASSET_REF to an exact imported asset ref',
  ].join('\n');
}

function explicitTarget(dataRoot) {
  const avatarAssetRef = normalize(process.env.NIMI_AVATAR_SMOKE_AVATAR_ASSET_REF);
  if (!avatarAssetRef) {
    return null;
  }
  return {
    avatarAssetRef,
    assetRoot: live2dPackageDir(dataRoot, avatarAssetRef),
  };
}

function findLive2dTarget(dataRoot) {
  const explicit = explicitTarget(dataRoot);
  if (explicit) return explicit;

  const root = join(avatarAssetsRoot(dataRoot), 'packages', 'live2d');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new SmokePreflightError(live2dSmokeRepairMessage(root));
  }

  for (const avatarAssetRef of readdirSync(root)) {
    if (!/^live2d_[a-f0-9]{12}$/u.test(avatarAssetRef)) continue;
    const assetRoot = join(root, avatarAssetRef);
    if (existsSync(join(assetRoot, 'manifest.json'))) {
      return { avatarAssetRef, assetRoot };
    }
  }

  throw new SmokePreflightError([
    `[avatar-live2d-smoke] no Kit Shell managed Live2D Avatar asset was found under: ${root}`,
    '[avatar-live2d-smoke] Import a Live2D Avatar asset through Agent Center, then rerun this smoke.',
  ].join('\n'));
}

function main() {
  const dataRoot = resolveProductControlDataRoot();
  const target = findLive2dTarget(dataRoot);
  if (!/^live2d_[a-f0-9]{12}$/u.test(target.avatarAssetRef)) {
    throw new Error(`Live2D Avatar asset ref is invalid: ${target.avatarAssetRef}`);
  }
  const manifestPath = join(target.assetRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new SmokePreflightError(`[avatar-live2d-smoke] Live2D Avatar asset manifest is missing: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const entryFile = normalize(manifest.entry_file);
  if (manifest.kind !== 'live2d' || manifest.local_asset_id !== target.avatarAssetRef) {
    throw new Error(`Live2D manifest identity mismatch: ${manifestPath}`);
  }
  if (!entryFile.startsWith('files/') || !entryFile.endsWith('.model3.json')) {
    throw new Error(`Live2D manifest entry_file is not a model3 entry under files/: ${entryFile}`);
  }
  const filesRoot = resolve(target.assetRoot, 'files');
  const model3Path = assertSafeRelativeFileRef(target.assetRoot, entryFile, 'Live2D manifest entry_file');
  if (!model3Path.startsWith(`${filesRoot}${sep}`)) {
    throw new Error(`Live2D manifest entry_file escapes files/: ${entryFile}`);
  }
  if (!existsSync(model3Path)) {
    throw new SmokePreflightError(`[avatar-live2d-smoke] Live2D model3 entry is missing: ${model3Path}`);
  }
  const model3 = readJson(model3Path);
  if (typeof model3.Version !== 'number') {
    throw new Error(`Live2D model3 entry is missing Version: ${model3Path}`);
  }
  console.log(JSON.stringify({
    status: 'ok',
    data_root: dataRoot,
    avatar_asset_ref: target.avatarAssetRef,
    backend_capability_profile_ref: `avatar.backend_profile:live2d:${target.avatarAssetRef}:import_validated`,
    asset_root: target.assetRoot,
    manifest_path: manifestPath,
    model3_path: model3Path,
    materialization_ref: `avatar-materialization:live2d:${target.avatarAssetRef}`,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack || error.message) : String(error));
  process.exitCode = 1;
}
