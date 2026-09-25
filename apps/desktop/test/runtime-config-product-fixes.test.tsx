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
    HTMLFormElement: dom.window.HTMLFormElement, HTMLSelectElement: dom.window.HTMLSelectElement,
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
  await testI18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {
    runtimeConfig: { product: {
      downloadSize: 'runtimeConfig.product.downloadSize {{size}}',
      customization: { applyHintDownload: 'customization.applyHintDownload {{size}}' },
    } },
  } } } });
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
    // Overlay focus restoration is scheduled for the next task by Radix.
    await new Promise((resolve) => setTimeout(resolve, 0));
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

test('inline customization edits without writes, discards changes, and preserves edits after an apply failure', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeCapabilityCustomize } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-customize.js');
    const selected = {
      loadoutId: 'current', recipeId: 'recipe', revision: 'r1', options: { useMmap: true, contextSize: 4096 },
      modelAxes: [{ slotId: 'main.text', modelAssetId: 'asset-1', expectedContentId: 'content-1', displayLabel: 'Current' }],
    } as unknown as import('@nimiplatform/sdk/runtime').NimiMachineLoadout;
    const recipe = {
      recipeId: 'recipe', defaultOptions: { useMmap: false, contextSize: 2048 },
      slots: [
        { slotId: 'main.text', displayLabel: 'Main', presence: 'required', offers: [], recommendedContentIds: ['content-1'] },
        { slotId: 'companion.mmproj', displayLabel: 'Vision', presence: 'optional-conditional', offers: [], recommendedContentIds: [] },
      ],
    } as unknown as import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe;
    const submitted: import('../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js').RuntimeSetupTaskDraft[] = [];
    const render = (disabled = false) => ui.render(<RuntimeCapabilityCustomize
      selected={selected} recipe={recipe} assets={[]} catalog={[]} disabled={disabled}
      onApply={async (draft) => { submitted.push(draft); throw new Error('Runtime is unavailable'); }}
    />);
    await render();
    const apply = () => ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-customize-apply"]');
    assert.ok(ui.document.querySelector('[data-testid="capability-customize-version:main.text"]'), 'version selection is already visible');
    assert.ok(ui.document.querySelector('input[aria-label="contextSize"]'), 'typed parameters are already visible');
    assert.equal(ui.document.querySelector<HTMLDetailsElement>('[data-testid="capability-customize-options-json"]')?.open, false);
    assert.equal(apply(), null, 'nothing is offered for applying before an edit');
    assert.equal(submitted.length, 0);
    await ui.click('input[aria-label="useMmap"]');
    assert.equal(apply()?.disabled, false);
    assert.equal(submitted.length, 0, 'editing is not an apply');
    await ui.click('[data-testid="capability-customize-discard"]');
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[aria-label="useMmap"]')?.checked, true);
    assert.equal(apply(), null, 'discarding returns to the applied configuration');
    await ui.click('input[aria-label="useMmap"]');
    await ui.click('[data-testid="capability-customize-apply"]');
    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0]!.options, { useMmap: false, contextSize: 4096 });
    assert.deepEqual(submitted[0]!.axes, [{ slotId: 'main.text', modelAssetId: 'asset-1', expectedContentId: 'content-1' }]);
    assert.deepEqual(submitted[0]!.disabledOptionalSlots, ['companion.mmproj']);
    assert.match(ui.document.body.textContent ?? '', /Runtime is unavailable/);
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[aria-label="useMmap"]')?.checked, false);
    assert.equal(apply()?.disabled, false, 'failed applies remain retryable');
    assert.match(
      ui.document.querySelector('[data-testid="capability-customize-version:companion.mmproj"]')?.textContent ?? '',
      /customization\.notUsed/,
      'an optional model is chosen or left unused from its own version selector',
    );
    await render(true);
    assert.equal(apply()?.disabled, true);
    assert.equal(ui.document.querySelector('fieldset')?.disabled, true);
  });
});

