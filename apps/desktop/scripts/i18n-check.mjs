#!/usr/bin/env node
/* global console, process */
/**
 * i18n:check — Compare locale files against en.json (source of truth).
 *
 * Usage:
 *   node scripts/i18n-check.mjs                Check shell locales
 *   node scripts/i18n-check.mjs --mod <id>     Check one mod locales
 *   node scripts/i18n-check.mjs --mods         Check all desktop mods by policy
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModsRoot } from './mod-paths.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONFIG_PATH = join(ROOT, 'scripts', 'i18n.config.json');

const argv = process.argv.slice(2);
const modIndex = argv.indexOf('--mod');
const modId = modIndex === -1 ? null : argv[modIndex + 1];
const checkModsFlag = argv.includes('--mods');

if (modIndex !== -1 && (!modId || modId.startsWith('--'))) {
  console.error('❌ Missing mod id after --mod');
  process.exit(1);
}
if (modId && checkModsFlag) {
  console.error('❌ Use either --mod <id> or --mods, not both.');
  process.exit(1);
}

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

  const modPolicies = config.modPolicies && typeof config.modPolicies === 'object'
    ? config.modPolicies
    : {};

  return {
    supportedLocales,
    modPolicies,
  };
}

function resolveModsRootOrExit() {
  try {
    return resolveModsRoot({ required: true, mustExist: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function checkScope({ scope, localesDir, supportedLocales }) {
  console.log(`\n=== i18n:check [${scope}] ===\n`);
  console.log(`Locales: ${supportedLocales.join(', ')}`);

  const enData = loadJson(join(localesDir, 'en.json'));
  if (!enData) {
    console.error('❌ en.json not found — cannot proceed.');
    return { ok: false, missing: 1, extra: 0 };
  }

  const enKeys = new Set(flattenKeys(enData));
  console.log(`✅ en.json  — ${enKeys.size} keys`);

  let totalMissing = 0;
  let totalExtra = 0;
  const checkedLocales = [];

  for (const locale of supportedLocales) {
    if (locale === 'en') continue;

    const data = loadJson(join(localesDir, `${locale}.json`));
    if (!data) {
      const missingForLocale = enKeys.size;
      totalMissing += missingForLocale;
      console.log(`❌ ${locale}.json — not found | missing: ${missingForLocale} | extra: 0`);
      continue;
    }

    const localeKeys = new Set(flattenKeys(data));
    const missing = [...enKeys].filter((key) => !localeKeys.has(key));
    const extra = [...localeKeys].filter((key) => !enKeys.has(key));

    totalMissing += missing.length;
    totalExtra += extra.length;
    checkedLocales.push(locale);

    const status = missing.length === 0 ? '✅' : '❌';
    console.log(`${status} ${locale}.json  — ${localeKeys.size} keys | missing: ${missing.length} | extra: ${extra.length}`);

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
      console.log('   Extra keys (not in en.json):');
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

function listDesktopModIds(modsRoot) {
  if (!existsSync(modsRoot)) return [];
  return readdirSync(modsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((id) => {
      const modDir = join(modsRoot, id);
      return ['mod.manifest.yaml', 'mod.manifest.yml', 'mod.manifest.json']
        .some((filename) => existsSync(join(modDir, filename)));
    })
    .sort((a, b) => a.localeCompare(b));
}

function runModsCheck({ supportedLocales, modPolicies }) {
  const modsRoot = resolveModsRootOrExit();
  const modIds = listDesktopModIds(modsRoot);
  const policyIds = Object.keys(modPolicies).sort((a, b) => a.localeCompare(b));

  let hasPolicyError = false;

  const missingPolicies = modIds.filter((id) => !Object.prototype.hasOwnProperty.call(modPolicies, id));
  if (missingPolicies.length > 0) {
    hasPolicyError = true;
    console.error(`❌ Missing mod policy entries: ${missingPolicies.join(', ')}`);
  }

  const stalePolicies = policyIds.filter((id) => !modIds.includes(id));
  if (stalePolicies.length > 0) {
    hasPolicyError = true;
    console.error(`❌ Stale mod policy entries (mod dir not found): ${stalePolicies.join(', ')}`);
  }

  if (hasPolicyError) {
    return false;
  }

  let passed = true;
  console.log('\n=== i18n:check [mods] ===');
  console.log(`Mods root: ${modsRoot}`);
  console.log(`Detected mods: ${modIds.join(', ')}`);

  for (const id of modIds) {
    const policy = modPolicies[id] || {};
    const enforced = Boolean(policy.enforced);
    const reason = typeof policy.reason === 'string' && policy.reason.trim()
      ? policy.reason.trim()
      : 'No reason provided.';

    if (!enforced) {
      console.log(`\n⏭️  mod:${id} skipped by policy`);
      console.log(`   reason: ${reason}`);
      continue;
    }

    const result = checkScope({
      scope: `mod:${id}`,
      localesDir: join(modsRoot, id, 'src', 'locales'),
      supportedLocales,
    });
    if (!result.ok) {
      passed = false;
    }
  }

  return passed;
}

const { supportedLocales, modPolicies } = loadConfig();

if (checkModsFlag) {
  process.exit(runModsCheck({ supportedLocales, modPolicies }) ? 0 : 1);
}

if (modId) {
  const modsRoot = resolveModsRootOrExit();
  const result = checkScope({
    scope: `mod:${modId}`,
    localesDir: join(modsRoot, modId, 'src', 'locales'),
    supportedLocales,
  });
  process.exit(result.ok ? 0 : 1);
}

const shellResult = checkScope({
  scope: 'shell',
  localesDir: join(ROOT, 'src', 'shell', 'renderer', 'locales'),
  supportedLocales,
});
process.exit(shellResult.ok ? 0 : 1);
