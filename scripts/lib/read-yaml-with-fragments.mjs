import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeFragmentValues(key, currentValue, nextValue, sourcePath) {
  if (typeof currentValue === 'undefined') {
    return nextValue;
  }
  if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
    return [...currentValue, ...nextValue];
  }
  if (isRecord(currentValue) && isRecord(nextValue)) {
    return { ...currentValue, ...nextValue };
  }
  throw new Error(`fragment merge type mismatch for ${key} in ${sourcePath}`);
}

export function readYamlWithFragments(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.fragments)) {
    return parsed;
  }

  const resolved = { ...parsed };
  const fragmentEntries = Object.entries(parsed.fragments);
  delete resolved.fragments;

  for (const [key, fragmentSpec] of fragmentEntries) {
    const refs = Array.isArray(fragmentSpec) ? fragmentSpec : [fragmentSpec];
    let mergedValue;
    for (const ref of refs) {
      const relativeRef = String(ref || '').trim();
      if (!relativeRef) {
        throw new Error(`empty fragment reference for ${key} in ${filePath}`);
      }
      const fragmentPath = path.resolve(path.dirname(filePath), relativeRef);
      const fragmentValue = readYamlWithFragments(fragmentPath);
      mergedValue = mergeFragmentValues(key, mergedValue, fragmentValue, filePath);
    }
    resolved[key] = mergedValue;
  }

  return resolved;
}
