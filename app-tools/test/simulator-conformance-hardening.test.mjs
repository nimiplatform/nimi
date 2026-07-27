import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildSimulatorSourceInventory,
  validateSimulatorAppSource,
} from '../lib/simulator-conformance.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(TEST_ROOT, 'fixtures', 'simulator-valid');

function withFixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'nimi-simulator-hardening-'));
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
  assert.throws(() => validateSimulatorAppSource(root), (error) => error?.code === code);
}

function initializeGit(root) {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
}

test('Adapter closure forbids UI runtime, renderer resources, DOM, and CSS ownership', async (context) => {
  for (const [name, mutation, code] of [
    ['React runtime', (root) => append(root, 'src/simulator/adapter.ts', "import React from 'react';"), 'SIM_ADAPTER_UI_IMPORT'],
    ['renderer resource', (root) => append(root, 'src/simulator/adapter.ts', 'export function rebuild() { return createQueryClient(); }'), 'SIM_ADAPTER_RESOURCE_FACTORY'],
    ['DOM access', (root) => append(root, 'src/simulator/adapter.ts', 'export const root = document.body;'), 'SIM_ADAPTER_DOM'],
    ['CSS import', (root) => append(root, 'src/simulator/adapter.ts', "import '../renderer/styles.css';"), 'SIM_CSS_OUTSIDE_CANONICAL_STYLE'],
  ]) {
    await context.test(name, () => withFixture((root) => {
      mutation(root);
      expectFailure(root, code);
    }));
  }
});

test('canonical closure rejects concrete module-evaluation mutation bypasses', async (context) => {
  for (const [name, source, code] of [
    ['IIFE', 'export const shared = Object.freeze((() => ({ values: [] }))());', 'SIM_MODULE_SCOPE_IIFE'],
    ['object this mutation', 'export const shared = Object.freeze({ values: [] as string[], add(value: string) { this.values.push(value); } });', 'SIM_MODULE_SCOPE_MUTATION'],
    ['class static cache', 'export class Shared { static cache = new Map<string, string>(); }', 'SIM_MODULE_SCOPE_RESOURCE'],
    ['helper parameter mutation', 'export const shared: string[] = []; function mutate(values: string[]) { values.push("x"); } mutate(shared);', 'SIM_MODULE_SCOPE_MUTATION'],
  ]) {
    await context.test(name, () => withFixture((root) => {
      writeFileSync(path.join(root, 'src', 'renderer', 'state.ts'), `${source}\n`);
      append(root, 'src/renderer/factory.ts', "export * from './state';");
      expectFailure(root, code);
    }));
  }
});

test('canonical factory and Adapter construction reject async, generator, and conditional paths', async (context) => {
  for (const [name, relativePath, mutate, code] of [
    [
      'async canonical factory',
      'src/renderer/factory.ts',
      (source) => source.replace('  createInstance(', '  async createInstance('),
      'SIM_FACTORY_CREATE_INSTANCE_CONTROL_FLOW',
    ],
    [
      'conditional canonical factory return',
      'src/renderer/factory.ts',
      (source) => source.replace('    return {\n      surfaces:', '    if (bindings.invalid) return { surfaces: Object.freeze({}), dispose() {} };\n    return {\n      surfaces:'),
      'SIM_FACTORY_CREATE_INSTANCE_CONTROL_FLOW',
    ],
    [
      'generator Adapter create',
      'src/simulator/adapter.ts',
      (source) => source.replace('  create() {', '  *create() {'),
      'SIM_ADAPTER_CREATE_CONTROL_FLOW',
    ],
    [
      'conditional Adapter return',
      'src/simulator/adapter.ts',
      (source) => source.replace(
        '  create() {\n    return {',
        '  create() {\n    if (true) return {};\n    return {',
      ),
      'SIM_ADAPTER_CREATE_CONTROL_FLOW',
    ],
    [
      'Adapter instance UI extension',
      'src/simulator/adapter.ts',
      (source) => source.replace('      prepare() {},', '      render() { return null; },\n      prepare() {},'),
      'SIM_ADAPTER_INSTANCE_FIELDS',
    ],
  ]) {
    await context.test(name, () => withFixture((root) => {
      const target = path.join(root, ...relativePath.split('/'));
      writeFileSync(target, mutate(readFileSync(target, 'utf8')));
      expectFailure(root, code);
    }));
  }
});

test('resolved graph and canonical style inputs must be present in the source inventory', async (context) => {
  await context.test('ignored graph module', () => withFixture((root) => {
    writeFileSync(path.join(root, '.gitignore'), 'src/renderer/ignored.ts\n');
    initializeGit(root);
    writeFileSync(path.join(root, 'src', 'renderer', 'ignored.ts'), 'export const ignored = true;\n');
    append(root, 'src/renderer/factory.ts', "export * from './ignored';");
    expectFailure(root, 'SIM_SOURCE_GRAPH_UNBOUND');
  }));

  await context.test('ignored CSS input', () => withFixture((root) => {
    writeFileSync(path.join(root, '.gitignore'), 'src/renderer/ignored.css\n');
    initializeGit(root);
    writeFileSync(path.join(root, 'src', 'renderer', 'ignored.css'), '.nimi-ui-module--sample-app { color: red; }\n');
    const style = path.join(root, 'src', 'renderer', 'styles.css');
    writeFileSync(style, `@import './ignored.css';\n${readFileSync(style, 'utf8')}`);
    expectFailure(root, 'SIM_SOURCE_GRAPH_UNBOUND');
  }));
});

test('source digest mode binds the Git index mode when an index exists', () => withFixture((root) => {
  initializeGit(root);
  const factory = path.join(root, 'src', 'renderer', 'factory.ts');
  execFileSync('git', ['update-index', '--chmod=+x', 'src/renderer/factory.ts'], { cwd: root });
  chmodSync(factory, 0o644);
  const result = validateSimulatorAppSource(root);
  assert.equal(result.source.files.find((entry) => entry.path === 'src/renderer/factory.ts')?.mode, '100755');
}));

test('source inventory reflects tracked deletions in the current worktree', () => withFixture((root) => {
  writeFileSync(path.join(root, 'tracked-delete.txt'), 'delete me\n');
  initializeGit(root);
  unlinkSync(path.join(root, 'tracked-delete.txt'));
  const source = buildSimulatorSourceInventory(root);
  assert.equal(source.files.some((entry) => entry.path === 'tracked-delete.txt'), false);
}));

test('production invocation must call the canonical factory instead of merely importing it', () => withFixture((root) => {
  const mainPath = path.join(root, 'src', 'main.ts');
  const source = readFileSync(mainPath, 'utf8')
    .replace(
      "import './renderer/styles.css';",
      "import './renderer/styles.css';\nconst alternateFactory = { createInstance: (bindings: unknown) => ({ bindings }) };",
    )
    .replace('sampleCanonicalRendererFactory.createInstance(bindings)', 'alternateFactory.createInstance(bindings)');
  writeFileSync(mainPath, source);
  expectFailure(root, 'SIM_PRODUCTION_FACTORY_USE');
}));

test('production invocation permits createInstance APIs owned by declared external packages', () => withFixture((root) => {
  const mainPath = path.join(root, 'src', 'main.ts');
  const source = readFileSync(mainPath, 'utf8')
    .replace(
      "import './renderer/styles.css';",
      "import './renderer/styles.css';\nimport zod from 'zod';\nvoid zod.createInstance();",
    );
  writeFileSync(mainPath, source);
  const result = validateSimulatorAppSource(root);
  assert.equal(result.manifest.module_id, 'sample-app');
}));
