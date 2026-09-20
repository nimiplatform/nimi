import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { NimiAIConfigCloudTargetOption } from '@nimiplatform/sdk/ai';
import type { NimiDesktopPortableAIProfileCatalogRecord } from '@nimiplatform/sdk/runtime';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { RuntimeSetupRunnerPorts } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner.js';
import { createRuntimeSetupTaskStore, useRuntimeSetupTasks } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

async function withRenderer(run: (ui: {
  document: Document;
  render: (element: React.ReactElement, sdk?: unknown) => Promise<void>;
  click: (selector: string) => Promise<void>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const testI18n = createInstance();
  await testI18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await run({
      document: dom.window.document,
      render: async (element, sdk = {}) => {
        const bindings = { app: { commands: {} }, sdk } as DesktopCanonicalRendererBindings;
        await act(async () => root.render(<I18nextProvider i18n={testI18n}><DesktopRendererBindingProvider bindings={bindings}>{element}</DesktopRendererBindingProvider></I18nextProvider>));
      },
      click: async (selector) => {
        const element = dom.window.document.querySelector<HTMLElement>(selector);
        assert.ok(element, `missing ${selector}`);
        await act(async () => element.click());
      },
    });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('transfer recovery exposes only advertised actions and reports rejected commands', async () => {
  await withRenderer(async (ui) => {
    const { TransferRecoveryControls } = await import('../src/shell/renderer/features/runtime-config/model-transfer-recovery-actions.js');
    const calls: string[] = [];
    const event = { availableActions: ['check_sync', 'view_related_transfer', 'reimport'] as const, relatedInstallSessionId: 'specific-owner' };
    const onAction = async (action: string) => { calls.push(action); if (action === 'check_sync') throw Error('owner unavailable'); };
    await ui.render(<TransferRecoveryControls event={{ ...event, availableActions: [...event.availableActions] }} onAction={onAction} />);
    await ui.click('[data-transfer-recovery="check_sync"]');
    assert.match(ui.document.body.textContent ?? '', /owner unavailable/);
    await ui.click('[data-transfer-recovery="view_related_transfer"]');
    await ui.click('[data-transfer-recovery="import_file"]');
    await ui.click('[data-transfer-recovery="import_directory"]');
    assert.deepEqual(calls, ['check_sync', 'view_related_transfer', 'import_file', 'import_directory']);
    await ui.render(<TransferRecoveryControls event={{ availableActions: ['check_sync'] }} disabled onAction={onAction} />);
    assert.equal(ui.document.querySelector('[data-transfer-recovery="view_related_transfer"]'), null);
    assert.equal(ui.document.querySelector('[data-transfer-recovery="import_file"]'), null);
    await ui.click('[data-transfer-recovery="check_sync"]');
    assert.equal(calls.length, 4);
  });
});

test('import previews and retries library save without any machine operation, then offers use', async () => {
  await withRenderer(async (ui) => {
    const { ProfileImportWizard } = await import('../src/shell/renderer/features/runtime-config/runtime-config-profile-import-wizard.js');
    const source = { profileId: 'shared.example', title: 'Shared example', capabilities: { 'text.generate': { route: 'local', requiredFeatures: [] } } };
    const record = { source, artifactJson: JSON.stringify(source), record: {} } as NimiDesktopPortableAIProfileCatalogRecord;
    let attempts = 0;
    let changed = 0;
    let used: NimiDesktopPortableAIProfileCatalogRecord | undefined;
    const sdk = new Proxy({}, {
      get: (_target, key) => {
        assert.equal(key, 'accountProduct', 'import must not access machine APIs');
        return () => ({ profiles: { import: async (profile: unknown) => {
          attempts += 1;
          assert.deepEqual(profile, source);
          if (attempts === 1) throw new Error('library unavailable');
          return record;
        } } });
      },
    });
    await ui.render(<ProfileImportWizard initialSourceText={JSON.stringify(source)} onClose={() => {}} onCatalogChanged={() => { changed += 1; }} onUseImported={(value) => { used = value; }} />, sdk);
    assert.ok(ui.document.querySelector('[data-testid="runtime-profile-import-summary"]'));
    assert.equal(attempts, 0);
    await ui.click('[data-testid="runtime-profile-import-save"]');
    assert.match(ui.document.body.textContent ?? '', /could not be imported/);
    assert.equal(changed, 0);
    assert.equal(used, undefined);
    await ui.click('[data-testid="runtime-profile-import-save"]');
    assert.ok(ui.document.querySelector('[data-testid="runtime-profile-import-success"]'));
    assert.equal(changed, 1);
    assert.equal(used, undefined);
    await ui.click('[data-testid="runtime-profile-import-use"]');
    assert.equal(used, record);
  });
});

test('cloud recommendation waits for a connection, prefills exact identity and preserves a manual replacement', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeSetupTaskCloudPanel, matchesRuntimeSetupCloudRecommendation } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-cloud.js');
    const store = createRuntimeSetupTaskStore({ storage: null });
    const recommendation = { implementation: { implementationId: 'cloud.text', driverId: 'driver.text', driverDialect: 'text/v1' }, providerModelTarget: { provider: 'example', providerModelId: 'shared-model' } };
    const task = store.createTask({ capabilityContract: 'text.generate', source: { kind: 'app', ownerAppId: 'chat', accountId: 'acct' } });
    store.updateTask(task.taskId, () => ({ draft: { route: 'cloud', cloudRecommendation: recommendation } }));
    const targets = [
      { connectorRef: 'connection-1', label: 'Recommended model', state: 'ready', reasons: [], implementation: recommendation.implementation, providerModelTarget: { providerModelId: 'shared-model', provider: 'example' } },
      { connectorRef: 'connection-1', label: 'Another model', state: 'ready', reasons: [], implementation: recommendation.implementation, providerModelTarget: { provider: 'example', providerModelId: 'alternative' } },
    ] as NimiAIConfigCloudTargetOption[];
    assert.equal(matchesRuntimeSetupCloudRecommendation(targets[0]!, recommendation), true, 'JSON object order is not target identity');
    assert.equal(matchesRuntimeSetupCloudRecommendation({ ...targets[0]!, implementation: { ...recommendation.implementation, driverDialect: 'text/v2' } }, recommendation), false);
    let targetQueries = 0;
    const owner = {
      listOptions: async (query: { kind: string }) => {
        if (query.kind === 'cloud-connectors') return { kind: 'cloud-connectors', options: [{ connectorRef: 'connection-1', label: 'My connection', provider: 'example', state: 'ready', reasons: [] }] };
        targetQueries += 1;
        return { kind: 'cloud-targets', options: [...targets, targets[1]!] };
      },
    };
    const ports = { aiConfigForSource: () => owner } as unknown as RuntimeSetupRunnerPorts;
    function Panel() {
      const snapshot = useRuntimeSetupTasks(store);
      return <RuntimeSetupTaskCloudPanel task={snapshot.tasks[0]!} store={store} ports={ports} onBusyChange={() => {}} />;
    }
    await ui.render(<Panel />);
    assert.equal(targetQueries, 0);
    assert.equal(store.getTask(task.taskId)?.draft?.cloudConnectorRef, undefined);
    await ui.click('[data-testid="runtime-setup-cloud-connector:connection-1"] input');
    assert.equal(targetQueries, 1);
    assert.equal(ui.document.querySelectorAll('[data-testid^="runtime-setup-cloud-target:"]').length, 2, 'duplicate exact targets must not create duplicate React keys');
    assert.equal(ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-setup-cloud-target:Recommended model"] input')?.checked, true);
    await ui.click('[data-testid="runtime-setup-cloud-target:Another model"] input');
    assert.equal(ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-setup-cloud-target:Another model"] input')?.checked, true);
    assert.match(ui.document.body.textContent ?? '', /instead of the shared recommendation/);
    // An unrelated task update re-renders the panel without replacing the choice.
    await act(async () => { store.updateTask(task.taskId, () => ({ nextAction: 'choose-model' })); });
    assert.equal(ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-setup-cloud-target:Another model"] input')?.checked, true);
    assert.equal(store.getTask(task.taskId)?.draft?.cloudTargetLabel, 'Another model');
    const search = ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-setup-cloud-search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(ui.document.defaultView!.HTMLInputElement.prototype, 'value')!.set!.call(search, 'no-such-model');
      search.dispatchEvent(new ui.document.defaultView!.Event('input', { bubbles: true }));
    });
    assert.equal(ui.document.querySelectorAll('[data-testid^="runtime-setup-cloud-target:"]').length, 0);
    assert.match(ui.document.body.textContent ?? '', /No matching models/);
    assert.match(ui.document.querySelector('[data-testid="runtime-setup-cloud-selected"]')?.textContent ?? '', /Another model/);
    targets[1] = { ...targets[1]!, providerModelTarget: { providerModelId: 'alternative', provider: 'example' } };
    await ui.render(<Panel key="reopen" />);
    assert.equal(ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-setup-cloud-target:Another model"] input')?.checked, true, 'reopening preserves the selected target when RPC object keys change order');
  });
});

test('model loading failure has an in-place retry and is distinct from an empty catalog', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const store = createRuntimeSetupTaskStore({ storage: null });
    const task = store.createTask({ capabilityContract: 'text.generate', source: { kind: 'runtime', accountId: 'acct' } });
    let attempts = 0;
    const ports = { loadouts: { listRecipes: async () => { attempts += 1; if (attempts === 1) throw new Error('Runtime disconnected'); return []; } } } as unknown as RuntimeSetupRunnerPorts;
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} onClose={() => {}} />);
    assert.match(ui.document.body.textContent ?? '', /Models could not be loaded/);
    assert.doesNotMatch(ui.document.body.textContent ?? '', /No models are available/);
    const retry = Array.from(ui.document.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    assert.ok(retry);
    await act(async () => retry.click());
    assert.equal(attempts, 2);
    assert.match(ui.document.body.textContent ?? '', /No models are available/);
    assert.doesNotMatch(ui.document.body.textContent ?? '', /Models could not be loaded/);
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-review"]')?.disabled, true);
  });
});