test('customization enables an optional model from its version selector and explains the download before applying', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeCapabilityCustomize } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-customize.js');
    // jsdom has no layout or scrolling implementation.
    ui.document.defaultView!.HTMLElement.prototype.scrollIntoView = () => {};
    const selected = {
      loadoutId: 'current', recipeId: 'recipe', revision: 'r1', options: {},
      modelAxes: [{ slotId: 'main.gguf', modelAssetId: 'asset-1', expectedContentId: 'content-1', displayLabel: 'Current' }],
    } as unknown as import('@nimiplatform/sdk/runtime').NimiMachineLoadout;
    const recipe = {
      recipeId: 'recipe', capabilityContract: 'text.generate', defaultOptions: {},
      slots: [
        { slotId: 'main.gguf', displayLabel: 'Main', presence: 'required', offers: [], recommendedContentIds: ['content-1'], conditionalFeatures: [] },
        {
          slotId: 'companion.mmproj', displayLabel: 'Vision', presence: 'optional-conditional', recommendedContentIds: [], conditionalFeatures: ['input.image'],
          offers: [{ candidate: { offerRef: 'mmproj-f16', title: 'Example 2B (F16)', variantLabel: 'mmproj-F16.gguf', installable: true, totalSizeBytes: 985654080, downloadSizeBytes: 524288000 }, applicability: 'supported' }],
        },
      ],
    } as unknown as import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe;
    const submitted: import('../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js').RuntimeSetupTaskDraft[] = [];
    await ui.render(<RuntimeCapabilityCustomize
      selected={selected} recipe={recipe} assets={[]} catalog={[]} disabled={false}
      onApply={async (draft) => { submitted.push(draft); }}
    />);
    const text = () => ui.document.body.textContent ?? '';
    assert.match(text(), /customization\.slotHelp\.inputImage/, 'the optional model says what it adds');
    assert.match(text(), /customization\.optionsDefault/);
    const trigger = ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-customize-version:companion.mmproj"]')!;
    await act(async () => {
      trigger.dispatchEvent(new ui.document.defaultView!.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const choice = [...ui.document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('Example 2B · F16'));
    assert.ok(choice, 'versions are named by model and exact quantization');
    assert.match(choice.textContent ?? '', /downloadSize 500\.0 MB/, 'transfer size is distinct from installed disk usage');
    await act(async () => choice.click());
    assert.match(ui.document.querySelector('[data-testid="capability-customize-apply-bar"]')?.textContent ?? '', /customization\.applyHintDownload 500\.0 MB/);
    assert.equal(submitted.length, 0, 'choosing a download is not an apply');

    const unknownSizeRecipe = {
      ...recipe,
      slots: recipe.slots.map((slot) => ({
        ...slot,
        offers: slot.offers.map((offer) => ({ ...offer, candidate: { ...offer.candidate, downloadSizeBytes: undefined } })),
      })),
    };
    await ui.render(<RuntimeCapabilityCustomize
      selected={selected} recipe={unknownSizeRecipe} assets={[]} catalog={[]} disabled={false}
      onApply={async (draft) => { submitted.push(draft); }}
    />);
    assert.match(ui.document.querySelector('[data-testid="capability-customize-slot:companion.mmproj"]')?.textContent ?? '', /downloadSizeUnknown/);
    assert.match(ui.document.querySelector('[data-testid="capability-customize-apply-bar"]')?.textContent ?? '', /customization\.applyHintDownloadUnknown/);

    const textarea = ui.document.querySelector<HTMLTextAreaElement>('[data-testid="capability-customize-options-json"] textarea')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(ui.document.defaultView!.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new ui.document.defaultView!.Event('input', { bubbles: true }));
    });
    await type('{ "contextSize": ');
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-customize-apply"]')?.disabled, true, 'invalid options cannot be applied');
    assert.match(text(), /customization\.applyInvalid/);
    await type('{ "contextSize": 8192 }');
    assert.match(text(), /customization\.optionsCustomized/);
    await ui.click('[data-testid="capability-customize-apply"]');
    assert.equal(submitted.length, 1);
    assert.deepEqual(submitted[0]!.preferredOffers, { 'companion.mmproj': 'mmproj-f16' });
    assert.deepEqual(submitted[0]!.disabledOptionalSlots, []);
    assert.deepEqual(submitted[0]!.options, { contextSize: 8192 });
    assert.deepEqual(submitted[0]!.axes, [{ slotId: 'main.gguf', modelAssetId: 'asset-1', expectedContentId: 'content-1' }]);
  });
});

test('customization keeps exact variant names and refuses offers that Runtime cannot install', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeLoadoutOptionsEditor } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-advanced.js');
    const offer = (variant: string, installable = true, applicability = 'supported') => ({
      candidate: { offerRef: variant, title: `Example 2B (${variant})`, variantLabel: `example-${variant}.gguf`, installable },
      applicability,
    });
    const recipe = {
      recipeId: 'recipe', defaultOptions: {}, slots: [{
        slotId: 'main.text', displayLabel: 'Main', presence: 'required', recommendedContentIds: [],
        offers: [offer('Q4_K_M'), offer('Q4_0'), offer('F16', false), offer('Q8_0', true, 'unsupported')],
      }],
    } as unknown as import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe;
    const patches: Partial<import('../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js').RuntimeSetupTaskDraft>[] = [];
    // jsdom has no layout or scrolling implementation.
    ui.document.defaultView!.HTMLElement.prototype.scrollIntoView = () => {};
    await ui.render(<RuntimeLoadoutOptionsEditor recipe={recipe} candidate={null} assets={[]} verifiedAssets={[]} onChange={(patch) => patches.push(patch)} />);
    const trigger = ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-advanced-version:main.text"]')!;
    await act(async () => {
      trigger.dispatchEvent(new ui.document.defaultView!.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const options = [...ui.document.querySelectorAll<HTMLElement>('[role="option"]')];
    const unavailable = options.find((option) => option.textContent?.includes('F16'));
    assert.ok(unavailable);
    assert.equal(unavailable.getAttribute('aria-disabled'), 'true', 'host support does not imply installability');
    await act(async () => unavailable.click());
    assert.equal(patches.length, 0);
    assert.equal(options.find((option) => option.textContent?.includes('Q8'))?.getAttribute('aria-disabled'), 'true');
    const exactVariant = options.find((option) => option.textContent?.includes('Q4_K_M'));
    assert.ok(exactVariant, 'the selector must distinguish exact Q4 variants');
    assert.ok(options.some((option) => option.textContent?.includes('Q4_0')));
    await act(async () => exactVariant.click());
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0]?.preferredOffers, { 'main.text': 'Q4_K_M' });
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
    assert.equal(ui.document.activeElement?.getAttribute('data-testid'), 'runtime-profile-import-use');
    assert.equal(changed, 1);
    assert.equal(used, undefined);
    await ui.click('[data-testid="runtime-profile-import-use"]');
    assert.equal(used, record);
  });
});

