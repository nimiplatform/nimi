import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  isSimulatorStaticAssetPath,
  parseSimulatorManifest,
  validateSimulatorAppSource,
} from '../lib/simulator-conformance.mjs';
import {
  validateSimulatorCanonicalKitExports,
} from '../lib/simulator-kit-export-resolution.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(TEST_ROOT, 'fixtures', 'simulator-valid');
const CLI_PATH = path.resolve(TEST_ROOT, '..', 'bin', 'nimi-app.mjs');
const VALID_MANIFEST = readFileSync(path.join(FIXTURE_ROOT, 'nimi.simulator.yaml'), 'utf8');
const KIT_ROOT = path.resolve(TEST_ROOT, '..', '..', 'kit');

function withFixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-app-tools-'));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function append(root, relativePath, source) {
  const target = path.join(root, ...relativePath.split('/'));
  writeFileSync(target, `${readFileSync(target, 'utf8')}\n${source}\n`);
}

function expectFailure(root, code) {
  assert.throws(
    () => validateSimulatorAppSource(root),
    (error) => error?.code === code,
  );
}

test('valid Simulator App source exposes its current renderer and scoped CSS inputs', () => {
  const result = validateSimulatorAppSource(FIXTURE_ROOT);
  assert.equal(result.manifest.module_id, 'sample-app');
  assert.equal(result.style.profile.protocol, 'nimi.simulator.css-profile/v1');
  assert.equal(result.style.profile.utility.root_class, 'nimi-ui-module--sample-app');
  assert.equal(result.style.profile.utility.layer, 'simulator.module.sample-app');
  assert.deepEqual(result.style.inputs, [{ path: 'src/renderer/styles.css' }]);
  assert.equal(result.fixture.moduleId, 'sample-app');
});

test('Manifest accepts owner-canonical camelCase SDK method IDs', () => {
  const manifest = parseSimulatorManifest(
    VALID_MANIFEST.replace('  sdk_methods: []', '  sdk_methods:\n    - nimi.ai.generateText'),
  );
  assert.deepEqual(manifest.requires.sdk_methods, ['nimi.ai.generateText']);
});

test('Manifest rejects fields outside the browser preview contract', () => {
  assert.throws(
    () => parseSimulatorManifest(`${VALID_MANIFEST}\nsource_revision: stale\n`),
    (error) => error?.code === 'SIM_MANIFEST_UNKNOWN_FIELD',
  );
});

test('renderer entry must reach the canonical factory', () => withFixture((root) => {
  const rendererPath = path.join(root, 'src', 'simulator', 'renderer.ts');
  writeFileSync(
    rendererPath,
    readFileSync(rendererPath, 'utf8')
      .replace("import { sampleCanonicalRendererFactory } from '../renderer/factory';\n", '')
      .replace('sampleCanonicalRendererFactory', '{ createInstance() { throw new Error(\"unreachable\"); } }'),
  );
  expectFailure(root, 'SIM_RENDERER_FACTORY_REACHABILITY');
}));

test('Adapter closure rejects UI runtime, DOM access, and CSS ownership', async (context) => {
  for (const [name, mutation, code] of [
    ['React runtime', (root) => append(root, 'src/simulator/adapter.ts', "import React from 'react';"), 'SIM_ADAPTER_UI_IMPORT'],
    ['DOM access', (root) => append(root, 'src/simulator/adapter.ts', 'export const root = document.body;'), 'SIM_ADAPTER_DOM'],
    ['CSS import', (root) => append(root, 'src/simulator/adapter.ts', "import '../renderer/styles.css';"), 'SIM_CSS_OUTSIDE_CANONICAL_STYLE'],
  ]) {
    await context.test(name, () => withFixture((root) => {
      mutation(root);
      expectFailure(root, code);
    }));
  }
});

test('per-instance resources remain allowed while module-scope resources fail closed', () => withFixture((root) => {
  append(root, 'src/renderer/factory.ts', 'export function createLocalCache() { return new Map<string, string>(); }');
  assert.equal(validateSimulatorAppSource(root).manifest.module_id, 'sample-app');
  append(root, 'src/renderer/factory.ts', 'export const sharedCache = new Map<string, string>();');
  expectFailure(root, 'SIM_MODULE_SCOPE_RESOURCE');
}));

