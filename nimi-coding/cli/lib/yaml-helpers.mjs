import { readFile } from "node:fs/promises";

import YAML from "yaml";

import { pathExists } from "./fs-helpers.mjs";
import { isPlainObject, toStringArray } from "./value-helpers.mjs";

function findFirstMatchingKey(node, targetKey) {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstMatchingKey(entry, targetKey);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isPlainObject(node)) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
    return node[targetKey];
  }

  for (const value of Object.values(node)) {
    const found = findFirstMatchingKey(value, targetKey);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

export function parseYamlText(text) {
  if (!text) {
    return null;
  }

  try {
    return YAML.parse(text);
  } catch {
    return null;
  }
}

export async function loadYamlFile(filePath) {
  const info = await pathExists(filePath);
  if (!info || !info.isFile()) {
    return null;
  }

  try {
    return YAML.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function readYamlScalar(text, key) {
  const parsed = parseYamlText(text);
  const value = findFirstMatchingKey(parsed, key);

  if (value === undefined || value === null || isPlainObject(value) || Array.isArray(value)) {
    return null;
  }

  return String(value);
}

export function readYamlList(text, key) {
  const parsed = parseYamlText(text);
  const value = findFirstMatchingKey(parsed, key);
  return toStringArray(value);
}

export function mergeOrderedPaths(...groups) {
  const merged = [];

  for (const group of groups) {
    for (const entry of group) {
      if (entry && !merged.includes(entry)) {
        merged.push(entry);
      }
    }
  }

  return merged;
}

export function parseSkillSection(text, sectionKey) {
  const parsed = parseYamlText(text);
  const section = parsed?.[sectionKey];

  if (!Array.isArray(section)) {
    return [];
  }

  return section.map((entry) => ({
    ...entry,
    id: typeof entry?.id === "string" ? entry.id : null,
    inputs: Array.isArray(entry?.inputs) ? entry.inputs.map((item) => String(item)) : [],
    required: entry?.required === undefined ? undefined : String(entry.required),
    source: entry?.source === undefined ? undefined : String(entry.source),
    purpose: entry?.purpose === undefined ? undefined : String(entry.purpose),
    result_contract_ref: entry?.result_contract_ref === undefined ? undefined : String(entry.result_contract_ref),
  })).filter((entry) => entry.id);
}

export function parsePathRequirements(text, sectionKey) {
  const parsed = parseYamlText(text);
  const section = parsed?.[sectionKey];

  if (!Array.isArray(section)) {
    return [];
  }

  return section
    .filter((entry) => isPlainObject(entry) && typeof entry.path === "string")
    .map((entry) => ({
      path: entry.path,
      required_top_level_keys: Array.isArray(entry.required_top_level_keys)
        ? entry.required_top_level_keys.map((item) => String(item))
        : [],
    }));
}

export function readTopLevelKeys(text) {
  const parsed = parseYamlText(text);
  return isPlainObject(parsed) ? Object.keys(parsed) : [];
}
