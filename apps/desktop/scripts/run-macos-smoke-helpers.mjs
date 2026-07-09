import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const desktopRoot = path.resolve(scriptDir, '..');
export const repoRoot = path.resolve(desktopRoot, '..', '..');

export function mergeDeep(baseValue, overrideValue) {
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  if (baseValue && typeof baseValue === 'object' && overrideValue && typeof overrideValue === 'object') {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      merged[key] = mergeDeep(baseValue[key], value);
    }
    return merged;
  }
  return overrideValue === undefined ? baseValue : overrideValue;
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadProfileDefinition(filePath, seen = new Set()) {
  const normalizedPath = path.resolve(filePath);
  if (seen.has(normalizedPath)) {
    throw new Error(`E2E profile extends cycle detected: ${normalizedPath}`);
  }
  seen.add(normalizedPath);
  const current = readJson(normalizedPath);
  const parentName = String(current.extends || '').trim();
  if (!parentName) {
    return current;
  }
  const parentPath = path.resolve(path.dirname(normalizedPath), parentName);
  const parent = loadProfileDefinition(parentPath, seen);
  const rest = { ...current };
  delete rest.extends;
  return mergeDeep(parent, rest);
}

export function replacePlaceholders(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]));
  }
  if (typeof value === 'string') {
    return Object.entries(replacements).reduce(
      (result, [token, replacement]) => result.replaceAll(token, replacement),
      value,
    );
  }
  return value;
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export * from './run-macos-smoke-process.mjs';
