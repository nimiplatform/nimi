import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'lab-history-undo-'));

await build({
  stdin: {
    contents: `
      export { useAIStudioWorkspaceController } from './src/ai-studio-core/workspace.tsx';
      export { CapabilityRunHistory } from './src/ai-studio-core/section-ai-testing-history.tsx';
      export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
      export {
        StudioHistoryActionsContext,
        StudioHistoryLoadContext,
        StudioHistoryPanelContext,
      } from './src/ai-studio-core/contexts.tsx';
      export { studioHistoryFromRecords } from './src/ai-studio-core/history-policy.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: path.join(buildDir, 'bundle.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  logLevel: 'silent',
});

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function makeRecord(id, prompt, createdAt = '2026-10-09T02:00:00Z') {
  return {
    id,
    capabilityId: 'text.generate',
    prompt,
    status: 'ready',
    message: 'Completed',
    createdAt,
  };
}

test('single-row AI Studio history delete removes optimistically and restores cleanly on Undo', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const mod = await import(pathToFileURL(path.join(buildDir, 'bundle.mjs')).href);
  const { createRoot } = await import('react-dom/client');
  const { getNimiToastSnapshot, nimiToast } = await import('@nimiplatform/kit/ui');
  nimiToast.clear();

  let persisted = [
    makeRecord('run-1', 'First prompt', '2026-10-09T02:00:00Z'),
    makeRecord('run-2', 'Second prompt', '2026-10-09T03:00:00Z'),
  ];
  const pendingRemove = deferred();
  const appended = [];
  const repository = {
    async load() {
      return { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] };
    },
    async persist() { throw new Error('unused'); },
    async appendRecord(record) {
      appended.push(record.id);
      persisted = [record, ...persisted.filter((item) => item.id !== record.id)];
      return { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] };
    },
    async cleanupArtifacts() { return { failures: [], remainingCleanupPaths: [] }; },
    async remove(recordId) {
      await pendingRemove.promise;
      persisted = persisted.filter((item) => item.id !== recordId);
      return {
        completed: 1,
        skipped: 0,
        failed: 0,
        projection: { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] },
        issues: [],
      };
    },
    async clear() { throw new Error('unused'); },
    async nextIdentity() { return { runId: 'next', createdAt: '2026-10-09T04:00:00Z' }; },
    loadPanelPreferences: () => ({ collapsed: false, scope: 'capability', hideFailures: false }),
    savePanelPreferences: () => {},
  };

  const host = {
    appTitle: 'Nimi Lab',
    translate: (key) => key,
    locale: 'en',
    clock: { now: () => Date.parse('2026-10-09T04:00:00Z') },
    app: {
      projection: {
        runStatusLabel: (status) => status,
        assetExportAction: () => 'reveal',
        promptDraft: async () => ({ prompt: null }),
        projectRunTarget: () => ({}),
      },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: {
        savePromptDraft: async () => {},
        copyText: async () => ({ ok: true }),
        exportText: async () => ({ ok: false }),
        exportAsset: async () => {},
      },
    },
    sdk: {
      aiConfig: {},
      assets: {},
      listLocalAppVoiceAssets: async () => [],
      runCapability: async () => { throw new Error('unused'); },
    },
  };

  function Harness() {
    const controller = mod.useAIStudioWorkspaceController({
      historyRepository: repository,
      registrations: [],
      onSelectCapability: () => {},
      translate: (key) => key,
    });
    return React.createElement(
      mod.AIStudioHostProvider,
      { value: host },
      React.createElement(
        mod.StudioHistoryLoadContext.Provider,
        { value: controller.historyLoadState },
        React.createElement(
          mod.StudioHistoryActionsContext.Provider,
          { value: controller.historyActions },
          React.createElement(
            mod.StudioHistoryPanelContext.Provider,
            { value: controller.historyPanelState },
            React.createElement(mod.CapabilityRunHistory, {
              history: controller.history,
              activeRunId: null,
              onSelectRun: () => {},
              collapsed: false,
              currentCapabilityId: 'text.generate',
              registrations: [],
            }),
          ),
        ),
      ),
    );
  }

  const reactRoot = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => {
      reactRoot.render(React.createElement(Harness));
    });

    const rows = () => [...dom.window.document.querySelectorAll('.studio-recent__rows > li')];
    assert.equal(rows().length, 2);

    const firstRowDelete = rows().find((row) => row.textContent.includes('Second prompt'))
      ?.querySelector('button[aria-label="History.deleteRecordOnly"]');
    assert.ok(firstRowDelete);

    // Click delete while backend remove is still pending -> must disappear immediately!
    await act(async () => {
      firstRowDelete.click();
    });
    assert.equal(rows().length, 1, 'row must be optimistically removed before persistence finishes');
    assert.equal(dom.window.document.querySelector('[role="alertdialog"], [role="dialog"]'), null, 'no modal confirmation on single-row delete');

    const toasts = getNimiToastSnapshot();
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].action?.label, 'Common.undo');

    // Click Undo while backend remove is still in-flight -> restores optimistically, then persists after remove settles!
    await act(async () => {
      toasts[0].action.onClick();
    });
    assert.equal(rows().length, 2, 'Undo immediately restores row');

    await act(async () => {
      pendingRemove.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(appended, ['run-2'], 'Undo re-persists removed record after pending delete settles');
    assert.equal(persisted.some((item) => item.id === 'run-2'), true);
    assert.equal(rows().length, 2);
  } finally {
    await act(async () => reactRoot.unmount());
    nimiToast.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('accepted Undo still persists restore even if the workspace unmounts before pending remove settles', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const mod = await import(pathToFileURL(path.join(buildDir, 'bundle.mjs')).href);
  const { createRoot } = await import('react-dom/client');
  const { getNimiToastSnapshot, nimiToast } = await import('@nimiplatform/kit/ui');
  nimiToast.clear();

  let persisted = [
    makeRecord('run-1', 'First prompt', '2026-10-09T02:00:00Z'),
    makeRecord('run-2', 'Second prompt', '2026-10-09T03:00:00Z'),
  ];
  const pendingRemove = deferred();
  const appended = [];
  const repository = {
    async load() {
      return { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] };
    },
    async persist() { throw new Error('unused'); },
    async appendRecord(record) {
      appended.push(record.id);
      persisted = [record, ...persisted.filter((item) => item.id !== record.id)];
      return { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] };
    },
    async cleanupArtifacts() { return { failures: [], remainingCleanupPaths: [] }; },
    async remove(recordId) {
      await pendingRemove.promise;
      persisted = persisted.filter((item) => item.id !== recordId);
      return {
        completed: 1,
        skipped: 0,
        failed: 0,
        projection: { runHistory: mod.studioHistoryFromRecords(persisted), mediaHistory: [] },
        issues: [],
      };
    },
    async clear() { throw new Error('unused'); },
    async nextIdentity() { return { runId: 'next', createdAt: '2026-10-09T04:00:00Z' }; },
    loadPanelPreferences: () => ({ collapsed: false, scope: 'capability', hideFailures: false }),
    savePanelPreferences: () => {},
  };

  const host = {
    appTitle: 'Nimi Lab',
    translate: (key) => key,
    locale: 'en',
    clock: { now: () => Date.parse('2026-10-09T04:00:00Z') },
    app: {
      projection: {
        runStatusLabel: (status) => status,
        assetExportAction: () => 'reveal',
        promptDraft: async () => ({ prompt: null }),
        projectRunTarget: () => ({}),
      },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: {
        savePromptDraft: async () => {},
        copyText: async () => ({ ok: true }),
        exportText: async () => ({ ok: false }),
        exportAsset: async () => {},
      },
    },
    sdk: {
      aiConfig: {},
      assets: {},
      listLocalAppVoiceAssets: async () => [],
      runCapability: async () => { throw new Error('unused'); },
    },
  };

  function Harness() {
    const controller = mod.useAIStudioWorkspaceController({
      historyRepository: repository,
      registrations: [],
      onSelectCapability: () => {},
      translate: (key) => key,
    });
    return React.createElement(
      mod.AIStudioHostProvider,
      { value: host },
      React.createElement(
        mod.StudioHistoryLoadContext.Provider,
        { value: controller.historyLoadState },
        React.createElement(
          mod.StudioHistoryActionsContext.Provider,
          { value: controller.historyActions },
          React.createElement(
            mod.StudioHistoryPanelContext.Provider,
            { value: controller.historyPanelState },
            React.createElement(mod.CapabilityRunHistory, {
              history: controller.history,
              activeRunId: null,
              onSelectRun: () => {},
              collapsed: false,
              currentCapabilityId: 'text.generate',
              registrations: [],
            }),
          ),
        ),
      ),
    );
  }

  const reactRoot = createRoot(dom.window.document.getElementById('root'));
  try {
    await act(async () => {
      reactRoot.render(React.createElement(Harness));
    });
    const rows = () => [...dom.window.document.querySelectorAll('.studio-recent__rows > li')];
    const deleteBtn = rows().find((row) => row.textContent.includes('Second prompt'))
      ?.querySelector('button[aria-label="History.deleteRecordOnly"]');
    assert.ok(deleteBtn);

    await act(async () => { deleteBtn.click(); });
    const toast = getNimiToastSnapshot()[0];
    assert.ok(toast?.action);

    // Click Undo, then immediately unmount workspace BEFORE backend remove settles!
    await act(async () => { toast.action.onClick(); });
    assert.equal(rows().length, 2, 'row optimistically restored before unmount');

    await act(async () => { reactRoot.unmount(); });

    // Now the slow remove settles after unmount — accepted Undo must STILL commit restore!
    pendingRemove.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(appended, ['run-2'], 'accepted Undo must complete appendRecord even after unmount');
    assert.deepEqual(persisted.map((item) => item.id).sort(), ['run-1', 'run-2']);
  } finally {
    nimiToast.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