test('import reads a dropped, chosen or pasted setup into a preview and changes the source without saving', async () => {
  await withRenderer(async (ui) => {
    const { ProfileImportWizard } = await import('../src/shell/renderer/features/runtime-config/runtime-config-profile-import-wizard.js');
    const win = ui.document.defaultView!;
    const source = {
      profileId: 'shared.office',
      title: 'Office setup',
      capabilities: {
        'audio.synthesize': {
          route: 'cloud', requiredFeatures: [],
          implementation: { implementationId: 'cloud.speech', driverId: 'driver.speech', driverDialect: 'speech/v1', supportedFeatures: [] },
          providerModelTarget: { provider: 'example', providerModelId: 'voice-1', remoteModelCatalogId: 'catalog.voice-1' },
        },
        'text.generate': { route: 'local', requiredFeatures: [] },
      },
    };
    const sdk = new Proxy({}, {
      get: (_target, key) => {
        assert.equal(key, 'accountProduct', 'import must not access machine APIs');
        return () => ({ profiles: { import: async () => assert.fail('previewing never saves') } });
      },
    });
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const summaryText = () => ui.document.querySelector('[data-testid="runtime-profile-import-summary"]')?.textContent ?? '';
    const type = async (value: string) => {
      const textarea = ui.document.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
        textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
    };
    await ui.render(<ProfileImportWizard initialSourceText={null} onClose={() => {}} onCatalogChanged={() => {}} />, sdk);
    assert.ok(ui.document.querySelector('[data-testid="runtime-profile-import-file"]'), 'choosing a file is the main action');
    assert.equal(ui.document.querySelector('textarea'), null, 'pasting waits behind its own entry');

    const drop = new win.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new win.File([JSON.stringify(source)], 'office.ai-profile.json')] } });
    await act(async () => { ui.document.querySelector('[data-testid="runtime-profile-import-drop"]')!.dispatchEvent(drop); });
    await settle();
    assert.match(summaryText(), /office\.ai-profile\.json/);
    assert.match(summaryText(), /Includes 2/);
    const rows = [...ui.document.querySelectorAll('[data-testid="runtime-profile-import-summary"] li')].map((row) => row.textContent ?? '');
    assert.equal(rows.length, 2);
    assert.match(rows[0]!, /textGenerate.*On this device/, 'uses follow the capability rail order, not file key order');
    assert.match(rows[1]!, /audioSynthesize.*Cloud service/);
    const focused = () => ui.document.activeElement?.getAttribute('data-testid') ?? ui.document.activeElement?.tagName;
    assert.equal(focused(), 'runtime-profile-import-save', 'each step hands focus to its next action');

    await ui.click('[data-testid="runtime-profile-import-change"]');
    assert.ok(ui.document.querySelector('[data-testid="runtime-profile-import-drop"]'), 'a file source returns to choosing a file');
    assert.equal(focused(), 'runtime-profile-import-file');
    const input = ui.document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new win.File([JSON.stringify({ ...source, title: 'Chosen' })], 'chosen.json')] });
    await act(async () => { input.dispatchEvent(new win.Event('change', { bubbles: true })); });
    await settle();
    assert.match(summaryText(), /chosen\.json/);
    assert.equal(ui.document.querySelector<HTMLInputElement>('[data-testid="runtime-profile-import-summary"] input')?.value, 'Chosen');

    await ui.click('[data-testid="runtime-profile-import-change"]');
    await ui.click('[data-testid="runtime-profile-import-paste-toggle"]');
    assert.equal(focused(), 'TEXTAREA');
    await type('not a setup');
    await ui.click('[data-testid="runtime-profile-import-preview"]');
    assert.match(ui.document.body.textContent ?? '', /could not be imported/);
    assert.equal(summaryText(), '');
    await type(JSON.stringify(source));
    await ui.click('[data-testid="runtime-profile-import-preview"]');
    assert.match(summaryText(), /Pasted setup/);
    await ui.click('[data-testid="runtime-profile-import-change"]');
    assert.equal(ui.document.querySelector('textarea')?.value, JSON.stringify(source), 'pasted text stays editable');
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
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-task-review"]'), null);
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-task-prepare-and-use"]'), null);
  });
});

function setupReviewFixture(recipeCount = 1) {
  const store = createRuntimeSetupTaskStore({ storage: null });
  const task = store.createTask({ capabilityContract: 'text.generate', source: { kind: 'runtime', accountId: 'acct' } });
  const recipes = Array.from({ length: recipeCount }, (_, index) => ({
    recipeId: `recipe-${index}`, title: `Model ${index}`, capabilityContract: 'text.generate',
    defaultOptions: { contextSize: 4096 }, applicability: 'supported', slots: [],
  }));
  let candidate: unknown;
  let proposed: Record<string, unknown>;
  const writes: string[] = [];
  const ports = {
    loadouts: {
      listRecipes: async () => recipes,
      get: async () => ({ loadouts: candidate ? [candidate] : [], selections: [], selectionRevisions: {} }),
      prepare: async (input: Record<string, unknown>) => { writes.push('prepare'); proposed = input; return { prepareId: 'proposal' }; },
      commit: async () => { writes.push('commit-candidate'); candidate = { ...proposed, loadoutId: 'candidate', revision: 'r1' }; return { loadoutId: 'candidate', revision: 'r1' }; },
      select: async () => { writes.push('select'); throw new Error('Unexpected selection before confirmation'); },
    },
    environment: { resolveEnvironmentPlan: async () => ({ planId: 'environment', dependencies: [] }) },
    install: { install: async () => { writes.push('download'); throw new Error('Unexpected download before confirmation'); } },
    aiConfigForSource: () => null,
    account: { currentAccountId: () => 'acct' },
    now: () => '2026-09-24T00:00:00Z',
  } as unknown as RuntimeSetupRunnerPorts;
  return { store, task, ports, writes };
}

