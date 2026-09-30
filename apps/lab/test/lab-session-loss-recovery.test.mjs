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
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'KeyboardEvent', 'DocumentFragment', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
mkdirSync(path.join(root, '.tmp'), { recursive: true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'session-loss-recovery-'));
await build({
  stdin: {
    contents: `export { observeLabLocalAppSessionLoss, subscribeLabLocalAppSessionLoss } from './src/shell/auth/session-loss.ts';
      export { WorkbenchRuntimeGate } from './src/workbench-core/runtime-gate.tsx';`,
    resolveDir: root, loader: 'ts',
  },
  outfile: path.join(buildDir, 'session-loss.mjs'), bundle: true, packages: 'external',
  platform: 'node', format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'silent',
});
const { observeLabLocalAppSessionLoss, subscribeLabLocalAppSessionLoss, WorkbenchRuntimeGate } = await import(
  pathToFileURL(path.join(buildDir, 'session-loss.mjs')).href
);

test.after(async () => {
  dom.window.close();
  await rm(buildDir, { recursive: true, force: true });
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shellError = (reasonCode) => Object.assign(new Error(reasonCode), { reasonCode, details: { retryable: false } });

test('a lost technical session is reported without retrying the failed operation', async () => {
  const calls = [];
  const surface = {
    session: {
      status: async () => {
        calls.push('status');
        throw shellError('runtime-service-unavailable');
      },
    },
    ai: {
      text: {
        generateCandidate: async (input) => {
          calls.push(['generate', input]);
          throw shellError('runtime-unauthenticated');
        },
      },
    },
    aiConfig: {
      get: async () => {
        calls.push('get');
        throw shellError('ai-config-invalid');
      },
    },
    storage: { describe: () => 'synchronous' },
  };
  const observed = observeLabLocalAppSessionLoss(surface);
  assert.deepEqual(Object.keys(observed), Object.keys(surface));
  assert.deepEqual(Object.keys(observed.ai.text), ['generateCandidate']);
  // The status check is the recovery itself and is never observed.
  assert.equal(observed.session, surface.session);

  let losses = 0;
  const unsubscribe = subscribeLabLocalAppSessionLoss(() => { losses += 1; });
  try {
    const failure = observed.ai.text.generateCandidate({ prompt: 'keep once' });
    await assert.rejects(failure, (error) => error.reasonCode === 'runtime-unauthenticated');
    assert.equal(losses, 1);
    assert.deepEqual(calls, [['generate', { prompt: 'keep once' }]]);

    await assert.rejects(observed.aiConfig.get(), (error) => error.reasonCode === 'ai-config-invalid');
    await assert.rejects(observed.session.status(), (error) => error.reasonCode === 'runtime-service-unavailable');
    assert.equal(losses, 1);
    assert.equal(observed.storage.describe(), 'synchronous');
  } finally {
    unsubscribe();
  }
});

test('the runtime gate re-checks a lost session, keeps the ready App mounted and blocks only on a failed check', async () => {
  const outcomes = [{ status: 'ready' }];
  let checks = 0;
  let clears = 0;
  let revalidated = 0;
  let mounts = 0;
  let reportLoss = () => assert.fail('the gate did not subscribe to session loss');
  const resolve = async () => {
    checks += 1;
    return outcomes.shift() ?? { status: 'ready' };
  };
  const revalidate = (onLoss) => {
    reportLoss = onLoss;
    return () => { reportLoss = () => undefined; };
  };
  function App() {
    const [instance] = useState(() => { mounts += 1; return mounts; });
    return createElement('p', { id: 'app' }, `App instance ${instance}`);
  }
  const copy = {
    checking: 'Checking', setupRequired: 'Setup', signInRequired: 'Sign in', connectionRequired: 'Connect',
    retry: 'Check again', offlineTier: (tier) => `Tier ${tier}`, nextAction: (action) => action, technicalDetails: 'Details',
  };
  const container = document.getElementById('root');
  const view = createRoot(container);
  const text = () => container.textContent;
  try {
    await act(async () => {
      view.render(createElement(WorkbenchRuntimeGate, {
        appTitle: 'Lab', copy, resolve, clear: () => { clears += 1; }, toErrorMessage: String,
        revalidate, onRevalidated: () => { revalidated += 1; },
      }, createElement(App)));
      await flush();
    });
    assert.equal(text(), 'App instance 1');
    assert.equal(checks, 1);

    // Losses reported while one re-check runs share it; the App stays mounted.
    outcomes.push({ status: 'ready' });
    await act(async () => {
      reportLoss();
      reportLoss();
      await flush();
    });
    assert.equal(checks, 2);
    assert.equal(clears, 1);
    assert.equal(revalidated, 1);
    assert.equal(text(), 'App instance 1');

    // A failed re-check blocks the App with the typed posture.
    outcomes.push({ status: 'unavailable', body: 'Nimi Desktop could not reach its protected Runtime service.', signInRequired: false });
    await act(async () => {
      reportLoss();
      await flush();
    });
    assert.equal(checks, 3);
    assert.equal(document.getElementById('app'), null);
    assert.match(text(), /could not reach its protected Runtime service/u);

    // Checking again after the Runtime returns opens a fresh App instance.
    outcomes.push({ status: 'ready' });
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Check again');
    await act(async () => {
      retry.click();
      await flush();
    });
    assert.equal(checks, 4);
    assert.equal(text(), 'App instance 2');
    assert.equal(revalidated, 1);
  } finally {
    await act(async () => view.unmount());
  }
});
