import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function readManifest(filePath) {
  const raw = await readFile(filePath, 'utf8');
  try {
    return { raw, value: YAML.parse(raw) };
  } catch (error) {
    return { raw, value: null, parseError: error };
  }
}

function issue(code, fieldPath, message) {
  return { code, path: fieldPath, message };
}

function uniqueIssues(issues) {
  const seen = new Set();
  const result = [];
  for (const item of issues) {
    const key = `${item.code}:${item.path}:${item.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function result(kind, manifestPath, issues, value = null) {
  const normalized = uniqueIssues(issues);
  return {
    status: normalized.length === 0 ? 'ok' : 'reject',
    kind,
    manifestPath,
    codes: [...new Set(normalized.map((item) => item.code))],
    issues: normalized,
    value,
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireFields(value, required, code, basePath, issues) {
  if (!isObject(value)) {
    issues.push(issue(code, basePath, 'Expected object.'));
    return;
  }
  for (const field of required) {
    if (!(field in value)) {
      issues.push(issue(code, `${basePath}.${field}`, 'Missing required field.'));
    }
  }
}

function rejectUnknownFields(value, allowed, code, basePath, issues) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue(code, `${basePath}.${key}`, 'Unknown field is not admitted.'));
    }
  }
}

function findForbiddenFields(value, forbidden, code, basePath, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenFields(item, forbidden, code, `${basePath}[${index}]`, issues));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) {
      issues.push(issue(code, `${basePath}.${key}`, 'Forbidden authority field.'));
    }
    findForbiddenFields(child, forbidden, code, `${basePath}.${key}`, issues);
  }
}

function isSafeRelativePath(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return false;
  if (path.isAbsolute(ref)) return false;
  if (ref.startsWith('~') || ref.includes('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return false;
  const normalized = path.posix.normalize(ref.replaceAll(path.sep, '/'));
  return normalized !== '.' && !normalized.startsWith('../') && normalized !== '..';
}

function assertCanvasPoint(point, canvas, fieldPath, issues, code) {
  if (!isObject(point) || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
    issues.push(issue(code, fieldPath, 'Expected integer canvas point.'));
    return;
  }
  if (point.x < 0 || point.y < 0 || point.x >= canvas.width_px || point.y >= canvas.height_px) {
    issues.push(issue(code, fieldPath, 'Point is outside canvas bounds.'));
  }
}

function assertRect(rect, fieldPath, issues, code) {
  if (!isObject(rect)) {
    issues.push(issue(code, fieldPath, 'Expected rectangle object.'));
    return;
  }
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(rect[field])) {
      issues.push(issue(code, `${fieldPath}.${field}`, 'Expected integer rectangle field.'));
    }
  }
  if (rect.width <= 0 || rect.height <= 0) {
    issues.push(issue(code, fieldPath, 'Rectangle width and height must be positive.'));
  }
}

function assertNonNegativePoint(point, fieldPath, issues, code) {
  if (!isObject(point) || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
    issues.push(issue(code, fieldPath, 'Expected integer point.'));
    return;
  }
  if (point.x < 0 || point.y < 0) {
    issues.push(issue(code, fieldPath, 'Point must be non-negative.'));
  }
}

function rectContains(outer, inner) {
  if (!isObject(outer) || !isObject(inner)) return false;
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function rectFitsDimensions(rect, width, height) {
  if (!isObject(rect) || !Number.isInteger(width) || !Number.isInteger(height)) return false;
  return Number.isInteger(rect.x)
    && Number.isInteger(rect.y)
    && Number.isInteger(rect.width)
    && Number.isInteger(rect.height)
    && rect.x >= 0
    && rect.y >= 0
    && rect.width > 0
    && rect.height > 0
    && rect.x + rect.width <= width
    && rect.y + rect.height <= height;
}

function rectSameSize(left, right) {
  return isObject(left)
    && isObject(right)
    && Number.isInteger(left.width)
    && Number.isInteger(left.height)
    && left.width === right.width
    && left.height === right.height;
}

export {
  sha256,
  readManifest,
  issue,
  result,
  isObject,
  requireFields,
  rejectUnknownFields,
  findForbiddenFields,
  isSafeRelativePath,
  assertCanvasPoint,
  assertRect,
  assertNonNegativePoint,
  rectContains,
  rectFitsDimensions,
  rectSameSize,
};