test('adapter rejects the retired first-party Agent Center session factory at every scope', () => withFixture((root) => {
  append(root, 'src/simulator/adapter.ts', `
import { createFirstPartyAgentCenterSession } from '@nimiplatform/kit/features/agent-center';
export function projectAgentCenterSession(input: unknown) {
  return createFirstPartyAgentCenterSession(input);
}
`);
  expectFailure(root, 'SIM_ADAPTER_RESOURCE_FACTORY');
}));

test('Simulator conformance resolves actual canonical Kit exports', async () => {
  const resolved = await validateSimulatorCanonicalKitExports({ kitPackageRoot: KIT_ROOT });
  assert.deepEqual(resolved.map(({ subpath, exports }) => ({ subpath, exports })), [{
    subpath: './features/agent-center',
    exports: ['createAppAgentCenterSession', 'AppAgentCenterEntry'],
  }, {
    subpath: './features/chat',
    exports: ['AppConversationEntry', 'createBrowserAppConversationHostPort'],
  }, {
    subpath: './features/agent-realtime',
    exports: ['AgentRealtimeEntry', 'createBrowserAgentRealtimeHostMediaPort'],
  }]);
  await assert.rejects(
    () => validateSimulatorCanonicalKitExports({
      kitPackageRoot: KIT_ROOT,
      requirements: [{
        subpath: './features/agent-center',
        exports: ['createFirstPartyAgentCenterSession'],
      }],
    }),
    (error) => error?.code === 'SIM_KIT_EXPORT_MISSING',
  );
});

test('source-bound PNG and JSON imports are supported without admitting executable asset types', () => withFixture((root) => {
  assert.equal(isSimulatorStaticAssetPath('src/renderer/logo.png'), true);
  assert.equal(isSimulatorStaticAssetPath('src/renderer/messages.json'), true);
  assert.equal(isSimulatorStaticAssetPath('src/renderer/logo.svg'), false);

  writeFileSync(path.join(root, 'src', 'renderer', 'logo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(path.join(root, 'src', 'renderer', 'messages.json'), '{"title":"Nimi"}\n');
  const factoryPath = path.join(root, 'src', 'renderer', 'factory.ts');
  writeFileSync(
    factoryPath,
    `import logo from './logo.png';\nimport messages from './messages.json';\n${readFileSync(factoryPath, 'utf8')}\nexport const assets = { logo, title: messages.title };\n`,
  );
  assert.equal(validateSimulatorAppSource(root).manifest.module_id, 'sample-app');

  writeFileSync(path.join(root, 'src', 'renderer', 'messages.json'), '{"title":');
  expectFailure(root, 'SIM_IMPORT_JSON_INVALID');
}));

test('App CSS must remain module-scoped and cannot define the scanner itself', async (context) => {
  for (const [source, code] of [
    ['.unscoped { color: red; }', 'SIM_CSS_GLOBAL_SELECTOR'],
    ['.nimi-ui-module--sample-app { --leaked-value: red; }', 'SIM_CSS_CUSTOM_PROPERTY_NAMESPACE'],
    ['@keyframes spin { to { opacity: 0; } }', 'SIM_CSS_KEYFRAMES_NAMESPACE'],
    ['@source "./factory.ts";', 'SIM_CSS_SOURCE_DIRECTIVE'],
    ['@tailwind utilities;', 'SIM_CSS_FOUNDATION_DUPLICATE'],
  ]) {
    await context.test(code, () => withFixture((root) => {
      append(root, 'src/renderer/styles.css', source);
      expectFailure(root, code);
    }));
  }
});

test('dynamic Tailwind utility interpolation is rejected', () => withFixture((root) => {
  append(root, 'src/renderer/factory.ts', 'export const dynamicWidth = (size: string) => `w-${size}`;');
  expectFailure(root, 'SIM_CSS_DYNAMIC_UTILITY');
}));

test('CLI validates the current source and fails closed for a missing root', () => {
  const output = execFileSync(
    process.execPath,
    [CLI_PATH, 'check', '--dir', FIXTURE_ROOT, '--conformance', 'simulator'],
    { encoding: 'utf8' },
  );
  assert.match(output, /Simulator source validation passed/u);

  const failure = spawnSync(
    process.execPath,
    [CLI_PATH, 'check', '--dir', path.join(FIXTURE_ROOT, 'missing'), '--conformance', 'simulator'],
    { encoding: 'utf8' },
  );
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /failed: .*missing/u);
});
