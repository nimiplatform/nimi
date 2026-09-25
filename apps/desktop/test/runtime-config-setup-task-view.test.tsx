import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NimiLoadoutRecipe, NimiMachineLoadout, NimiRuntimeLocalEnvironmentPlan } from '@nimiplatform/sdk/runtime';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract';
import {
  createRuntimeSetupTaskStore,
  type RuntimeSetupTask,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store';
import { RuntimeConfigSetupTaskView, SetupTaskPlanReview } from '../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view';
import { PendingSetupBanner, RuntimeCapabilityDetail } from '../src/shell/renderer/features/runtime-config/runtime-capability-detail';
import { RuntimeProfileQuickStart } from '../src/shell/renderer/features/runtime-config/runtime-profile-quick-start';
import type { RuntimeSetupPreparationPlan, RuntimeSetupRunnerPorts } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner';

(globalThis as { React?: typeof React }).React = React;

const I18N_RESOURCE = { instance: { t: (key: string) => key } } as never;

function makeStore() {
  let counter = 0;
  return createRuntimeSetupTaskStore({
    storage: null,
    now: () => '2026-09-18T00:00:00.000Z',
    createId: (prefix) => `${prefix}-${counter++}`,
  });
}

function fakePorts(): RuntimeSetupRunnerPorts {
  const aiConfig = {
    get: async () => ({ config: null, revision: '1', effectiveSelections: [] }),
    overwrite: async () => ({ outcome: 'conflict' as const, config: null, revision: '1', reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const }),
    listOptions: async () => ({ kind: 'cloud-connectors' as const, options: [], truncated: false }),
  };
  return {
    loadouts: {
      listRecipes: async () => [],
      get: async () => ({ loadouts: [], selections: [], selectionRevisions: {} }),
    },
    environment: {},
    install: {},
    aiConfigForSource: (source) => (source.kind === 'runtime' ? null : aiConfig),
    account: { currentAccountId: () => 'acct-1' },
    now: () => '2026-09-18T00:00:00.000Z',
  } as unknown as RuntimeSetupRunnerPorts;
}

function renderView(element: React.ReactElement): string {
  const bindings = { app: { commands: {} }, sdk: {} } as DesktopCanonicalRendererBindings;
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={I18N_RESOURCE}>
      <DesktopRendererBindingProvider bindings={bindings}>
        {element}
      </DesktopRendererBindingProvider>
    </DesktopI18nResourceProvider>,
  );
}

function taskOn(store: ReturnType<typeof makeStore>, overrides: Partial<RuntimeSetupTask> & { readonly capabilityContract: string }): RuntimeSetupTask {
  const task = store.createTask({
    capabilityContract: overrides.capabilityContract,
    source: overrides.source ?? { kind: 'runtime', accountId: 'acct-1' },
  });
  const patch = { ...overrides };
  delete patch.capabilityContract;
  delete patch.source;
  return store.updateTask(task.taskId, () => patch) ?? store.getTask(task.taskId)!;
}

test('a consumer-source draft offers the Local/Cloud route choice and the reuse shortcut', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: 'acct-1', returnFocus: 'apps:app.chat' },
  });
  const markup = renderView(
    <RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />,
  );
  assert.match(markup, /runtime-setup-task-route-choice/);
  assert.match(markup, /runtime-setup-route-local/);
  assert.match(markup, /runtime-setup-route-cloud/);
  assert.match(markup, /runtime-setup-reuse-current/);
  assert.doesNotMatch(markup, /runtime-setup-task-recipes/);
});

test('a machine-scope draft never offers a global Cloud default', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'image.generate',
    source: { kind: 'runtime', accountId: 'acct-1' },
  });
  const markup = renderView(
    <RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />,
  );
  assert.match(markup, /runtime-setup-task-recipes/);
  assert.doesNotMatch(markup, /runtime-setup-route-cloud/);
  assert.doesNotMatch(markup, /runtime-setup-reuse-current/);
});

test('a cloud-route draft renders the in-task connection picker with the shared add form entry', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: 'acct-1' },
    draft: { route: 'cloud' },
  });
  const markup = renderView(
    <RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />,
  );
  assert.match(markup, /runtime-setup-task-cloud/);
  assert.match(markup, /runtime-setup-cloud-add-connector/);
  assert.match(markup, /runtime-setup-route-back-local/);
});

