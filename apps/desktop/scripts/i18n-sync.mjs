#!/usr/bin/env node
/* global console, process */
/**
 * i18n:sync — Sync locale files against en.json (source of truth).
 * - Adds missing keys with English fallback value
 * - Preserves existing translations
 * - Removes keys not in en.json (use --no-prune to skip removal)
 *
 * Usage: node scripts/i18n-sync.mjs [--mod <mod-id>] [--no-prune]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModsRoot } from './mod-paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'scripts', 'i18n.config.json');

const args = process.argv.slice(2);
const modIndex = args.indexOf('--mod');
const modId = modIndex !== -1 ? args[modIndex + 1] : null;
const prune = !args.includes('--no-prune');

if (modIndex !== -1 && (!modId || modId.startsWith('--'))) {
  console.error('❌ Missing mod id after --mod');
  process.exit(1);
}

const LOCALES_DIR = modId
  ? (() => {
    try {
      const modsRoot = resolveModsRoot({ required: true, mustExist: true });
      return join(modsRoot, modId, 'src', 'locales');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${message}`);
      process.exit(1);
    }
  })()
  : join(ROOT, 'src', 'shell', 'renderer', 'locales');

function loadJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function loadSupportedLocales() {
  const config = loadJson(CONFIG_PATH);
  const locales = Array.isArray(config?.supportedLocales)
    ? config.supportedLocales.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!locales.includes('en') || !locales.includes('zh')) {
    console.error('❌ i18n config must include at least "en" and "zh".');
    process.exit(1);
  }

  return locales;
}

const SUPPORTED_LOCALES = loadSupportedLocales().filter((locale) => locale !== 'en');

function syncObject(reference, target) {
  const result = {};
  for (const [key, refValue] of Object.entries(reference)) {
    if (refValue !== null && typeof refValue === 'object' && !Array.isArray(refValue)) {
      const targetValue = target[key];
      const targetObj = (targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue))
        ? targetValue
        : {};
      result[key] = syncObject(refValue, targetObj);
    } else {
      result[key] = Object.prototype.hasOwnProperty.call(target, key) ? target[key] : refValue;
    }
  }
  if (!prune) {
    for (const [key, value] of Object.entries(target)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = value;
      }
    }
  }
  return result;
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const scope = modId ? `mod:${modId}` : 'shell';
console.log(`\n=== i18n:sync [${scope}] ===\n`);

const enPath = join(LOCALES_DIR, 'en.json');
const enData = loadJson(enPath);
if (!enData) {
  console.error('❌ en.json not found — cannot proceed.');
  process.exit(1);
}

console.log('Source: en.json');
console.log(`Locales: en, ${SUPPORTED_LOCALES.join(', ')}`);
console.log(`Mode: ${prune ? 'sync + prune extra keys' : 'sync only (keeping extra keys)'}\n`);

for (const locale of SUPPORTED_LOCALES) {
  const filePath = join(LOCALES_DIR, `${locale}.json`);
  const existedBefore = existsSync(filePath);
  const existing = loadJson(filePath) ?? {};

  const synced = syncObject(enData, existing);
  writeJson(filePath, synced);

  console.log(`✅ ${locale}.json ${existedBefore ? '(synced)' : '(created)'}`);
}

console.log('\n✅ Sync complete! Run "pnpm i18n:check" to verify.');
