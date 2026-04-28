#!/usr/bin/env node
/* global console, process */
/**
 * i18n:sync — Sync locale bundles against English (source of truth).
 * - Adds missing keys with English fallback value
 * - Preserves existing translations
 * - Removes keys not in English (use --no-prune to skip removal)
 *
 * Usage: node scripts/i18n-sync.mjs [--mod <mod-id>] [--no-prune]
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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

function namespaceFromLocaleFileName(fileName) {
  return fileName.slice(0, -'.json'.length).replace(/^\d+-/, '');
}

function loadLocaleBundle(localesDir, locale) {
  const flatPath = join(localesDir, `${locale}.json`);
  if (existsSync(flatPath)) {
    return loadJson(flatPath);
  }

  const localeDir = join(localesDir, locale);
  let entries;
  try {
    entries = readdirSync(localeDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const bundle = {};
  for (const entry of entries
    .filter((item) => item.isFile() && item.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const key = namespaceFromLocaleFileName(entry.name);
    const section = loadJson(join(localeDir, entry.name));
    if (!section) {
      return null;
    }
    bundle[key] = section;
  }
  return bundle;
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

function getLocaleFileNames(data) {
  return Object.keys(data).map((key, index) => `${String(index + 1).padStart(2, '0')}-${key}.json`);
}

function writeLocaleIndex(localeDir, data, fileNames) {
  const imports = fileNames
    .map((fileName, index) => `import section${index} from './${fileName}';`)
    .join('\n');
  const entries = Object.keys(data)
    .map((key, index) => `  ${JSON.stringify(key)}: section${index},`)
    .join('\n');
  writeFileSync(
    join(localeDir, 'index.ts'),
    `${imports}\n\nconst messages = {\n${entries}\n};\n\nexport default messages;\n`,
    'utf8',
  );
}

function writeLocaleBundle(localesDir, locale, data, modular) {
  if (!modular) {
    writeJson(join(localesDir, `${locale}.json`), data);
    return;
  }

  const localeDir = join(localesDir, locale);
  mkdirSync(localeDir, { recursive: true });
  const fileNames = getLocaleFileNames(data);
  const expected = new Set(fileNames);
  for (const entry of readdirSync(localeDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json') && !expected.has(entry.name)) {
      rmSync(join(localeDir, entry.name));
    }
  }
  Object.entries(data).forEach(([, value], index) => {
    writeJson(join(localeDir, fileNames[index]), value);
  });
  writeLocaleIndex(localeDir, data, fileNames);
}

const scope = modId ? `mod:${modId}` : 'shell';
console.log(`\n=== i18n:sync [${scope}] ===\n`);

const modularLocales = !existsSync(join(LOCALES_DIR, 'en.json')) && existsSync(join(LOCALES_DIR, 'en'));
const enData = loadLocaleBundle(LOCALES_DIR, 'en');
if (!enData) {
  console.error('❌ English locale bundle not found — cannot proceed.');
  process.exit(1);
}

console.log('Source: English locale');
console.log(`Locales: en, ${SUPPORTED_LOCALES.join(', ')}`);
console.log(`Mode: ${prune ? 'sync + prune extra keys' : 'sync only (keeping extra keys)'}\n`);

if (modularLocales) {
  writeLocaleIndex(join(LOCALES_DIR, 'en'), enData, getLocaleFileNames(enData));
}

for (const locale of SUPPORTED_LOCALES) {
  const flatPath = join(LOCALES_DIR, `${locale}.json`);
  const dirPath = join(LOCALES_DIR, locale);
  const existedBefore = existsSync(flatPath) || existsSync(dirPath);
  const existing = loadLocaleBundle(LOCALES_DIR, locale) ?? {};

  const synced = syncObject(enData, existing);
  writeLocaleBundle(LOCALES_DIR, locale, synced, modularLocales);

  console.log(`✅ ${locale} locale ${existedBefore ? '(synced)' : '(created)'}`);
}

console.log('\n✅ Sync complete! Run "pnpm i18n:check" to verify.');
