import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { importBehaviorModule, cleanupBehaviorModules } from './lab-contract/helpers.mjs';

after(cleanupBehaviorModules);
// These isolated owner-UI fixtures exercise actual React handlers and ordering.
// They are not live Runtime, platform or media-handle acceptance evidence.
async function panel(host, check) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const scrolled = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { LabRendererProvider } = await importBehaviorModule('renderer/context.js');
  const { LabIntegrationsPanel } = await importBehaviorModule('lab/integrations/integrations-panel.js');
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(LabRendererProvider, { bindings: host }, React.createElement(LabIntegrationsPanel, { recordAI: async () => {} }))));
    await check(dom.window.document, dom, scrolled);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}
const call = (id, targetRef = 'A', resultJson = '') => ({ callId: id, targetRef, operation: 'mcp.echo', status: 'completed', resultJson, errorCode: '', targetDisplayName: targetRef, createdAt: '2026-10-09T02:00:00Z' });
const record = id => ({ kind: 'integration', id, adapter: 'mcp', targetRef: 'A', targetDisplayName: 'A', operation: 'mcp.echo', callId: id, status: 'completed', createdAt: '2026-10-09T02:00:00Z', inputJson: '', resultJson: '', errorCode: '', assetPaths: [] });
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };
function fixture(initial = [record('old-A'), record('old-B')]) {
  let records = initial; const queries = new Map(initial.map(row => [row.callId, deferred()])); const io = []; const files = new Map();
  const foreground = deferred();
  const host = { sdk: { localAppClient: {
    integration: { listConnections: async () => [{ targetRef: 'B', kind: 'mcp', displayName: 'B', available: true, operations: [{ name: 'mcp.echo', description: 'Echo', effect: 'read', inputSchemaJson: '{}' }], permittedOperations: ['mcp.echo'] }], getCall: async ({ callId }) => queries.get(callId).promise, invoke: async () => foreground.promise, cancelCall: async () => assert.fail('unexpected cancellation') },
    storage: { assets: {
      list: async input => { io.push(['list', input]); return { assets: [...files.values()], nextCursor: '' }; },
      stat: async path => { io.push(['stat', path]); return files.get(path); },
      reveal: async path => { io.push(['reveal', path]); return { revealed: true }; },
      remove: async path => { io.push(['remove', path]); files.delete(path); return { removed: true }; },
    } },
  } }, app: { projection: { integrationHistory: async () => records }, commands: {
    appendIntegrationHistory: async row => { records = [row, ...records.filter(item => item.id !== row.id)]; return records; },
    removeIntegrationHistory: async id => { records = records.filter(row => row.id !== id); return records; },
    exportText: async () => ({ ok: false }),
  } } };
  return { host, queries, foreground, io, files, records: () => records };
}
const button = (root, name) => [...root.querySelectorAll('button')].find(node => node.textContent === name);
const rowFor = (document, id) => [...document.querySelectorAll('[data-testid=integration-history-row]')].find(row => row.textContent.includes(id));
const click = async element => { assert.ok(element); await act(async () => element.click()); };
const select = async (dom, element, value) => act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });

for (const oldFirst of [false, true]) test(`late history observation cannot replace a new foreground receipt (${oldFirst ? 'old' : 'new'} response first)`, async () => {
  const f = fixture();
  await panel(f.host, async (document, dom) => {
    await click(button(rowFor(document, 'old-A'), 'Check original call'));
    await select(dom, document.querySelector('select'), 'B');
    await select(dom, document.querySelectorAll('select')[1], 'mcp.echo');
    await click(button(document, 'Invoke once'));
    const old = call('old-A', 'A', '{"source":"old"}'); const fresh = call('current-B', 'B', '{"source":"current"}');
    if (oldFirst) {
      await act(async () => f.queries.get('old-A').resolve(old));
      assert.equal(document.querySelector('[data-testid=integration-call]'), null);
      await act(async () => f.foreground.resolve(fresh));
    } else {
      await act(async () => f.foreground.resolve(fresh));
      await act(async () => f.queries.get('old-A').resolve(old));
    }
    const current = document.querySelector('[data-testid=integration-call]').textContent;
    assert.match(current, /current-B/u); assert.doesNotMatch(current, /old-A/u);
    assert.equal(f.records().find(row => row.callId === 'old-A').status, 'completed');
  });
});

test('history queries returning in reverse order keep the last selected call on display', async () => {
  const f = fixture();
  await panel(f.host, async document => {
    await click(button(rowFor(document, 'old-A'), 'Check original call'));
    await click(button(rowFor(document, 'old-B'), 'Check original call'));
    await act(async () => f.queries.get('old-B').resolve(call('old-B')));
    await act(async () => f.queries.get('old-A').resolve(call('old-A')));
    assert.match(document.querySelector('[data-testid=integration-call]').textContent, /old-B/u);
    assert.equal(f.records().length, 2);
  });
});