test('one supported recipe opens a review in place without selecting or downloading, even when ready', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { store, task, ports, writes } = setupReviewFixture();
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} embedded onClose={() => {}} />);
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-task-recipes"]'), null);
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-hero-title"]'), null);
    assert.ok(ui.document.querySelector('[data-testid="runtime-setup-review-impact"]'));
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-prepare-and-use"]')?.disabled, false);
    await ui.click('button[data-testid="runtime-setup-task-advanced"]');
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-prepare-and-use"]')?.disabled, true);
    await ui.click('button[data-testid="runtime-setup-task-advanced"]');
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-prepare-and-use"]')?.disabled, false);
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
  });
});

test('an unavailable managed environment keeps the embedded confirmation disabled', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { createNimiError } = await import('@nimiplatform/sdk/types');
    const { store, task, ports, writes } = setupReviewFixture();
    const unavailablePorts = {
      ...ports,
      environment: { ...ports.environment, resolveEnvironmentPlan: async () => {
        throw createNimiError({ message: 'No managed environment', reasonCode: 'AI_LOADOUT_DRIVER_UNAVAILABLE', source: 'runtime' });
      } },
    };
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={unavailablePorts} embedded onClose={() => {}} />);
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.ok(ui.document.querySelector('[data-testid="runtime-setup-environment-unavailable"]'));
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-prepare-and-use"]')?.disabled, true);
    await ui.click('[data-testid="runtime-setup-task-prepare-and-use"]');
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
  });
});

test('a recipe without a download keeps imported-file choices in the draft until review', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { store, task, ports, writes } = setupReviewFixture();
    const recipe = (await ports.loadouts.listRecipes('text.generate'))[0]!;
    const importPorts = {
      ...ports,
      loadouts: { ...ports.loadouts, listRecipes: async () => [{ ...recipe, slots: [{
        slotId: 'main.gguf', displayLabel: 'Main model', presence: 'required', offers: [], reasons: [],
        recommendedContentIds: [], recommendedVariantIds: [],
      }] }] },
    } as unknown as RuntimeSetupRunnerPorts;
    const sdk = { localEnvironmentRpc: () => ({
      listModelAssets: async () => ({ assets: [], nextPageToken: '' }),
      listVerifiedAssets: async () => ({ assets: [], nextPageToken: '' }),
    }) };
    let imports = 0;
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={importPorts} embedded onClose={() => {}} onImportModelFiles={() => { imports += 1; }} />, sdk);
    assert.equal(store.getTask(task.taskId)?.status, 'draft');
    assert.equal(store.getTask(task.taskId)?.candidateLoadoutId, undefined);
    assert.deepEqual(writes, []);
    const panel = ui.document.querySelector('[data-testid="runtime-setup-imported-files"]')!;
    assert.ok(panel.querySelector('[data-testid="runtime-setup-task-advanced"]'));
    const importButton = Array.from(panel.querySelectorAll('button')).find(button => button.textContent === 'Import model files');
    assert.ok(importButton);
    await act(async () => importButton.click());
    assert.equal(imports, 1);
    assert.deepEqual(writes, []);
    await ui.click('[data-testid="runtime-setup-task-review"]');
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
    assert.ok(ui.document.querySelector('[data-testid="runtime-setup-unavailable"]'));
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-prepare-and-use"]')?.disabled, true);
  });
});

test('several recipes remain an explicit choice and each choice goes straight to review', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { store, task, ports, writes } = setupReviewFixture(2);
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} onClose={() => {}} />);
    assert.deepEqual(writes, []);
    assert.equal(ui.document.querySelectorAll('input[type="radio"]').length, 0);
    await ui.click('[data-testid="runtime-setup-task-recipe:recipe-1"] button');
    assert.equal(store.getTask(task.taskId)?.draft?.recipeId, 'recipe-1');
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
  });
});

test('missing-file recovery offers import and an explicit replacement review without automatic use', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { store, task, ports, writes } = setupReviewFixture();
    store.updateTask(task.taskId, () => ({
      status: 'failed', draft: { recipeId: 'recipe-0', axes: [{ slotId: 'main', modelAssetId: 'missing', expectedContentId: 'original' }] },
      failure: { stage: 'create-candidate', reasonCode: 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND', message: 'missing' },
    }));
    let imports = 0;
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} embedded onImportModelFiles={() => { imports += 1; }} onClose={() => {}} />);
    assert.deepEqual(writes, []);
    assert.match(ui.document.body.textContent ?? '', /Choose a model to repair setup/);
    await ui.click('[data-testid="runtime-setup-import-files"]');
    assert.equal(imports, 1);
    await ui.click('[data-testid="runtime-setup-task-retry"]');
    assert.equal(store.getTask(task.taskId)?.status, 'review');
    assert.equal(store.getTask(task.taskId)?.draft?.axes, undefined);
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
  });
});

