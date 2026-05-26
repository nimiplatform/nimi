#!/usr/bin/env node
/* global console, process */
/**
 * i18n:check — Compare locale bundles against English (source of truth).
 *
 * Usage:
 *   node scripts/i18n-check.mjs                Check shell locales
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'scripts', 'i18n.config.json');

function flattenKeys(obj, prefix = '') {
  const result = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result.push(...flattenKeys(value, fullKey));
    } else {
      result.push(fullKey);
    }
  }
  return result;
}

function loadJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`❌ Failed to parse ${filePath}: ${error.message}`);
    return null;
  }
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

function loadConfig() {
  const config = loadJson(CONFIG_PATH);
  if (!config) {
    console.error(`❌ Missing or invalid i18n config: ${CONFIG_PATH}`);
    process.exit(1);
  }

  const supportedLocales = Array.isArray(config.supportedLocales)
    ? config.supportedLocales.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!supportedLocales.includes('en') || !supportedLocales.includes('zh')) {
    console.error('❌ i18n config must include at least "en" and "zh".');
    process.exit(1);
  }

  return {
    supportedLocales,
  };
}

function checkScope({ scope, localesDir, supportedLocales }) {
  console.log(`\n=== i18n:check [${scope}] ===\n`);
  console.log(`Locales: ${supportedLocales.join(', ')}`);

  const enData = loadLocaleBundle(localesDir, 'en');
  if (!enData) {
    console.error('❌ English locale bundle not found — cannot proceed.');
    return { ok: false, missing: 1, extra: 0 };
  }

  const enKeys = new Set(flattenKeys(enData));
  console.log(`✅ en locale — ${enKeys.size} keys`);

  let totalMissing = 0;
  let totalExtra = 0;
  const checkedLocales = [];

  for (const locale of supportedLocales) {
    if (locale === 'en') continue;

    const data = loadLocaleBundle(localesDir, locale);
    if (!data) {
      const missingForLocale = enKeys.size;
      totalMissing += missingForLocale;
      console.log(`❌ ${locale} locale — not found | missing: ${missingForLocale} | extra: 0`);
      continue;
    }

    const localeKeys = new Set(flattenKeys(data));
    const missing = [...enKeys].filter((key) => !localeKeys.has(key));
    const extra = [...localeKeys].filter((key) => !enKeys.has(key));

    totalMissing += missing.length;
    totalExtra += extra.length;
    checkedLocales.push(locale);

    const status = missing.length === 0 ? '✅' : '❌';
    console.log(`${status} ${locale} locale — ${localeKeys.size} keys | missing: ${missing.length} | extra: ${extra.length}`);

    if (missing.length > 0) {
      console.log('   Missing keys:');
      for (const key of missing.slice(0, 20)) {
        console.log(`     - ${key}`);
      }
      if (missing.length > 20) {
        console.log(`     ... and ${missing.length - 20} more`);
      }
    }
    if (extra.length > 0) {
      console.log('   Extra keys (not in English locale):');
      for (const key of extra.slice(0, 10)) {
        console.log(`     + ${key}`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Checked: ${checkedLocales.join(', ') || '(none)'}`);
  console.log(`Total missing: ${totalMissing} | Total extra: ${totalExtra}`);

  if (totalMissing > 0) {
    console.log('\n💡 Run "pnpm i18n:sync" to auto-fill missing keys with English fallback.');
    return { ok: false, missing: totalMissing, extra: totalExtra };
  }

  console.log('\n✅ All checked locales are complete!');
  return { ok: true, missing: 0, extra: totalExtra };
}

const { supportedLocales } = loadConfig();

const shellResult = checkScope({
  scope: 'shell',
  localesDir: join(ROOT, 'src', 'shell', 'renderer', 'locales'),
  supportedLocales,
});
process.exit(shellResult.ok ? 0 : 1);
