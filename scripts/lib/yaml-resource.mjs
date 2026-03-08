import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function readYamlFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return YAML.parse(raw) ?? {};
}

function mergePlainObjects(target, incoming, sourceLabel) {
  for (const [key, value] of Object.entries(incoming)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = value;
      continue;
    }
    if (Array.isArray(target[key]) && Array.isArray(value)) {
      target[key] = [...target[key], ...value];
      continue;
    }
    if (isPlainObject(target[key]) && isPlainObject(value)) {
      const merged = { ...target[key] };
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (Object.prototype.hasOwnProperty.call(merged, nestedKey)) {
          throw new Error(`duplicate key ${key}.${nestedKey} in ${sourceLabel}`);
        }
        merged[nestedKey] = nestedValue;
      }
      target[key] = merged;
      continue;
    }
    if (target[key] === value) {
      continue;
    }
    throw new Error(`duplicate key ${key} in ${sourceLabel}`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function listYamlFiles(absDir) {
  return fs.readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yaml|yml)$/iu.test(entry.name))
    .map((entry) => path.join(absDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function readYamlResource(absPath) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    return readYamlFile(absPath);
  }

  const merged = {};
  const files = listYamlFiles(absPath);
  if (files.length === 0) {
    throw new Error(`no yaml fragments found in ${absPath}`);
  }
  for (const file of files) {
    const parsed = readYamlFile(file);
    if (!isPlainObject(parsed)) {
      throw new Error(`yaml fragment must parse to object: ${file}`);
    }
    mergePlainObjects(merged, parsed, path.relative(absPath, file));
  }
  return merged;
}

export function listYamlFragmentFiles(absPath) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) {
    return [absPath];
  }
  return listYamlFiles(absPath);
}