test('read-only setup never auto-creates a candidate', async () => {
  await withRenderer(async ui => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const { store, task, ports, writes } = setupReviewFixture();
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} disabled onClose={() => {}} />);
    assert.equal(store.getTask(task.taskId)?.status, 'draft');
    assert.deepEqual(writes, []);
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-recipe:recipe-0"] button')?.disabled, true);
  });
});

test('changing a capability model stays in the overview, cancels without writes, and preserves the exact saved choice', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeCapabilityDetail } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-detail.js');
    const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
    const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
    const { TooltipProvider } = await import('@nimiplatform/kit/ui');
    const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
    const current = {
      loadoutId: 'current', recipeId: 'recipe-a', capabilityContract: 'text.generate',
      displayName: 'Current model', modelAxes: [], options: {}, validationState: 'configured',
    } as unknown as import('@nimiplatform/sdk/runtime').NimiMachineLoadout;
    const saved = { ...current, loadoutId: 'saved-version', displayName: 'My saved version', options: { contextSize: 4096 }, modelAxes: [{ slotId: 'main.text', modelAssetId: 'exact-file', expectedContentId: 'exact-content', displayLabel: 'Main' }] };
    const recipe = (recipeId: string, applicability = 'supported') => ({ recipeId, title: recipeId, capabilityContract: 'text.generate', implementationSupportedFeatures: [], slots: [], applicability }) as unknown as import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe;
    const navigation: string[] = [];
    const uses: unknown[][] = [];
    const props: React.ComponentProps<typeof RuntimeCapabilityDetail> = {
      capability: 'text.generate', selected: current, loadouts: [current, saved],
      recipes: [recipe('recipe-a'), recipe('recipe-b'), recipe('unsupported', 'unsupported')], catalog: [], assets: [],
      libraryLoading: false, libraryError: false, status: { state: 'ready', replacement: false }, taskModel: '',
      section: 'overview', onSection: (section) => navigation.push(section), busy: false, disabled: false, navigationContext: null,
      onHome: () => {}, onTask: () => {}, onDiagnostics: () => {}, onModelMarket: () => {},
      onStart: async () => { throw new Error('Opening the picker must not create a preparation task'); },
      onEnable: async (...args) => { uses.push(args); },
      onApplyCustomization: async () => {},
    };
    const render = async (overrides: Partial<typeof props> = {}) => ui.render(
      <AppStoreProvider store={appStore}><TooltipProvider><RuntimeCapabilityDetail {...props} {...overrides} /></TooltipProvider></AppStoreProvider>,
    );
    await render();
    const trigger = ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-change-model"]')!;
    trigger.focus();
    await ui.click('[data-testid="capability-change-model"]');
    assert.ok(ui.document.querySelector('[role="dialog"][data-testid="capability-model-picker"]'));
    assert.ok(ui.document.querySelector('[data-testid="capability-current-model"]'));
    assert.deepEqual(navigation, []);
    assert.deepEqual(uses, []);
    assert.ok(ui.document.querySelector('[data-testid="capability-model-picker-saved:saved-version"]'), 'another saved version of the current recipe stays directly selectable');
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-model-picker-recipe:unsupported"]')?.disabled, true);
    assert.match(ui.document.querySelector('[data-testid="capability-model-picker"]')?.textContent ?? '', /modelPicker\.switchNote/, 'a switch discloses its scope next to the choices');
    assert.equal(ui.document.querySelector('[data-testid="capability-model-picker-empty"]'), null);
    await ui.click('[data-testid="capability-model-picker-close"]');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(ui.document.querySelector('[data-testid="capability-model-picker"]'), null);
    assert.deepEqual(uses, []);
    assert.equal(ui.document.activeElement === trigger, true, 'closing restores focus to the change-model trigger');

    await ui.click('[data-testid="capability-change-model"]');
    await ui.click('[data-testid="capability-model-picker-saved:saved-version"]');
    assert.deepEqual(uses, [['recipe-a', saved]]);
    assert.equal(ui.document.querySelector('[data-testid="capability-model-picker"]'), null);
    assert.deepEqual(navigation, []);
    await ui.click('[data-testid="capability-change-model"]');
    await ui.click('[data-testid="capability-model-picker-recipe:recipe-b"]');
    assert.deepEqual(uses[1], ['recipe-b', undefined]);

    const imports: string[] = [];
    const onImportModelFiles = () => { imports.push('import'); };
    await render({ loadouts: [current], recipes: [recipe('recipe-a')], onImportModelFiles });
    await ui.click('[data-testid="capability-change-model"]');
    const empty = ui.document.querySelector('[data-testid="capability-model-picker-empty"]');
    assert.ok(empty);
    assert.ok(empty.querySelector('[data-testid="capability-model-picker-market"]'), 'with nothing to switch to, adding a model is the main content');
    assert.ok(empty.querySelector('[data-testid="capability-model-picker-import"]'));
    assert.equal(ui.document.querySelectorAll('[data-testid="capability-model-picker-market"]').length, 1, 'no second market entry in a footer');
    assert.doesNotMatch(ui.document.querySelector('[data-testid="capability-model-picker"]')?.textContent ?? '', /switchNote/, 'the scope note belongs to an actual switch');
    await render({ loadouts: [current], recipes: [], modelsError: true });
    assert.equal(ui.document.querySelector('[data-testid="capability-model-picker-empty"]'), null, 'a failed recipe query is not an empty inventory');
    await render({ disabled: true });
    assert.equal(ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-model-picker-saved:saved-version"]')?.disabled, true);
    await render({ recipes: [recipe('recipe-b')] });
    const unavailable = ui.document.querySelector<HTMLButtonElement>('[data-testid="capability-model-picker-saved:saved-version"]')!;
    assert.equal(unavailable.disabled, true);
    assert.match(unavailable.parentElement?.textContent ?? '', /preparationUnknown/);
    assert.doesNotMatch(unavailable.parentElement?.textContent ?? '', /hostFit\.unsupported/, 'a missing recipe is unknown, not evidence of incompatibility');

    await render({ loadouts: [current], recipes: [recipe('recipe-a')], onImportModelFiles });
    await ui.click('[data-testid="capability-model-picker-import"]');
    assert.deepEqual(imports, ['import']);
    assert.equal(ui.document.querySelector('[data-testid="capability-model-picker"]'), null);
    assert.deepEqual(uses, [['recipe-a', saved], ['recipe-b', undefined]], 'adding a model never switches the current one');
  });
});

