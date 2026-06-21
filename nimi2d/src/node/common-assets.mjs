import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { packageAssetFields } from './common-constants.mjs';
import {
  issue,
  isObject,
  requireFields,
  rejectUnknownFields,
  isSafeRelativePath,
  sha256,
} from './common-utils.mjs';

function parsePngInfo(buffer) {
  const signature = '89504e470d0a1a0a'; // pragma: allowlist secret
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== signature) {
    return null;
  }
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colorType: buffer.readUInt8(25),
  };
}

function validateAssetMetadataFields(asset, basePath, code, issues) {
  requireFields(
    asset,
    ['asset_id', 'asset_kind', 'ref', 'sha256', 'format', 'width_px', 'height_px', 'byte_size', 'color_space', 'alpha_mode', 'premultiplied_alpha'],
    code,
    basePath,
    issues,
  );
  rejectUnknownFields(asset, packageAssetFields, code, basePath, issues);
  if (!Number.isInteger(asset?.width_px) || asset.width_px <= 0) {
    issues.push(issue(code, `${basePath}.width_px`, 'Asset width must be a positive integer.'));
  }
  if (!Number.isInteger(asset?.height_px) || asset.height_px <= 0) {
    issues.push(issue(code, `${basePath}.height_px`, 'Asset height must be a positive integer.'));
  }
  if (!Number.isInteger(asset?.byte_size) || asset.byte_size <= 0) {
    issues.push(issue(code, `${basePath}.byte_size`, 'Asset byte size must be a positive integer.'));
  }
  if (typeof asset?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    issues.push(issue(code, `${basePath}.sha256`, 'Asset sha256 must be lowercase 64-character hex.'));
  }
}

async function validatePngAsset(layer, manifestDir, layerPath, issues) {
  const asset = layer.asset;
  if (!isObject(asset)) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', `${layerPath}.asset`, 'Missing asset object.'));
    return;
  }
  const required = ['ref', 'sha256', 'format', 'width_px', 'height_px', 'byte_size', 'color_space', 'alpha_mode', 'premultiplied_alpha'];
  requireFields(asset, required, 'NIMI2D_LAYER_INPUT_MANIFEST_INVALID', `${layerPath}.asset`, issues);
  if (!isSafeRelativePath(asset.ref)) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_REF_INVALID', `${layerPath}.asset.ref`, 'Asset ref must be in-root relative path.'));
    return;
  }
  if (asset.format !== 'png') issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_FORMAT_UNSUPPORTED', `${layerPath}.asset.format`, 'Only png is admitted.'));
  if (asset.color_space !== 'srgb') issues.push(issue('NIMI2D_LAYER_INPUT_COLOR_SPACE_UNSUPPORTED', `${layerPath}.asset.color_space`, 'Only srgb is admitted.'));
  if (asset.alpha_mode !== 'straight' || asset.premultiplied_alpha !== false) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ALPHA_MODE_UNSUPPORTED', `${layerPath}.asset.alpha_mode`, 'Only straight non-premultiplied alpha is admitted.'));
  }
  const absolute = path.resolve(manifestDir, asset.ref);
  if (!absolute.startsWith(`${manifestDir}${path.sep}`)) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_REF_INVALID', `${layerPath}.asset.ref`, 'Asset ref escapes manifest directory.'));
    return;
  }
  let buffer;
  try {
    buffer = await readFile(absolute);
  } catch {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_MISSING', `${layerPath}.asset.ref`, 'Asset file is missing.'));
    return;
  }
  const digest = sha256(buffer);
  if (asset.sha256 !== digest) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_HASH_MISMATCH', `${layerPath}.asset.sha256`, 'Asset sha256 mismatch.'));
  }
  const png = parsePngInfo(buffer);
  if (!png) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_FORMAT_UNSUPPORTED', `${layerPath}.asset.ref`, 'Asset is not a decodable PNG.'));
    return;
  }
  if (png.colorType !== 6 || png.bitDepth !== 8) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ASSET_NOT_RGBA', `${layerPath}.asset.ref`, 'PNG must be 8-bit RGBA.'));
  }
  if (asset.width_px !== png.width || asset.height_px !== png.height || asset.byte_size !== buffer.length) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', `${layerPath}.asset`, 'Asset dimensions or byte size do not match decoded PNG.'));
  }
}

async function validatePackageAssets(value, manifestDir, issues) {
  const assets = Array.isArray(value.assets) ? value.assets : [];
  if (assets.length === 0) {
    issues.push(issue('NIMI2D_PACKAGE_ASSET_INVALID', '$.assets', 'Package assets are required.'));
    return;
  }
  for (const [index, asset] of assets.entries()) {
    const base = `$.assets[${index}]`;
    if (!isObject(asset)) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_INVALID', base, 'Package asset must be an object.'));
      continue;
    }
    validateAssetMetadataFields(asset, base, 'NIMI2D_PACKAGE_ASSET_INVALID', issues);
    if (!isSafeRelativePath(asset.ref)) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_REF_INVALID', `${base}.ref`, 'Asset ref must be in-root relative path.'));
      continue;
    }
    if (asset.format !== 'png') {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_FORMAT_UNSUPPORTED', `${base}.format`, 'Only png is admitted.'));
    }
    if (asset.color_space !== 'srgb') {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_COLOR_SPACE_UNSUPPORTED', `${base}.color_space`, 'Only srgb is admitted.'));
    }
    if (asset.alpha_mode !== 'straight' || asset.premultiplied_alpha !== false) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_ALPHA_MODE_UNSUPPORTED', `${base}.alpha_mode`, 'Only straight non-premultiplied alpha is admitted.'));
    }
    if (!manifestDir) continue;
    const absolute = path.resolve(manifestDir, asset.ref);
    if (!absolute.startsWith(`${manifestDir}${path.sep}`)) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_REF_INVALID', `${base}.ref`, 'Asset ref escapes manifest directory.'));
      continue;
    }
    let buffer;
    try {
      buffer = await readFile(absolute);
    } catch {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_MISSING', `${base}.ref`, 'Asset file is missing.'));
      continue;
    }
    const digest = sha256(buffer);
    if (asset.sha256 !== digest) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_HASH_MISMATCH', `${base}.sha256`, 'Asset sha256 mismatch.'));
    }
    const png = parsePngInfo(buffer);
    if (!png) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_FORMAT_UNSUPPORTED', `${base}.ref`, 'Asset is not a decodable PNG.'));
      continue;
    }
    if (png.colorType !== 6 || png.bitDepth !== 8) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_NOT_RGBA', `${base}.ref`, 'PNG must be 8-bit RGBA.'));
    }
    if (asset.width_px !== png.width || asset.height_px !== png.height || asset.byte_size !== buffer.length) {
      issues.push(issue('NIMI2D_PACKAGE_ASSET_METADATA_MISMATCH', base, 'Asset dimensions or byte size do not match decoded PNG.'));
    }
  }
}

export {
  validatePngAsset,
  validatePackageAssets,
};
