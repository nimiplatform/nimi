import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-ai-studio-messages-'));

await build({
  entryPoints: {
    core: path.join(root, 'src/ai-studio-core/messages/index.ts'),
    create: path.join(root, 'src/studio-modules/studio-create/messages/index.ts'),
    media: path.join(root, 'src/studio-modules/studio-media/messages/index.ts'),
    voice: path.join(root, 'src/studio-modules/studio-voice/messages/index.ts'),
  },
  outdir: buildDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  outExtension: { '.js': '.mjs' },
  sourcemap: false,
  logLevel: 'silent',
});

const [coreMessages, createMessages, mediaMessages, voiceMessages] = await Promise.all(
  ['core', 'create', 'media', 'voice'].map((name) => import(pathToFileURL(path.join(buildDir, `${name}.mjs`)).href)),
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

function labOnlyBundles(locale) {
  const localeDir = path.join(root, 'src/shell/i18n/locales', locale);
  return readdirSync(localeDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(localeDir, name), 'utf8')));
}

function loadMergedBundle(locale) {
  return coreMessages.mergeAIStudioMessageBundles([
    coreMessages.aiStudioCoreMessageBundles[locale],
    createMessages.studioCreateMessageBundles[locale],
    mediaMessages.studioMediaMessageBundles[locale],
    voiceMessages.studioVoiceMessageBundles[locale],
    ...labOnlyBundles(locale),
  ]);
}

function flattenKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

test('i18n en/zh locale key parity and single physical message ownership', () => {
  const enKeys = new Set(flattenKeys(loadMergedBundle('en')));
  const zhKeys = new Set(flattenKeys(loadMergedBundle('zh')));
  assert.deepEqual(
    {
      missingInZh: [...enKeys].filter((key) => !zhKeys.has(key)).sort(),
      missingInEn: [...zhKeys].filter((key) => !enKeys.has(key)).sort(),
    },
    { missingInZh: [], missingInEn: [] },
  );
  assert.throws(
    () => coreMessages.mergeAIStudioMessageBundles([
      { Example: { leaf: 'first' } },
      { Example: { leaf: 'second' } },
    ]),
    /Duplicate i18n message owner: Example\.leaf/,
  );
});

test('selected generated composition imports only core plus selected module messages', () => {
  const createOnly = coreMessages.mergeAIStudioMessageBundles([
    coreMessages.aiStudioCoreMessageBundles.en,
    createMessages.studioCreateMessageBundles.en,
  ]);
  assert.equal(createOnly.Capabilities.textGenerate.label, 'Text Studio');
  assert.equal(Object.hasOwn(createOnly.Capabilities, 'imageGenerate'), false);
  assert.equal(Object.hasOwn(createOnly.Capabilities, 'audioSynthesize'), false);
  assert.equal(Object.hasOwn(coreMessages.aiStudioCoreMessageBundles.en, 'Capabilities'), false);
});