test('the models tab offers import above a long model list without starting a setup', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeCapabilityDetail } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-detail.js');
    const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
    const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
    const { TooltipProvider } = await import('@nimiplatform/kit/ui');
    const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
    const recipes = Array.from({ length: 8 }, (_, index) => ({
      recipeId: `recipe-${index}`, title: `recipe-${index}`, capabilityContract: 'audio.transcribe',
      implementationSupportedFeatures: [], slots: [], applicability: 'supported',
    }) as unknown as import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe);
    const opened: string[] = [];
    const props: React.ComponentProps<typeof RuntimeCapabilityDetail> = {
      capability: 'audio.transcribe', loadouts: [], recipes, catalog: [], assets: [],
      libraryLoading: false, libraryError: false, status: { state: 'unset', replacement: false }, taskModel: '',
      section: 'models', onSection: () => {}, busy: false, disabled: false, navigationContext: null,
      onHome: () => {}, onTask: () => {}, onDiagnostics: () => {}, onModelMarket: () => {},
      onStart: async () => { throw new Error('Importing must not start a setup'); },
      onEnable: async () => { throw new Error('Importing must not enable a model'); },
      onApplyCustomization: async () => {},
      onModelFiles: () => { opened.push('files'); },
      onImportModelFiles: () => { opened.push('import'); },
    };
    const render = (overrides: Partial<typeof props> = {}) => ui.render(
      <AppStoreProvider store={appStore}><TooltipProvider><RuntimeCapabilityDetail {...props} {...overrides} /></TooltipProvider></AppStoreProvider>,
    );
    await render();
    const importButton = ui.document.querySelector('[data-testid="capability-models-import"]');
    const firstModel = ui.document.querySelector('[data-testid="capability-model:recipe-0"]');
    assert.ok(importButton && firstModel);
    assert.ok(importButton.compareDocumentPosition(firstModel) & Node.DOCUMENT_POSITION_FOLLOWING, 'import comes before the model list');
    assert.ok(ui.document.querySelector('input[aria-label="runtimeConfig.product.searchModels"]'), 'search and import share the header');
    const detailText = ui.document.querySelector('[data-testid="ai-capability-detail:audio.transcribe"]')?.textContent ?? '';
    assert.equal(detailText.match(/product\.importModel/g)?.length, 1, 'no second import entry below the list');
    await ui.click('[data-testid="capability-models-import"]');
    assert.deepEqual(opened, ['import'], 'the direct import entry opens the import menu');

    await render({ onImportModelFiles: undefined });
    await ui.click('[data-testid="capability-models-import"]');
    assert.deepEqual(opened, ['import', 'files']);

    await render({ onImportModelFiles: undefined, onModelFiles: undefined });
    assert.equal(ui.document.querySelector('[data-testid="capability-models-import"]'), null, 'no dead import button without a destination');
  });
});

