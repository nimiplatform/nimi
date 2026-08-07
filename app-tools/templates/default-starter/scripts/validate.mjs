import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const MAX_APP_ACCESS_ITEM_BYTES = 128;

function validateAppAccessDeclaration(manifestText) {
  const parsed = parseYaml(manifestText);
  if (!Object.hasOwn(parsed || {}, 'app_access') || !Array.isArray(parsed.app_access)) {
    throw new Error('app_access must be an array');
  }
  const seen = new Set();
  for (const [index, item] of parsed.app_access.entries()) {
    if (typeof item !== 'string' || item.length === 0 || item !== item.trim() || Buffer.byteLength(item, 'utf8') > MAX_APP_ACCESS_ITEM_BYTES) {
      throw new Error(`app_access item ${index} must be a canonical bounded domain string`);
    }
    if (seen.has(item)) throw new Error(`app_access item ${index} duplicates domain: ${item}`);
    seen.add(item);
  }
}

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');
if (!manifest.includes('manifest_role: submitted-input')) {
  throw new Error('submitted manifest role marker missing');
}
validateAppAccessDeclaration(manifest);
process.stdout.write('[nimi-app] validate local-development checks passed\n');