test('the done state distinguishes saved settings from real request success', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: 'acct-1', returnFocus: 'apps:app.chat' },
    status: 'done',
    nextAction: 'return-to-source',
    draft: { route: 'cloud', cloudConnectorRef: 'conn-1' },
  });
  const markup = renderView(
    <RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />,
  );
  assert.match(markup, /runtime-setup-task-done/);
  assert.match(markup, /Cloud settings saved/);
  assert.match(markup, /runtime-setup-task-done-execution-note/);
  assert.match(markup, /Settings are saved; no test request was sent/);
  assert.match(markup, /runtime-setup-task-return/);
});

test('the plan review marks an installed variant as a rebind instead of a download size', () => {
  const plan: RuntimeSetupPreparationPlan = {
    reuse: [],
    acquire: [{
      slotId: 'main.diffusion',
      label: 'Main model',
      offer: {
        offerRef: 'offer:new',
        title: 'Image Model (Q6)',
        variantLabel: 'q6',
        sizeBytes: 2048,
        installedModelAssetId: 'asset-new',
      },
    }],
    awaitingChoice: [{
      slotId: 'companion.mmproj',
      label: 'Vision projector',
      options: [{
        offerRef: 'offer:companion',
        title: 'Projector',
        variantLabel: 'f16',
        sizeBytes: 4096,
        installedModelAssetId: 'asset-companion',
      }],
    }],
    unavailable: [],
    components: [],
    options: [],
    environmentPlanId: 'env-plan-1',
    candidateRevision: 'r2',
    selectionRevisionPresent: true,
    selectionRevision: 'sel-1',
  };
  const markup = renderView(
    <SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} />,
  );
  assert.match(markup, /runtime-setup-task-plan/);
  // Both the acquire row and the choice option show the installed-rebind
  // honesty label instead of a download size.
  const occurrences = markup.match(/Already on this machine/gu) ?? [];
  assert.equal(occurrences.length, 2);
  assert.doesNotMatch(markup, /2048|4096/);
  // Several model files are told apart by their part, never by a raw slot label.
  assert.match(markup, />Main model</);
  assert.match(markup, />Vision projector</);
});

test('review shows unavailable resources and marks the device recommendation without a separate accept button', () => {
  const plan = {
    reuse: [], acquire: [], components: [], options: [],
    unavailable: [{ slotId: 'weights', label: 'Model weights' }],
    awaitingChoice: [{ slotId: 'encoder', label: 'Encoder', options: [{
      offerRef: 'recommended:encoder', templateId: 'encoder', title: 'Device fit', variantLabel: '', sizeBytes: null, recommended: true,
    }] }],
    environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
  } satisfies RuntimeSetupPreparationPlan;
  const markup = renderView(<SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} />);
  assert.match(markup, /runtime-setup-unavailable/);
  assert.match(markup, /Model weights/);
  assert.match(markup, /Recommended for this device/);
  assert.doesNotMatch(markup, /runtime-setup-accept-recommendations/);
  // The card is the summary: no heading or prose restating the confirmation.
  assert.doesNotMatch(markup, /What will happen|Prepare only keeps the current model unchanged/);
});