test('a version choice opens on request, follows the picked version, and returns to the device recommendation', async () => {
  await withRenderer(async (ui) => {
    const { SetupTaskPlanReview } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const option = (quant: string, sizeBytes: number, recommended = false) => ({
      offerRef: `offer:${quant}`, title: `gemma-4-e2b-it-local (${quant})`, variantLabel: '', sizeBytes, recommended,
    });
    const plan = {
      reuse: [], acquire: [], unavailable: [], components: [], options: [],
      awaitingChoice: [{ slotId: 'main.gguf', label: 'Main model', options: [option('Q8_0', 5_048_350_848, true), option('Q4_K_M', 3_106_736_256)] }],
      environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
    };
    function Review() {
      const [choices, setChoices] = React.useState<Record<string, string>>({ 'main.gguf': 'offer:Q8_0' });
      return <SetupTaskPlanReview plan={plan} choices={choices} onChoiceChange={(slot, ref) => setChoices((previous) => ({ ...previous, [slot]: ref }))} />;
    }
    await ui.render(<Review />);
    const line = () => ui.document.querySelector('[data-testid="runtime-setup-task-choice:main.gguf"]')?.textContent ?? '';
    const restore = '[data-testid="runtime-setup-restore-recommendation:main.gguf"]';
    assert.match(line(), /Gemma 4 2B · Q8/);
    assert.match(line(), /Recommended for this device/);
    assert.equal(ui.document.querySelectorAll('input[type="radio"]').length, 0, 'the versions stay closed while the recommendation is selected');

    await ui.click('[data-testid="runtime-setup-task-choice-toggle:main.gguf"]');
    const radios = Array.from(ui.document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    assert.equal(radios.length, 2);
    assert.equal(ui.document.querySelector(restore), null);
    await act(async () => radios[0]!.click());
    assert.match(line(), /Gemma 4 2B · Q4/);
    assert.doesNotMatch(line(), /Recommended for this device/);

    await ui.click(restore);
    assert.match(line(), /Gemma 4 2B · Q8/);
    assert.equal(ui.document.querySelector(restore), null);
  });
});

test('inside the capability card the review leads with the model and keeps both confirmations in view', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeConfigSetupTaskView } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view.js');
    const store = createRuntimeSetupTaskStore({ storage: null });
    const task = store.createTask({ capabilityContract: 'text.generate', source: { kind: 'runtime', accountId: 'acct' } });
    const offer = (quant: string, totalSizeBytes: number) => ({
      candidate: { offerRef: `offer:${quant}`, title: `gemma-4-e2b-it-local (${quant})`, variantLabel: '', installable: true, totalSizeBytes, downloadSizeBytes: totalSizeBytes, author: 'model-publisher', license: 'Apache-2.0' },
      applicability: 'supported', installedModelAssetId: '',
    });
    const recipe = {
      recipeId: 'gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate', defaultOptions: {}, applicability: 'supported',
      slots: [{ slotId: 'main.gguf', displayLabel: 'Main model', presence: 'required', recommendedVariantIds: ['template:q8'], recommendedContentIds: [], offers: [offer('Q8_0', 5_048_350_848), offer('Q4_K_M', 3_106_736_256)] }],
    };
    let candidate: unknown;
    let proposed: Record<string, unknown>;
    const writes: string[] = [];
    const ports = {
      loadouts: {
        listRecipes: async () => [recipe],
        get: async () => ({ loadouts: candidate ? [candidate] : [], selections: [], selectionRevisions: {} }),
        prepare: async (input: Record<string, unknown>) => { writes.push('prepare'); proposed = input; return { prepareId: 'proposal' }; },
        commit: async () => { writes.push('commit-candidate'); candidate = { ...proposed, loadoutId: 'candidate', revision: 'r1' }; return { loadoutId: 'candidate', revision: 'r1' }; },
      },
      environment: { resolveEnvironmentPlan: async () => ({ planId: 'environment', dependencies: [] }) },
      install: {
        resolveOfferInstallPlan: async (offerRef: string) => ({ templateId: offerRef === 'offer:Q8_0' ? 'template:q8' : 'template:other', installAvailable: true }),
        install: async () => { writes.push('download'); throw new Error('Unexpected download before confirmation'); },
      },
      aiConfigForSource: () => null,
      account: { currentAccountId: () => 'acct' },
      now: () => '2026-09-24T00:00:00Z',
    } as unknown as RuntimeSetupRunnerPorts;
    let closed = 0;
    await ui.render(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={ports} embedded onClose={() => { closed += 1; }} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(store.getTask(task.taskId)?.status, 'review');

    // The recommended version names the card, with its size and the version choice beside it.
    const plan = ui.document.querySelector('[data-testid="runtime-setup-task-plan"]')!;
    assert.equal(plan.querySelector('h2')?.textContent, 'Gemma 4 2B · Q8');
    assert.match(plan.textContent ?? '', /Recommended for this device[\s\S]*4\.70 GB[\s\S]*Change version/);
    assert.match(plan.querySelector('[data-testid="runtime-setup-offer-terms:main.gguf"]')?.textContent ?? '', /model-publisher.*Apache-2\.0/);
    assert.ok(plan.querySelector('[data-testid="runtime-setup-download-scope"]'));
    assert.equal(ui.document.querySelector('dl'), null, 'a single model file needs no summary rows');
    assert.doesNotMatch(plan.innerHTML, /--nimi-surface-card/, 'no second card inside the capability card');

    // Both confirmations are in view; nothing hides behind a "More actions" disclosure.
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-task-prepare-and-use"]')?.textContent, 'Download and use · 4.70 GB');
    assert.equal(ui.document.querySelector('[data-testid="runtime-setup-task-prepare-only"]')?.textContent, 'Download only, don’t switch');
    assert.equal(ui.document.querySelector('details'), null);

    // Closing is an icon control with its name, and leaving the unconfirmed setup writes nothing more.
    const close = ui.document.querySelector<HTMLButtonElement>('[data-testid="runtime-setup-task-close"]')!;
    assert.equal(close.getAttribute('aria-label'), 'Close setup');
    await ui.click('[data-testid="runtime-setup-task-close"]');
    assert.equal(closed, 1);
    assert.deepEqual(writes, ['prepare', 'commit-candidate']);
  });
});

