import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const { JSDOM } = createRequire(path.resolve(root, '../../kit/package.json'))('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'HTMLInputElement', 'HTMLSelectElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TooltipProvider, getNimiToastSnapshot, nimiToast } = await import('@nimiplatform/kit/ui');
const { NIMI_RENDERER_HOST_PROTOCOL } = await import('@nimiplatform/kit/shell/renderer/host');
const messages = JSON.parse(readFileSync(path.join(root, 'src/ai-studio-core/messages/en.json'), 'utf8'));
const translate = (key, values = {}) => {
  const text = key.split('.').reduce((value, part) => value?.[part], messages) ?? key;
  return text.replace(/\{\{(\w+)\}\}/gu, (_, name) => String(values[name] ?? ''));
};
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.tmp', 'export-feedback-'));
// Only unrelated business services are isolated. The actual production binding,
// save helper, public Kit binding validator and all four UI consumers execute.
const source = ts.createSourceFile('bindings.ts', readFileSync(path.join(root, 'src/renderer/production-bindings.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true);
const unrelated = new Map();
for (const statement of source.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier.text.startsWith('..')) continue;
  const specifier = statement.moduleSpecifier.text;
  if (specifier.endsWith('/lab-export.js') || specifier.endsWith('/local-app-runtime-platform.js')) continue;
  if (statement.importClause?.isTypeOnly) continue;
  unrelated.set(specifier, statement.importClause.namedBindings.elements.map(item => item.propertyName?.text ?? item.name.text));
}
await build({
  stdin: { contents: `export { createLabProductionBindings } from './src/renderer/production-bindings.ts';
    export { SectionAITesting } from './src/ai-studio-core/section-ai-testing.tsx';
    export { TextStudioResultState } from './src/ai-studio-core/section-ai-testing-result.tsx';
    export { RuntimeDiagnosticsActions, downloadTextFile } from './src/ai-studio-core/section-ai-testing-output.tsx';
    export { MusicGenerationNotice } from './src/ai-studio-core/section-ai-testing-music-result.tsx';
    export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
    export { labStudioComposition } from './src/lab/lab-studio-composition.ts';`, resolveDir: root, loader: 'ts' },
  outfile: path.join(dir, 'view.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm',
  jsx: 'automatic', logLevel: 'silent', plugins: [{ name: 'export-storage-boundary', setup(builder) {
    builder.onResolve({ filter: /local-app-runtime-platform\.js$/ }, () => ({ path: 'client', namespace: 'export-test' }));
    builder.onResolve({ filter: /^\.\./ }, args => args.importer.endsWith('production-bindings.ts') && unrelated.has(args.path)
      ? { path: args.path, namespace: 'export-unrelated' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'export-test' }, () => ({ contents:
      'export function getLabLocalAppClient(){if(!globalThis.__EXPORT_FEEDBACK_CLIENT__)throw Error("host unavailable");return globalThis.__EXPORT_FEEDBACK_CLIENT__}', loader: 'js' }));
    builder.onLoad({ filter: /.*/, namespace: 'export-unrelated' }, args => ({ contents: unrelated.get(args.path)
      .map(name => `export const ${name} = () => { throw Error('Unexpected unrelated business call'); };`).join('\n'), loader: 'js' }));
  } }],
});
const { createLabProductionBindings, SectionAITesting, TextStudioResultState, RuntimeDiagnosticsActions,
  MusicGenerationNotice, AIStudioHostProvider, labStudioComposition, downloadTextFile } = await import(pathToFileURL(path.join(dir, 'view.mjs')).href);
test.after(async () => { delete globalThis.__EXPORT_FEEDBACK_CLIENT__; dom.window.close(); await rm(dir, { recursive: true, force: true }); });

const capabilities = { size: 0, has: () => false, values: () => [][Symbol.iterator](), [Symbol.iterator]: () => [][Symbol.iterator]() };
const kit = { protocol: NIMI_RENDERER_HOST_PROTOCOL, scope: { domId: id => id, globalName: id => id }, capabilities,
  localization: { language: 'en', locale: 'en', direction: 'ltr' }, surfaceLifecycle: { reportReadyCandidate() {} },
  invoke: async () => { throw Error('No host command expected'); }, theme: { getSnapshot() {}, subscribe: () => () => {} },
  overlays: { acquire() {}, target: null } };
const target = { capabilityId: 'text.generate', capabilityContract: 'text.generate', section: 'text', source: 'local',
  status: 'configured', canDispatch: true, intentLabel: 'Local', detail: 'configured', params: {}, paramsSummary: [], profileOrigin: null };
const text = 'Selected real-shaped result · 保留完整文本';
const record = { id: 'export-selected', capabilityId: 'text.generate', createdAt: '2026-10-05T10:00:00.000Z',
  prompt: 'selected prompt', status: 'ready', result: { ok: true, kind: 'text', body: text, summary: text,
    charCount: text.length, finishReason: 'stop', streamed: false } };
const button = key => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === translate(key) || item.textContent.trim() === translate(key));
const click = async key => { const item = button(key); assert.ok(item, key); await act(async () => { item.click(); }); };

function makeHost(outcome) {
  const writes = [], reveals = [];
  const assets = {
    async write(input) {
      assert.match(input.mediaType, /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u, 'public assets require a canonical MIME without charset parameters');
      if (outcome === 'write-rejected') throw Error('storage rejected');
      const bytes = Buffer.from(await input.body.arrayBuffer());
      writes.push({ ...input, bytes });
      return { relativePath: input.relativePath, sizeBytes: bytes.length, mediaType: input.mediaType,
        sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    },
    async reveal(relativePath) { reveals.push(relativePath); if (outcome === 'reveal-rejected') throw Error('host unavailable'); return { revealed: true }; },
    async read() { const bytes = new TextEncoder().encode('X:1\nK:C\nC D E F|'); return { asset: { sizeBytes: bytes.length,
      mediaType: 'text/vnd.abc' }, body: (async function* () { yield bytes; })() }; },
  };
  globalThis.__EXPORT_FEEDBACK_CLIENT__ = { storage: { assets }, ai: { voiceAssets: {}, artifacts: {} }, aiConfig: {} };
  const production = createLabProductionBindings(kit);
  const host = { appTitle: 'Lab', translate, locale: 'en', clock: { now: () => Date.parse('2026-10-05T10:00:00Z') },
    app: { commands: production.app.commands, projection: { promptDraft: () => ({ prompt: 'selected prompt' }),
      projectRunTarget: () => target, runStatusLabel: status => status }, events: { subscribeAIConfigRefresh: () => () => {} } },
    sdk: { assets, revealLocalAppAsset: relativePath => production.sdk.storage.assets.reveal(relativePath),
      aiConfig: { get: async () => null, getSnapshot: async () => ({ effectiveSelections: [] }) },
      runCapability: async () => ({ ok: true, capabilityId: 'text.generate', output: { kind: 'text', text } }) } };
  return { host, writes, reveals };
}

for (const caller of ['current-result', 'saved-history', 'diagnostics', 'generated-score']) {
  for (const outcome of ['saved-and-revealed', 'write-rejected', 'reveal-rejected']) {
    test(`production binding → ${caller}: ${outcome} produces truthful feedback`, async () => {
      nimiToast.clear();
      const { host, writes, reveals } = makeHost(outcome);
      const renderer = createRoot(document.getElementById('root'));
      const registration = labStudioComposition.getCapability('text.generate');
      let component;
      if (caller === 'current-result') component = createElement(SectionAITesting, { registration, registrations: [registration],
        runtime: { status: 'connected', detail: 'connected' }, lastResult: null, history: {}, historySelectionRequest: null,
        onSelectHistoryRun() {}, onResult: () => record, verboseConsole: false, draftPersistence: false });
      else if (caller === 'saved-history') component = createElement(TextStudioResultState, { registration,
        activeRun: { id: record.id, prompt: record.prompt, context: '', createdAt: record.createdAt, result: null, record },
        admission: { label: 'configured', tone: 'success' }, intentLabel: 'Local', running: false, canRegenerate: false,
        cancelRequested: false, streamingText: null, verboseConsole: false, composer: null,
        onCopy() {}, onDownload() { throw Error('History must use its own handler'); }, onRegenerate() {}, onUseAsDraft() {} });
      else if (caller === 'diagnostics') component = createElement(RuntimeDiagnosticsActions, { text, filenameBase: 'selected' });
      else component = createElement(MusicGenerationNotice, { value: { termination: 'model-end', generatedScore: { relativePath: 'score.abc' } } });
      try {
        await act(async () => { renderer.render(createElement(TooltipProvider, null,
          createElement(AIStudioHostProvider, { value: host }, component))); });
        if (caller === 'current-result') await click('Studio.profiles.textGenerate.primaryLabel');
        if (caller === 'generated-score') { await click('Music.viewScore'); await click('Music.exportScore'); }
        else await click(caller === 'diagnostics' ? 'StudioShell.downloadRuntimeDetails' : 'StudioShell.downloadGeneration');
        const toast = getNimiToastSnapshot().at(-1);
        assert.ok(toast);
        if (outcome === 'write-rejected') {
          assert.equal(toast.tone, 'danger'); assert.equal(toast.message, translate('Common.exportFailed'));
          assert.equal(writes.length, 0); assert.equal(reveals.length, 0);
        } else {
          assert.equal(writes.length, 1, 'reveal failures must not repeat writes');
          const expected = caller === 'generated-score' ? 'X:1\nK:C\nC D E F|' : text;
          assert.equal(writes[0].bytes.toString('utf8'), expected);
          assert.equal(writes[0].mediaType, 'text/plain');
          assert.deepEqual(reveals, [writes[0].relativePath]);
          assert.equal(toast.tone, outcome === 'reveal-rejected' ? 'warning' : 'success');
          assert.equal(toast.message, translate(outcome === 'reveal-rejected' ? 'Common.exportSavedRevealFailed' : 'Common.exportSaved', { path: writes[0].relativePath }));
        }
      } finally { await act(async () => { renderer.unmount(); }); nimiToast.clear(); }
    });
  }
}

test('production binding returns explicit failure when the App storage host disappears; the consumer reports it', async () => {
  const { host, writes, reveals } = makeHost('saved-and-revealed');
  delete globalThis.__EXPORT_FEEDBACK_CLIENT__;
  const result = await downloadTextFile(host, 'missing-host.txt', text);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0); assert.equal(reveals.length, 0);
  assert.equal(getNimiToastSnapshot().at(-1).message, translate('Common.exportFailed'));
  nimiToast.clear();
});

for (const outcome of ['saved-and-revealed', 'reveal-rejected']) test(`saved managed-asset Show in folder: ${outcome}`, async () => {
  const { host, writes, reveals } = makeHost(outcome);
  const renderer = createRoot(document.getElementById('root'));
  const asset = { relativePath: 'saved/report.json', sizeBytes: 2, mediaType: 'application/json' };
  const managedRecord = { ...record, result: { ok: true, kind: 'artifacts', firstArtifact: asset, artifacts: [asset], summary: 'report' } };
  try {
    await act(async () => { renderer.render(createElement(TooltipProvider, null, createElement(AIStudioHostProvider, { value: host },
      createElement(TextStudioResultState, { registration: labStudioComposition.getCapability('text.generate'),
        activeRun: { id: record.id, prompt: '', context: '', createdAt: record.createdAt, record: managedRecord, result: null },
        admission: { label: 'configured' }, intentLabel: 'Local', running: false, canRegenerate: false,
        cancelRequested: false, streamingText: null, verboseConsole: false, composer: null,
        onCopy() {}, onDownload() {}, onRegenerate() {}, onUseAsDraft() {} })))); });
    await click('StudioShell.revealGeneration');
    assert.equal(writes.length, 0); assert.deepEqual(reveals, [asset.relativePath]);
    assert.equal(getNimiToastSnapshot().at(-1).message, translate(outcome === 'reveal-rejected' ? 'Common.assetRevealFailed' : 'Common.assetRevealed', { path: asset.relativePath }));
  } finally { await act(async () => { renderer.unmount(); }); nimiToast.clear(); }
});