test('a version choice shows the selected version on one line and groups the versions by model size', () => {
  const option = (size: string, quant: string, sizeBytes: number, recommended = false) => ({
    offerRef: `offer:${size}:${quant}`, title: `gemma-4-${size}-it-local (${quant})`, variantLabel: '', sizeBytes, recommended,
  });
  const plan = {
    reuse: [], acquire: [], unavailable: [], components: [], options: [],
    awaitingChoice: [{ slotId: 'main.gguf', label: 'Main model', options: [
      option('26b-a4b', 'Q4_K_M', 16_947_539_744),
      option('e2b', 'Q8_0', 5_048_350_848, true),
      option('e2b', 'Q4_K_M', 3_106_736_256),
    ] }],
    environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
  } satisfies RuntimeSetupPreparationPlan;

  // With the recommendation selected the choice is one closed line.
  const closed = renderView(
    <SetupTaskPlanReview plan={plan} choices={{ 'main.gguf': 'offer:e2b:Q8_0' }} onChoiceChange={() => {}} />,
  );
  assert.match(closed, />Model</);
  assert.doesNotMatch(closed, /Main model/);
  assert.match(closed, /Gemma 4 2B · Q8/);
  assert.match(closed, /Recommended for this device/);
  assert.match(closed, /4\.70 GB/);
  assert.match(closed, /Change version/);
  assert.doesNotMatch(closed, /type="radio"/);

  // Without a selection the versions start open, grouped by model size.
  const open = renderView(<SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} />);
  assert.match(open, /No version selected/);
  assert.equal((open.match(/type="radio"/gu) ?? []).length, 3);
  const small = open.indexOf('>Gemma 4 2B<');
  const large = open.indexOf('>Gemma 4 26B<');
  assert.ok(small >= 0 && large > small, 'the smaller model size is listed first');
  assert.ok(open.indexOf('>Q4<', small) < open.indexOf('>Q8<', small), 'versions follow their quantization');
  // Versions carry no quality words: those are inferred from bit width alone
  // and would compare versions of different model sizes.
  assert.doesNotMatch(open, /quantSemantic/);
});

test('failed owner save preserves the machine result and offers only the app retry', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'text.generate', status: 'failed',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: 'acct-1' },
    failure: { stage: 'save-route', message: 'connection lost', machineSelected: true, ownerSaveState: 'unknown' },
  });
  const markup = renderView(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.match(markup, /The model on this device was changed successfully/);
  assert.match(markup, /The app save result is unknown/);
  assert.match(markup, /Check and save app settings/);
  assert.doesNotMatch(markup, /Review and retry/);
});

// Desktop's Runtime carrier reports a Runtime failure with the reason code as its message.
const MISSING_MODEL_FILES = {
  stage: 'create-candidate', reasonCode: 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND', message: 'AI_LOADOUT_MODEL_ASSET_NOT_FOUND',
} as const;

