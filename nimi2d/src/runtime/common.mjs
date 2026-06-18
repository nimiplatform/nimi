import YAML from 'yaml';

const NIMI2D_RUNTIME_SCOPE = 'pixi_renderer_foundation';

const tiers = new Set([
  'tier-0_static_layered',
  'tier-1_agent_basic',
  'tier-2_viseme_gesture',
  'tier-3_full_body_semantic',
]);

function asRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Nimi2D package ${path} must be an object`);
  }
  return value;
}

function stringField(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Nimi2D package missing ${path}`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`Nimi2D package ${path} must be a string array`);
  }
  return value.map((item) => item.trim());
}

function nonEmptyStringArray(value, path) {
  const array = stringArray(value, path);
  if (array.length === 0) {
    throw new Error(`Nimi2D package ${path} must not be empty`);
  }
  return array;
}

function positiveInteger(value, path) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Nimi2D package ${path} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, path) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Nimi2D package ${path} must be a non-negative integer`);
  }
  return number;
}

function pointField(value, path) {
  const point = asRecord(value, path);
  return {
    x: nonNegativeInteger(point.x, `${path}.x`),
    y: nonNegativeInteger(point.y, `${path}.y`),
  };
}

function rectField(value, path) {
  const rect = asRecord(value, path);
  return {
    x: nonNegativeInteger(rect.x, `${path}.x`),
    y: nonNegativeInteger(rect.y, `${path}.y`),
    width: positiveInteger(rect.width, `${path}.width`),
    height: positiveInteger(rect.height, `${path}.height`),
  };
}

function boolField(value, expected, path) {
  if (value !== expected) {
    throw new Error(`Nimi2D package ${path} must be ${String(expected)}`);
  }
  return value;
}

function assertAssetMetadata(asset, index) {
  const format = stringField(asset.format, `assets[${index}].format`);
  if (format !== 'png') {
    throw new Error(`Nimi2D package assets[${index}].format must be png`);
  }
  const colorSpace = stringField(asset.color_space, `assets[${index}].color_space`);
  if (colorSpace !== 'srgb') {
    throw new Error(`Nimi2D package assets[${index}].color_space must be srgb`);
  }
  const alphaMode = stringField(asset.alpha_mode, `assets[${index}].alpha_mode`);
  if (alphaMode !== 'straight') {
    throw new Error(`Nimi2D package assets[${index}].alpha_mode must be straight`);
  }
  return {
    format,
    width_px: positiveInteger(asset.width_px, `assets[${index}].width_px`),
    height_px: positiveInteger(asset.height_px, `assets[${index}].height_px`),
    byte_size: positiveInteger(asset.byte_size, `assets[${index}].byte_size`),
    color_space: colorSpace,
    alpha_mode: alphaMode,
    premultiplied_alpha: boolField(asset.premultiplied_alpha, false, `assets[${index}].premultiplied_alpha`),
  };
}

function rectFitsDimensions(rect, width, height) {
  return rect.x + rect.width <= width && rect.y + rect.height <= height;
}

function rectSameSize(left, right) {
  return left.width === right.width && left.height === right.height;
}

function parseYamlObject(raw, path) {
  const parsed = YAML.parse(raw);
  return asRecord(parsed, path);
}

function isTier(value) {
  return tiers.has(value);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export {
  NIMI2D_RUNTIME_SCOPE,
  asRecord,
  stringField,
  optionalString,
  stringArray,
  nonEmptyStringArray,
  positiveInteger,
  nonNegativeInteger,
  pointField,
  rectField,
  boolField,
  assertAssetMetadata,
  rectFitsDimensions,
  rectSameSize,
  parseYamlObject,
  isTier,
  clamp01,
};
