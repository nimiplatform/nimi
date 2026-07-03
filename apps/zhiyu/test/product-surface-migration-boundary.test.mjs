import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const productionRoot = path.join(appRoot, 'src');
const inventoryPath = path.join(
  repoRoot,
  '.nimi',
  'local',
  'evidence',
  'zhiyu',
  'zm0',
  'source-target-migration-map.json',
);

const productionFilePattern = /\.(?:c|m)?(?:ts|tsx|js|jsx)$/;
const importSpecifierPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

test('zhiyu production source has no private app/runtime imports or runtime shortcut truth', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');

    for (const specifier of importSpecifiers(source)) {
      if (
        specifier.includes('apps/tester')
        || specifier.includes('apps/desktop')
        || specifier.includes('runtime/internal')
      ) {
        violations.push(`${relativePath}: forbidden import ${specifier}`);
      }
    }

    if (/\bruntime\/internal\b/.test(source)) {
      violations.push(`${relativePath}: runtime/internal reference`);
    }
    if (/\bapps\/(?:tester|desktop)\b/.test(source)) {
      violations.push(`${relativePath}: private app path reference`);
    }
    if (/\bfetch\s*\(/.test(source)) {
      violations.push(`${relativePath}: app-local fetch runtime bypass`);
    }
    if (/\b(?:apiKey|providerId)\b/.test(source)) {
      violations.push(`${relativePath}: provider credential or provider id truth`);
    }
    if (/\bmodelId\s*:/.test(source)) {
      violations.push(`${relativePath}: app-local model id field declaration or assignment`);
    }
  }

  assert.deepEqual(violations, []);
});

test('ZM0 source-to-target migration inventory is present and maps audited sources to shared APIs', async () => {
  assert.equal(existsSync(inventoryPath), true, `${inventoryPath} should exist`);

  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
  assert.equal(inventory.checkpoint, 'ZM0');
  assert.equal(inventory.specStatus, 'alignment');
  assert.equal(inventory.workType, 'boundary-lock-and-inventory');
  assert.equal(inventory.parallelTruth, 'forbidden');
  assert.ok(Array.isArray(inventory.entries), 'inventory.entries must be an array');

  const requiredSources = [
    'apps/tester/src/tester/tester-ai-config-store.ts',
    'apps/tester/src/tester/tester-runtime-model-provider.ts',
    'apps/tester/src/tester/tester-runtime-invokers-core.ts',
    'apps/tester/src/tester/tester-runtime-invokers-media.ts',
    'apps/tester/src/tester/tester-runtime-media-generation-runner.ts',
    'apps/tester/src/tester/tester-history.ts',
    'apps/tester/src/tester/tester-artifact-persistence.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx',
    'apps/desktop/src/shell/renderer/infra/runtime-agent-inspect.ts',
    'apps/desktop/src/shell/renderer/infra/runtime-agent-memory.ts',
    'apps/desktop/src/shell/renderer/infra/runtime-agent-presentation-profile.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts',
  ];

  for (const sourcePath of requiredSources) {
    const entry = inventory.entries.find((candidate) => candidate.sourcePath === sourcePath);
    assert.ok(entry, `missing inventory entry for ${sourcePath}`);
    assert.ok(
      typeof entry.targetApi === 'string'
        && (/^@nimiplatform\/(?:kit|sdk)\//.test(entry.targetApi) || entry.targetApi === '@nimiplatform/kit'),
      `${sourcePath} must target a shared Kit/SDK API`,
    );
    assert.notEqual(entry.targetApi.includes('apps/zhiyu'), true, `${sourcePath} must not target Zhiyu-local truth`);
    assert.notEqual(entry.targetApi.includes('apps/tester'), true, `${sourcePath} must not target Tester private code`);
    assert.notEqual(entry.targetApi.includes('apps/desktop'), true, `${sourcePath} must not target Desktop private code`);
  }
});

test('Zhiyu Electron acceptance writes checkpoint-scoped screenshot and runtime evidence', async () => {
  const noRuntimeAcceptance = await readFile(path.join(appRoot, 'test', 'electron-acceptance.mjs'), 'utf8');
  const liveRuntimeAcceptance = await readFile(path.join(appRoot, 'test', 'electron-live-runtime-acceptance.mjs'), 'utf8');

  assert.match(noRuntimeAcceptance, /NIMI_ZHIYU_EVIDENCE_CHECKPOINT/);
  assert.match(noRuntimeAcceptance, /trackPageProblems/);
  assert.match(noRuntimeAcceptance, /assertNoPageProblems/);
  assert.match(noRuntimeAcceptance, /product-home-evidence\.json/);
  assert.match(liveRuntimeAcceptance, /NIMI_ZHIYU_EVIDENCE_CHECKPOINT/);
  assert.match(liveRuntimeAcceptance, /trackPageProblems/);
  assert.match(liveRuntimeAcceptance, /assertNoPageProblems/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-unconfigured-evidence\.json/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-model-configured-evidence\.json/);
  assert.match(liveRuntimeAcceptance, /live-runtime-ready-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-ready-evidence\.json/);
  assert.match(liveRuntimeAcceptance, /live-runtime-agent-chat-completed-desktop\.png/);
  assert.match(liveRuntimeAcceptance, /live-runtime-agent-chat-completed-evidence\.json/);
});

test('zhiyu active product source does not expose legacy surface names', async () => {
  const files = await collectProductionFiles(productionRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');
    if (/\bzhiyu-[a-z0-9_-]*legacy|data-zhiyu-[a-z0-9_-]*legacy|__legacy/i.test(source)) {
      violations.push(relativePath);
    }
  }

  assert.deepEqual(violations, []);
});

async function collectProductionFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectProductionFiles(fullPath));
      continue;
    }
    if (entry.isFile() && productionFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(importSpecifierPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}