test('a missing model file reads as guidance and keeps its reason code under technical details', () => {
  const store = makeStore();
  const task = taskOn(store, { capabilityContract: 'text.generate', status: 'failed', failure: MISSING_MODEL_FILES });
  const markup = renderView(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.match(markup, /runtime-setup-task-failed[\s\S]*The files for this model could not be found\. They may have been deleted or moved\./);
  assert.equal(markup.match(/AI_LOADOUT_MODEL_ASSET_NOT_FOUND/gu)?.length, 1);
  assert.match(markup, /<details[^>]*><summary[^>]*>Technical details<\/summary><span[^>]*>AI_LOADOUT_MODEL_ASSET_NOT_FOUND<\/span><\/details>/);
});

test('locked local models read as guidance and offer no retry that meets the same restriction', () => {
  const store = makeStore();
  const task = taskOn(store, {
    capabilityContract: 'text.generate', status: 'failed',
    failure: {
      stage: 'resolve-preparation',
      reasonCode: 'AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED',
      message: 'AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED',
    },
  });
  const page = renderView(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.match(page, /runtime-setup-task-failed[\s\S]*Local models unavailable[\s\S]*saved by an earlier version of Nimi and need a format upgrade before local models can be used again\./);
  assert.doesNotMatch(page, /Setup failed/);
  assert.equal(page.match(/AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED/gu)?.length, 1);
  assert.match(page, /<details[^>]*><summary[^>]*>Technical details<\/summary><span[^>]*>AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED<\/span><\/details>/);
  assert.doesNotMatch(page, /runtime-setup-task-retry|Choose another model/);
  assert.match(page, />Back<\/span><\/button>/);

  // Embedded, the card closes from its header, so the alert stands alone.
  const card = renderView(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} embedded />);
  assert.match(card, /Local models unavailable/);
  assert.doesNotMatch(card, /runtime-setup-task-retry|Choose another model|>Back<\/span><\/button>/);
});

test('any other failure keeps its reported text and names a distinct reason code once', () => {
  const store = makeStore();
  const bare = taskOn(store, {
    capabilityContract: 'text.generate', status: 'failed',
    failure: { stage: 'create-candidate', reasonCode: 'AI_LOADOUT_NOT_CONFIGURED', message: 'AI_LOADOUT_NOT_CONFIGURED' },
  });
  const bareMarkup = renderView(<RuntimeConfigSetupTaskView taskId={bare.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.equal(bareMarkup.match(/AI_LOADOUT_NOT_CONFIGURED/gu)?.length, 1);
  assert.doesNotMatch(bareMarkup, /Technical details/);

  const described = taskOn(store, {
    capabilityContract: 'text.generate', status: 'needs-attention',
    failure: { stage: 'resolve-preparation', reasonCode: 'RUNTIME_SETUP_CONDITION_CONFLICT', message: 'The candidate configuration was modified outside this task.' },
  });
  const describedMarkup = renderView(<RuntimeConfigSetupTaskView taskId={described.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.match(describedMarkup, /The candidate configuration was modified outside this task\. \(RUNTIME_SETUP_CONDITION_CONFLICT\)/);
});

test('the conversation quick start explains a missing model file instead of showing its reason code', () => {
  const task = taskOn(makeStore(), { capabilityContract: 'text.generate', status: 'failed', failure: MISSING_MODEL_FILES });
  const markup = renderView(
    <RuntimeProfileQuickStart
      disabled={false}
      onUse={() => {}}
      conversation={{
        pending: false,
        preparation: { state: 'attention', task, replacement: false },
        model: '',
        onOpenChat: () => {},
        onUseInChat: async () => ({ ok: true }),
        onOpenDetail: () => {},
        onOpenTask: () => {},
        onRetry: () => {},
      }}
    />,
  );
  assert.match(markup, /data-quick-start-state="attention"/);
  assert.match(markup, /The files for this model could not be found/);
  assert.doesNotMatch(markup, /AI_LOADOUT_MODEL_ASSET_NOT_FOUND/);
});

test('the review shell names the setup, opens straight on the summary card, and explains components in plain words', async () => {
  const { componentPresentation } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view');
  const t = (key: string, options?: Record<string, unknown>) => (typeof options?.defaultValue === 'string' ? options.defaultValue : key);
  // Known ids get product names and a plain state; unknown ids stay visible verbatim.
  const known = componentPresentation({ dependencyFamily: 'native-engine-package.llama', dependencyId: 'llama.cpp.package', state: 'needs_confirmation' }, t);
  assert.equal(known.name, 'llama.cpp.package');
  assert.equal(known.tone, 'info');
  const failed = componentPresentation({ dependencyFamily: 'x', dependencyId: 'custom-thing', state: 'failed' }, t);
  assert.equal(failed.name, 'custom-thing');
  assert.equal(failed.tone, 'warning');

  const plan = {
    reuse: [{ slotId: 'main.model', label: 'Main model', modelAssetId: 'asset-1' }],
    acquire: [], awaitingChoice: [], unavailable: [], options: [],
    components: [{ dependencyFamily: 'accelerator.cuda.runtime', dependencyId: 'nvidia-cuda-user-space-runtime', label: 'raw', state: 'needs_confirmation', required: true }],
    environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
  } satisfies RuntimeSetupPreparationPlan;
  const markup = renderView(<SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} />);
  // No count chips above the card; the card itself is the summary.
  assert.doesNotMatch(markup, /runtime-setup-task-summary/);
  assert.match(markup, />Model<[\s\S]*Already on this machine/);
  assert.match(markup, />Component<[\s\S]*nvidia-cuda-user-space-runtime/);
  // The raw component id is kept under technical details rather than shown as the row title.
  assert.match(markup, /accelerator\.cuda\.runtime \/ nvidia-cuda-user-space-runtime/);

  const store = makeStore();
  const task = taskOn(store, { capabilityContract: 'text.generate', status: 'review', candidateLoadoutId: 'cand-1' });
  const view = renderView(<RuntimeConfigSetupTaskView taskId={task.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  // The header names the setup; what the capability is for stays on the capability page.
  assert.match(view, /data-testid="runtime-setup-hero-title"/);
  assert.doesNotMatch(view, /runtime-setup-hero-usage/);
  assert.match(view, /runtime-setup-task-advanced/);
  assert.doesNotMatch(view, /runtimeConfig\.setupTask\.lead\./);
  // No choose/prepare/use step pills between the header and the review content.
  assert.doesNotMatch(view, /runtime-setup-steps/);
  assert.doesNotMatch(view, /aria-current="step"/);
  assert.match(view, /runtime-setup-task-close/);
  // Back already discards an unconfirmed setup, so there is no separate cancel.
  assert.doesNotMatch(view, /runtime-setup-task-stop-early/);

  // A reopened setup whose earlier run left install work keeps an explicit cancel.
  const reopened = taskOn(store, {
    capabilityContract: 'text.generate', status: 'review', candidateLoadoutId: 'cand-2',
    refs: { installPlanIds: ['plan-1'], transferIds: [], dependencyJobIds: [] },
  });
  const reopenedView = renderView(<RuntimeConfigSetupTaskView taskId={reopened.taskId} store={store} ports={fakePorts()} onClose={() => {}} />);
  assert.match(reopenedView, /runtime-setup-task-stop-early/);
});

test('the capability banner names the model under setup and offers the action for its state', () => {
  const pending = (status: RuntimeSetupTask['status']) => taskOn(makeStore(), { capabilityContract: 'text.annotate', status, candidateLoadoutId: 'cand-1' });
  const banner = (status: RuntimeSetupTask['status'], model = 'English language analysis') =>
    renderView(<PendingSetupBanner task={pending(status)} model={model} onOpen={() => {}} />);
  assert.match(banner('preparing'), /pendingSetup\.preparing<[\s\S]*pendingSetup\.viewProgress/);
  assert.match(banner('committing'), /pendingSetup\.preparing</);
  assert.match(banner('needs-attention'), /pendingSetup\.attention<[\s\S]*pendingSetup\.resolve/);
  assert.match(banner('failed'), /pendingSetup\.attention</);
  assert.match(banner('prepared'), /pendingSetup\.prepared<[\s\S]*pendingSetup\.enable/);
  // Without a known candidate the banner still reads as a sentence.
  assert.match(banner('preparing', ''), /pendingSetup\.preparingUnnamed</);
});

test('the capability page offers the customize tab only when a current model exists', () => {
  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  const detail = (selected: NimiMachineLoadout | undefined) => renderView(
    <AppStoreProvider store={appStore}>
    <TooltipProvider>
    <RuntimeCapabilityDetail
      capability="text.annotate"
      selected={selected}
      loadouts={[]}
      recipes={[]}
      catalog={[]}
      assets={[]}
      libraryLoading={false}
      libraryError={false}
      status={{ state: selected ? 'ready' : 'unset', replacement: false }}
      taskModel=""
      section="advanced"
      onSection={() => {}}
      busy={false}
      disabled={false}
      navigationContext={null}
      onHome={() => {}}
      onStart={async () => {}}
      onEnable={async () => {}}
      onApplyCustomization={async () => {}}
      onTask={() => {}}
      onDiagnostics={() => {}}
      onModelMarket={() => {}}
    />
    </TooltipProvider>
    </AppStoreProvider>,
  );
  // Nothing to customize: no tab, and a section left on it shows the overview.
  const unset = detail(undefined);
  assert.doesNotMatch(unset, /runtimeConfig\.capabilities\.tabs\.advanced/);
  assert.doesNotMatch(unset, /runtimeConfig\.product\.editModelAndOptions/);
  assert.match(unset, /runtimeConfig\.product\.currentOnDevice/);

  const current = detail({
    loadoutId: 'loadout-1', recipeId: 'recipe-en', capabilityContract: 'text.annotate',
    displayName: 'English language analysis', modelAxes: [], validationState: 'configured',
  } as unknown as NimiMachineLoadout);
  assert.match(current, /runtimeConfig\.capabilities\.tabs\.advanced/);
  assert.doesNotMatch(current, /runtimeConfig\.product\.editModelAndOptions/);
  assert.match(current, /runtimeConfig\.product\.customization\.unavailable/);
});

function renderCapabilityOverview(props: Partial<React.ComponentProps<typeof RuntimeCapabilityDetail>>): string {
  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  return renderView(
    <AppStoreProvider store={appStore}>
    <TooltipProvider>
    <RuntimeCapabilityDetail
      capability="text.generate"
      loadouts={[]}
      recipes={[]}
      catalog={[]}
      assets={[]}
      libraryLoading={false}
      libraryError={false}
      status={{ state: 'unset', replacement: false }}
      taskModel=""
      section="overview"
      onSection={() => {}}
      busy={false}
      disabled={false}
      navigationContext={null}
      onHome={() => {}}
      onStart={async () => {}}
      onEnable={async () => {}}
      onApplyCustomization={async () => {}}
      onTask={() => {}}
      onDiagnostics={() => {}}
      onModelMarket={() => {}}
      {...props}
    />
    </TooltipProvider>
    </AppStoreProvider>,
  );
}

const GEMMA_RECIPE = {
  recipeId: 'recipe-gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate',
  implementationSupportedFeatures: ['input.image'], slots: [], applicability: 'supported',
} as unknown as NimiLoadoutRecipe;
const GEMMA_LOADOUT = {
  loadoutId: 'loadout-gemma', recipeId: 'recipe-gemma', capabilityContract: 'text.generate',
  displayName: 'Gemma 4 text generation', modelAxes: [], validationState: 'configured',
} as unknown as NimiMachineLoadout;
const environmentWith = (...states: string[]) => ({
  state: 'ready',
  dependencies: states.map((state, index) => ({
    dependencyFamily: 'engine', dependencyId: `component-${index}`, state, required: true,
  })),
}) as unknown as NimiRuntimeLocalEnvironmentPlan;

test('a prepared capability keeps its model on one card and folds ready components into technical details', () => {
  const html = renderCapabilityOverview({
    selected: GEMMA_LOADOUT,
    recipes: [GEMMA_RECIPE],
    environment: environmentWith('ready_managed'),
    status: { state: 'ready', replacement: false },
  });
  assert.match(html, /capability-state-badge[^>]*>[\s\S]*?runtimeConfig\.capabilities\.state\.ready</);
  assert.match(html, /runtimeConfig\.product\.currentOnDevice/);
  assert.match(html, /aria-label="runtimeConfig\.product\.whatItDoes"><li[^>]*>[^<]+<\/li><li[^>]*>runtimeConfig\.product\.feature\.input-image</);
  assert.match(html, /runtimeConfig\.overview\.openChat/);
  // Ready components are a technical detail, not a second status line.
  assert.doesNotMatch(html, /capability-environment-status/);
  assert.match(html, /capability-technical-details[\s\S]*runtimeConfig\.product\.technicalEnvironment[\s\S]*component-0/);
  // Customizing is reached through its own tab.
  assert.doesNotMatch(html, /runtimeConfig\.product\.customize/);
});

test('runtime components that still need work stay on the capability card and are listed once', () => {
  const html = renderCapabilityOverview({
    selected: GEMMA_LOADOUT,
    recipes: [GEMMA_RECIPE],
    environment: environmentWith('ready_managed', 'failed'),
    status: { state: 'attention', replacement: false },
  });
  assert.match(html, /capability-state-badge[^>]*>[\s\S]*?runtimeConfig\.capabilities\.state\.attention</);
  assert.match(html, /runtimeConfig\.setupTask\.repairSetup/);
  assert.match(html, /capability-environment-status[\s\S]*runtimeConfig\.capabilities\.environmentSummary[\s\S]*component-0[\s\S]*component-1/);
  const details = html.slice(html.indexOf('capability-technical-details'));
  assert.match(details, /runtimeConfig\.product\.technicalModel/);
  assert.doesNotMatch(details, /runtimeConfig\.product\.technicalEnvironment|component-1/);
});

test('a downloaded recipe offers enable without being labeled as the current model', () => {
  const html = renderCapabilityOverview({ downloadedRecipe: GEMMA_RECIPE, recipes: [GEMMA_RECIPE] });
  assert.match(html, /capability-downloaded-badge/);
  assert.match(html, /capability-enable-downloaded/);
  assert.match(html, /runtimeConfig\.product\.downloadedLead/);
  assert.doesNotMatch(html, /runtimeConfig\.product\.currentOnDevice/);
  assert.doesNotMatch(html, /capability-technical-details/);
});

test('the review names Python components by family, shows offer terms, and blocks a candidate without a managed environment', async () => {
  const { componentPresentation } = await import('../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view');
  const { readFileSync } = await import('node:fs');
  const en = JSON.parse(readFileSync(new URL('../src/shell/renderer/locales/en/46-runtimeConfig.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  // Mirrors i18next's lookup of keys whose last segment contains dots.
  const lookup = (key: string): unknown => {
    const path = key.replace(/^runtimeConfig\./u, '').split('.');
    let node: unknown = en;
    for (let index = 0; index < path.length; index += 1) {
      const record = node as Record<string, unknown> | undefined;
      if (!record || typeof record !== 'object') return undefined;
      if (path[index]! in record) { node = record[path[index]!]; continue; }
      return record[path.slice(index).join('.')];
    }
    return node;
  };
  const t = (key: string, options?: Record<string, unknown>) => {
    const found = lookup(key);
    return typeof found === 'string' ? found : (typeof options?.defaultValue === 'string' ? options.defaultValue : key);
  };
  const packages = componentPresentation({ dependencyFamily: 'python.package-set', dependencyId: 'text.spacy.python.cpu.0123abcd', state: 'needs_confirmation' }, t);
  assert.equal(packages.name, 'Model libraries');
  assert.equal(packages.purpose, 'The pinned libraries this model needs to run');
  for (const family of ['python.tool.uv', 'python.runtime', 'python.venv', 'python.package-set']) {
    const shown = componentPresentation({ dependencyFamily: family, dependencyId: `raw.${family}.digest`, state: 'needs_confirmation' }, t);
    assert.notEqual(shown.name, `raw.${family}.digest`, `${family} is named in plain words`);
    assert.ok(shown.purpose, `${family} explains its purpose`);
  }

  const plan = {
    reuse: [], awaitingChoice: [], unavailable: [], options: [],
    acquire: [{ slotId: 'text.model', label: 'English language analysis model', offer: {
      offerRef: 'offer-en', title: 'asset-nlp-spacy-en-core-web-md-3.8.0', variantLabel: 'config.cfg', sizeBytes: 33480380,
      license: 'MIT', publisher: 'explosion',
    } }],
    components: [{ dependencyFamily: 'python.package-set', dependencyId: 'text.spacy.python.cpu.0123abcd', label: 'raw', state: 'needs_confirmation', required: true }],
    environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false, componentsDownloadBytes: null,
  } satisfies RuntimeSetupPreparationPlan;
  const markup = renderView(<SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} />);
  // The terms row exists for the download; this harness does not interpolate values.
  assert.match(markup, /runtime-setup-offer-terms:text\.model/);
  assert.match(markup, /runtime-setup-download-scope/);
  assert.match(markup, /directly from their publisher/);
  assert.match(markup, /not included in the model download above/);
  assert.doesNotMatch(markup, /runtime-setup-environment-unavailable/);

  const refused = renderView(<SetupTaskPlanReview
    plan={{ ...plan, acquire: [], components: [], environmentUnavailable: { reasonCode: 'AI_LOADOUT_DRIVER_UNAVAILABLE' } }}
    choices={{}} onChoiceChange={() => {}}
  />);
  assert.match(refused, /runtime-setup-environment-unavailable/);
  assert.doesNotMatch(refused, /Ready to use these settings|readyToUseSettings/);
});

test('inline preparation replaces an unavailable model card and keeps a ready current model usable', () => {
  const pending = taskOn(makeStore(), { capabilityContract: 'text.generate', status: 'preparing', candidateLoadoutId: 'replacement' });
  const props = {
    selected: GEMMA_LOADOUT,
    recipes: [GEMMA_RECIPE],
    preparation: <div data-testid="embedded-preparation">Download progress</div>,
  };
  const repair = renderCapabilityOverview({ ...props, status: { state: 'attention', task: pending, replacement: false } });
  assert.match(repair, /capability-preparation[\s\S]*embedded-preparation/);
  assert.doesNotMatch(repair, /capability-current-model|capability-pending-setup/);
  assert.equal((repair.match(/<h1/g) ?? []).length, 1);
  const replacement = renderCapabilityOverview({ ...props, status: { state: 'ready', task: pending, replacement: true } });
  assert.match(replacement, /capability-current-model/);
  assert.match(replacement, /runtimeConfig\.overview\.openChat/);
  assert.match(replacement, /capability-preparation/);
  assert.doesNotMatch(replacement, /capability-pending-setup/);
});
