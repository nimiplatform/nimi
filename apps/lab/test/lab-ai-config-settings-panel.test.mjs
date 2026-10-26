import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const kitRequire = createRequire(path.resolve(root, '../../kit/package.json'));
const { JSDOM } = kitRequire('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const tempRoot = path.resolve(root, '.tmp');
mkdirSync(tempRoot, { recursive: true });
const buildDir = mkdtempSync(path.join(tempRoot, 'ai-config-panel-'));
await build({
  stdin: {
    contents: `export { LabAiConfigSettingsPanel } from './src/lab/workbench/lab-ai-config-settings-panel.tsx';
      export { LabRendererProvider } from './src/renderer/context.tsx';
      export { STUDIO_AI_CONFIG_CHANGED_EVENT } from './src/ai-studio-core/ai-config.ts';
      export { observePanel } from 'test:panel-surface';`,
    resolveDir: root, loader: 'ts',
  },
  outfile: path.join(buildDir, 'panel.mjs'), bundle: true, packages: 'external',
  platform: 'node', format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'observe-panel-editor-binding', setup(builder) {
    builder.onResolve({ filter: /^(?:@nimiplatform\/kit\/features\/model-config|test:panel-surface)$/ }, () => ({ path: 'surface', namespace: 'panel-test' }));
    // Exercise the real panel and canonical-client callbacks. This observer
    // substitutes only the editor view; it never supplies an owner outcome.
    builder.onLoad({ filter: /.*/, namespace: 'panel-test' }, () => ({ loader: 'js', resolveDir: root, contents: `
      import { createElement } from 'react';
      let props, renders = 0;
      export const observePanel = () => ({ props, renders });
      export function ModelConfigAIConfigSurface(value) {
        props = value; renders++;
        return createElement('output', { 'data-panel-revision': value.revision ?? '', 'data-panel-loading': String(value.loading) });
      }
    ` }));
  } }],
});
const { LabAiConfigSettingsPanel, LabRendererProvider, STUDIO_AI_CONFIG_CHANGED_EVENT, observePanel } = await import(
  pathToFileURL(path.join(buildDir, 'panel.mjs')).href,
);
test.after(async () => {
  dom.window.close();
  const resolved = path.resolve(buildDir);
  assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`));
  await rm(resolved, { recursive: true, force: true });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(revision) {
  return { config: { owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.lab' } } }, capabilities: [] }, revision, effectiveSelections: [] };
}
function owner() {
  const reads = [], writes = [];
  const bindings = { sdk: { aiConfig: {
    get() { const request = deferred(); reads.push(request); return request.promise; },
    overwrite(input) { const request = deferred(); writes.push({ ...request, input }); return request.promise; },
    listOptions() { throw new Error('The panel race test does not request editor choices.'); },
  } } };
  return { bindings, reads, writes };
}
async function mount(initialOwner) {
  const node = document.createElement('div'); document.body.appendChild(node);
  const renderer = createRoot(node);
  let mounted = true, commits = 0;
  const render = async currentOwner => act(async () => {
    renderer.render(createElement(LabRendererProvider, { bindings: currentOwner.bindings },
      createElement(LabAiConfigSettingsPanel, { runtime: null, capabilityId: 'text.generate',
        onCommitted() { commits++; window.dispatchEvent(new Event(STUDIO_AI_CONFIG_CHANGED_EVENT)); },
      })));
  });
  await render(initialOwner);
  return {
    render,
    commits: () => commits,
    async close() {
      if (!mounted) return;
      mounted = false;
      await act(async () => renderer.unmount());
      node.remove();
    },
  };
}
const settle = async (request, value) => act(async () => { request.resolve(value); });
const focus = async () => act(async () => { window.dispatchEvent(new Event('focus')); });
async function startWrite() {
  let pending;
  await act(async () => { pending = observePanel().props.onOverwrite({ expectedRevision: '1', capabilities: [] }); });
  return { pending };
}

test('a late pre-commit read cannot replace the acknowledgement or its fresh reread', async () => {
  const source = owner(), panel = await mount(source);
  try {
    await settle(source.reads[0], snapshot('1'));
    await focus();
    const oldRead = source.reads[1];
    const write = await startWrite();
    await act(async () => {
      source.writes[0].resolve({ outcome: 'committed', ...snapshot('2') });
      await write.pending;
    });
    assert.equal(panel.commits(), 1);
    assert.equal(source.reads.length, 3, 'commit must request fresh owner state');
    assert.equal(observePanel().props.revision, '2');
    await settle(source.reads[2], snapshot('3'));
    await settle(oldRead, snapshot('1'));
    assert.equal(observePanel().props.revision, '3');
    assert.equal(observePanel().props.loadError, null);
  } finally { await panel.close(); }
});

test('a stale failure and finally do not finish or fail a newer initial read', async () => {
  const source = owner(), panel = await mount(source);
  try {
    await focus();
    await act(async () => { source.reads[0].reject(new Error('old read failed')); });
    assert.equal(observePanel().props.loading, true);
    assert.equal(observePanel().props.loadError, null);
    await settle(source.reads[1], snapshot('2'));
    assert.equal(observePanel().props.revision, '2');
    assert.equal(observePanel().props.loading, false);
  } finally { await panel.close(); }
});

test('changing the renderer scope hides its old snapshot and ignores its late read', async () => {
  const first = owner(), next = owner(), panel = await mount(first);
  try {
    await settle(first.reads[0], snapshot('1'));
    await focus();
    await panel.render(next);
    assert.equal(observePanel().props.revision, undefined);
    assert.equal(observePanel().props.loading, true);
    await settle(first.reads[1], snapshot('7'));
    assert.equal(observePanel().props.revision, undefined);
    await settle(next.reads[0], snapshot('2'));
    assert.equal(observePanel().props.revision, '2');
  } finally { await panel.close(); }
});

test('a write from the retired scope still notifies consumers without adopting its acknowledgement', async () => {
  const first = owner(), next = owner(), panel = await mount(first);
  try {
    await settle(first.reads[0], snapshot('1'));
    const write = await startWrite();
    await panel.render(next);
    await settle(next.reads[0], snapshot('4'));
    await act(async () => {
      first.writes[0].resolve({ outcome: 'committed', ...snapshot('2') });
      await write.pending;
    });
    assert.equal(panel.commits(), 1);
    assert.equal(next.reads.length, 2, 'the current consumer still learns of the commit');
    assert.equal(observePanel().props.revision, '4');
    await settle(next.reads[1], snapshot('5'));
    assert.equal(observePanel().props.revision, '5');
  } finally { await panel.close(); }
});

test('unmount ignores late UI results but preserves the committed-write notification', async () => {
  const source = owner(), panel = await mount(source);
  try {
    await settle(source.reads[0], snapshot('1'));
    await focus();
    const write = await startWrite();
    await panel.close();
    const renders = observePanel().renders;
    await settle(source.reads[1], snapshot('7'));
    await act(async () => {
      source.writes[0].resolve({ outcome: 'committed', ...snapshot('2') });
      await write.pending;
    });
    assert.equal(observePanel().renders, renders);
    assert.equal(panel.commits(), 1);
    assert.equal(source.reads.length, 2, 'the unmounted panel must not restart reads');
  } finally { await panel.close(); }
});