test('old media history cannot preview, reveal or delete a legally rebuilt file; the current-file entry can manage it', async () => {
  const path = 'received/reused/photo.png';
  const old = { ...record('old-X'), adapter: 'feishu', operation: 'feishu.media.fetch', assetPaths: [path] };
  const fresh = { ...old, id: 'new-Y', callId: 'new-Y' };
  const f = fixture([fresh, old]);
  const original = { relativePath: path, sha256: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', sizeBytes: 4, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' };
  f.files.set(path, original); f.files.delete(path);
  const replacement = { ...original, sha256: `sha256:${'b'.repeat(64)}`, createdAt: '2026-10-09T02:00:00Z', updatedAt: '2026-10-09T02:00:00Z' };
  f.files.set(path, replacement);
  await panel(f.host, async (document, dom) => {
    await click(button(rowFor(document, 'old-X'), 'View saved record'));
    const detail = document.querySelector('[data-testid=integration-saved-record]');
    assert.match(detail.textContent, /received\/reused\/photo.png/u);
    assert.equal(button(detail, 'Preview saved media'), undefined);
    assert.equal(button(detail, 'Show owned asset in folder'), undefined);
    assert.deepEqual(f.io, [], 'a saved path must not authorize any current asset I/O');
    await click(button(rowFor(document, 'old-X'), 'Remove history record'));
    assert.deepEqual(f.io, []); assert.equal(f.files.get(path), replacement);
    assert.equal(f.records().some(row => row.id === 'new-Y'), true);
    const files = document.querySelector('[data-testid=integration-current-assets]');
    await act(async () => { files.querySelector('details').open = true; files.querySelector('details').dispatchEvent(new dom.window.Event('toggle')); });
    assert.equal(f.io[0][1].prefix, '', 'current files include arbitrary inbound paths');
    await click(button(files, 'View current file'));
    assert.match(files.textContent, new RegExp(replacement.sha256, 'u'));
    assert.ok(button(files, 'Preview saved media'));
    await click(button(files, 'Show owned asset in folder'));
    assert.ok(f.io.some(([operation, value]) => operation === 'reveal' && value === path));
    await click(button(files, 'Delete current file'));
    assert.equal(f.files.has(path), false);
    assert.equal(f.records().some(row => row.id === 'new-Y'), true, 'explicit file management keeps call facts');
  });
});

test('history detail is inline and focused; closing returns to its trigger and each row shows its existing time', async () => {
  const f = fixture(Array.from({ length: 15 }, (_, index) => record(`call-${index + 1}`)));
  await panel(f.host, async (document, _dom, scrolled) => {
    const row = rowFor(document, 'call-13'); const trigger = button(row, 'View saved record');
    await click(trigger);
    const detail = document.querySelector('[data-testid=integration-saved-record]');
    assert.ok(row.contains(detail)); assert.equal(document.activeElement, detail); assert.equal(scrolled.at(-1), detail);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    await click(button(detail, 'Close saved record'));
    assert.equal(document.activeElement, trigger); assert.equal(scrolled.at(-1), trigger);
    assert.equal(document.querySelector('[data-testid=integration-saved-record]'), null);
    for (const current of document.querySelectorAll('[data-testid=integration-history-row]')) {
      assert.equal(current.querySelector('time').getAttribute('datetime'), '2026-10-09T02:00:00Z');
      assert.match(current.querySelector('time').textContent, /2026/u);
    }
  });
});

test('export exposes fulfilled failure and retained file path; location retries never export again', async () => {
  const f = fixture(); let exports = 0; let reveals = 0;
  f.host.app.commands.exportText = async () => ++exports === 1 ? { ok: false, error: { disposition: 'host-unavailable' } } : { ok: true, value: { artifactPath: 'exports/owned/history.json', filename: 'history.json', byteSize: 5, revealed: false } };
  f.host.sdk.localAppClient.storage.assets.reveal = async path => { assert.equal(path, 'exports/owned/history.json'); if (++reveals === 1) throw new Error('fixture-reveal-failed'); return { revealed: true }; };
  await panel(f.host, async document => {
    await click(button(document, 'Export JSON'));
    assert.equal(document.querySelector('[data-testid=integration-export-result]'), null);
    const failure=document.querySelector('[data-testid=integration-export-error]');assert.ok(failure,'fulfilled failure must be visible near export');assert.match(failure.textContent,/History export failed/u);assert.equal(failure.getAttribute('aria-live'),'polite');
    await click(button(document, 'Export JSON'));
    const result = document.querySelector('[data-testid=integration-export-result]');
    assert.match(result.textContent, /exports\/owned\/history.json/u);
    await click(button(result, 'Show owned asset in folder'));
    assert.match(document.querySelector('[data-testid=integration-export-error]').textContent,/its location could not be opened/u);
    await click(button(result, 'Show owned asset in folder'));
    assert.equal(exports, 2); assert.equal(reveals, 2);
    assert.match(result.textContent, /exports\/owned\/history.json/u);
  });
});