test('model cards read Runtime offers and the main Select reuses a single saved configuration', async () => {
  await withRenderer(async (ui) => {
    const { RuntimeCapabilityDetail } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-detail.js');
    const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
    const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
    const { TooltipProvider } = await import('@nimiplatform/kit/ui');
    type Recipe = import('@nimiplatform/sdk/runtime').NimiLoadoutRecipe;
    type Loadout = import('@nimiplatform/sdk/runtime').NimiMachineLoadout;
    const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
    const offer = (offerRef: string, extra: Record<string, unknown> = {}) => ({
      applicability: 'supported', reasons: [],
      candidate: { offerRef, title: offerRef, installable: true, totalSizeBytes: 56524490, downloadSizeBytes: 33480380, ...extra },
    });
    const recipe = (recipeId: string, offers: unknown[]) => ({
      recipeId, title: recipeId, capabilityContract: 'text.annotate', implementationSupportedFeatures: [], applicability: 'supported',
      slots: [{ slotId: 'text.model', presence: 'required', recommendedContentIds: [], recommendedVariantIds: [], offers }],
    }) as unknown as Recipe;
    const saved = (loadoutId: string, recipeId: string) => ({
      loadoutId, recipeId, capabilityContract: 'text.annotate', displayName: loadoutId, options: {}, validationState: 'configured',
      modelAxes: [{ slotId: 'text.model', modelAssetId: `${loadoutId}-asset`, expectedContentId: 'content' }],
    }) as unknown as Loadout;
    const english = saved('english-saved', 'spacy-md-en');
    const starts: unknown[][] = [];
    const chosenImports: string[] = [];
    let imports = 0;
    const props: React.ComponentProps<typeof RuntimeCapabilityDetail> = {
      capability: 'text.annotate', loadouts: [english, saved('it-a', 'spacy-md-it'), saved('it-b', 'spacy-md-it')],
      recipes: [
        recipe('spacy-md-en', [offer('offer-en')]),
        recipe('spacy-md-de', [offer('offer-de')]),
        recipe('spacy-md-it', [offer('offer-it')]),
        recipe('face.swap', []),
      ],
      catalog: [], assets: [], libraryLoading: false, libraryError: false, status: { state: 'unset', replacement: false }, taskModel: '',
      section: 'models', onSection: () => {}, busy: false, disabled: false, navigationContext: null,
      onHome: () => {}, onTask: () => {}, onDiagnostics: () => {}, onModelMarket: () => {},
      onStart: async (...args) => { starts.push(args); },
      onEnable: async () => {}, onApplyCustomization: async () => {},
      onImportModelFiles: () => { imports += 1; },
      onChooseImportedFiles: (recipeId) => { chosenImports.push(recipeId); },
    };
    const render = async (overrides: Partial<typeof props> = {}) => ui.render(
      <AppStoreProvider store={appStore}><TooltipProvider><RuntimeCapabilityDetail {...props} {...overrides} /></TooltipProvider></AppStoreProvider>,
    );
    const card = (recipeId: string) => ui.document.querySelector<HTMLElement>(`[data-testid="capability-model:${recipeId}"]`)!;
    const button = (recipeId: string, label: string) => [...card(recipeId).querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.includes(label))!;
    await render();

    // The downloadable offer names its source transfer size and a device-fit
    // statement about the recommended model only.
    assert.match(card('spacy-md-de').textContent ?? '', /runtimeConfig\.product\.downloadSize/);
    assert.match(card('spacy-md-de').textContent ?? '', /runtimeConfig\.product\.modelFit\.supported/);
    assert.doesNotMatch(card('spacy-md-de').textContent ?? '', /hostFit|downloadSizeUnknown/);
    await act(async () => button('spacy-md-de', 'runtimeConfig.product.selectModel').click());
    assert.deepEqual(starts.at(-1), ['spacy-md-de']);

    // One saved configuration: the main Select carries exactly that binding.
    assert.match(card('spacy-md-en').textContent ?? '', /runtimeConfig\.product\.modelsOnDevice/);
    await act(async () => button('spacy-md-en', 'runtimeConfig.product.selectModel').click());
    assert.deepEqual(starts.at(-1), ['spacy-md-en', english]);

    // Several saved configurations: Select opens them for an exact choice.
    await act(async () => button('spacy-md-it', 'runtimeConfig.product.selectModel').click());
    assert.equal(starts.length, 2);
    assert.ok(button('spacy-md-it', 'runtimeConfig.product.useSavedVersion'), 'saved configurations open for choosing');

    // No offer and nothing imported: lead to import instead of a doomed task.
    assert.match(card('face.swap').textContent ?? '', /runtimeConfig\.product\.noDirectDownload/);
    await act(async () => button('face.swap', 'runtimeConfig.product.importModel').click());
    assert.equal(imports, 1);
    assert.equal(button('face.swap', 'runtimeConfig.product.selectModel'), undefined);

    // Imported files no saved configuration uses lead to choosing them.
    await render({ assets: [{ modelAssetId: 'imported', catalogVerified: false }] as never });
    await act(async () => button('face.swap', 'runtimeConfig.product.chooseImportedFiles').click());
    assert.deepEqual(chosenImports, ['face.swap']);
    assert.equal(starts.length, 2);
  });
});
