import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const productionRoot = path.join(appRoot, 'src');
const hardcutCheckpointPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'zhiyu',
  'kernel',
  'tables',
  'desktop-agent-chat-hardcut-checkpoint.yaml',
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
    if (/\bapps\/(?:tester|desktop)\b/.test(source) && relativePath !== 'src/shell/agent-chat/desktop-source-map.ts') {
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

test('hardcut checkpoint replaces ZM0 shared-API-only migration assumptions', async () => {
  assert.equal(existsSync(hardcutCheckpointPath), true, `${hardcutCheckpointPath} should exist`);

  const checkpoint = await readFile(hardcutCheckpointPath, 'utf8');
  assert.match(checkpoint, /checkpoint_id:\s*ZHIYU_DESKTOP_AGENT_CHAT_HARDCUT/i);
  assert.match(checkpoint, /work_type:\s*redesign/i);
  assert.match(checkpoint, /no_new_sdk_kit_upstreaming_this_phase:\s*true/i);
  assert.match(checkpoint, /bounded_zhiyu_local_parity_implementation:\s*true/i);
  assert.match(checkpoint, /runtime_sdk_authority_admitted_first_party_electron_host_equivalence/i);
  assert.match(checkpoint, /runtime-agent-scopes\.ts/);
  assert.match(checkpoint, /operation\(\{\}\)/);

  const requiredSources = [
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-agent.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-runtime-provider.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-shared-runtime-stream-ui.tsx',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx',
    'apps/desktop/src/shell/renderer/features/chat/conversation-submit-readiness.ts',
    'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-local-avatar-controls.ts',
  ];

  for (const sourcePath of requiredSources) {
    assert.match(checkpoint, new RegExp(escapeRegExp(sourcePath)), `${sourcePath} must be in hardcut checkpoint`);
  }
});

test('Zhiyu Electron acceptance writes checkpoint-scoped screenshot and runtime evidence', async () => {
  const noRuntimeAcceptance = await readFile(path.join(appRoot, 'test', 'electron-acceptance.mjs'), 'utf8');
  const liveRuntimeAcceptance = await readAppFiles([
    'test/electron-live-runtime-acceptance.mjs',
    'test/electron-live-runtime-acceptance-helpers.mjs',
  ]);

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

test('zhiyu hardcut leaves no transition wrapper, hidden fallback composer, or quarantined legacy tests', async () => {
  const forbiddenPaths = [
    'src/shell/app/HomeSurface.tsx',
    'test/electron-host-contract.quarantine.mjs',
    'test/home-surface-design.quarantine.mjs',
    'test/image-studio-generate.quarantine.mjs',
    'test/image-studio-state.quarantine.mjs',
  ];
  const violations = [];

  for (const relativePath of forbiddenPaths) {
    if (existsSync(path.join(appRoot, relativePath))) {
      violations.push(`${relativePath}: legacy transition or quarantined path still exists`);
    }
  }

  const files = await collectProductionFiles(productionRoot);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativePath = path.relative(appRoot, file).replaceAll(path.sep, '/');
    if (/fallback-composer-hidden|data-zhiyu-fallback-composer/.test(source)) {
      violations.push(`${relativePath}: hidden fallback composer keeps the old HomeSurface input path alive`);
    }
    if (/from\s+['"]\.\/HomeSurface['"]|<HomeSurface\b/.test(source)) {
      violations.push(`${relativePath}: HomeSurface forwarding shell is still used`);
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

async function readAppFiles(relativePaths) {
  const chunks = [];
  for (const relativePath of relativePaths) {
    chunks.push(await readFile(path.join(appRoot, relativePath), 'utf8'));
  }
  return chunks.join('\n');
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(importSpecifierPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
