import { parse as parseYaml } from 'yaml';

export const APP_ACCESS_DOMAINS = Object.freeze([
  'realm.data',
  'runtime.consume',
  'agent.local',
  'agent.configure',
]);

const SUPPORTED_APP_ACCESS_DOMAINS = new Set(APP_ACCESS_DOMAINS);
const MAX_ITEM_BYTES = 128;

export function normalizeAppAccessItems(input) {
  const source = input === undefined ? [] : input;
  if (!Array.isArray(source)) throw new Error('App access declaration must be an array');
  const seen = new Set();
  return source.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0 || item !== item.trim() || Buffer.byteLength(item, 'utf8') > MAX_ITEM_BYTES) {
      throw new Error(`Invalid App access declaration item ${index}`);
    }
    if (seen.has(item)) throw new Error(`Duplicate App access declaration item: ${item}`);
    seen.add(item);
    return item;
  });
}

export function resolveAppAccessDeclaration(input) {
  const rawItems = normalizeAppAccessItems(input);
  return {
    rawItems,
    activatedDomains: rawItems.filter((item) => SUPPORTED_APP_ACCESS_DOMAINS.has(item)),
  };
}

export function assertManifestAppAccessDeclaration(manifest, manifestPath) {
  let parsed;
  try {
    parsed = parseYaml(manifest);
  } catch (error) {
    throw new Error(`Submitted manifest YAML cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Object.hasOwn(parsed || {}, 'app_access')) {
    throw new Error('Submitted manifest app_access declaration is required');
  }
  normalizeAppAccessItems(parsed.app_access);
  if (!manifestPath.endsWith('nimi.app.yaml')) {
    throw new Error('Submitted App access declaration was not read from nimi.app.yaml');
  }
}
