// i18n locale parity guard: the en and zh bundles under
// src/shell/i18n/locales/<locale>/*.json must expose identical flattened key
// sets, so no section copy can drift between languages.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const localesRoot = path.join(root, 'src/shell/i18n/locales');

function loadMergedBundle(locale) {
  const dir = path.join(localesRoot, locale);
  const merged = {};
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    for (const [section, entries] of Object.entries(parsed)) {
      if (Object.hasOwn(merged, section)) {
        throw new Error(`i18n ${locale}: section "${section}" declared by more than one locale file`);
      }
      merged[section] = entries;
    }
  }
  return merged;
}

function flattenKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

test('i18n en/zh locale key parity', () => {
  const enKeys = new Set(flattenKeys(loadMergedBundle('en')));
  const zhKeys = new Set(flattenKeys(loadMergedBundle('zh')));
  const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort();
  const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort();
  assert.deepEqual(
    { missingInZh, missingInEn },
    { missingInZh: [], missingInEn: [] },
    'en and zh locale bundles must declare identical key sets',
  );
});
