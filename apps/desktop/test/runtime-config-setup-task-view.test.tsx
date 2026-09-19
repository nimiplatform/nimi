import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract';
import {
  createRuntimeSetupTaskStore,
  type RuntimeSetupTask,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store';
import { RuntimeConfigSetupTaskView, SetupTaskPlanReview } from '../src/shell/renderer/features/runtime-config/runtime-config-setup-task-view';
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
    <SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} ownerLabel={null} />,
  );
  assert.match(markup, /runtime-setup-task-plan/);
  // Both the acquire row and the choice option show the installed-rebind
  // honesty label instead of a download size.
  const occurrences = markup.match(/Already on this machine/gu) ?? [];
  assert.equal(occurrences.length, 2);
  assert.doesNotMatch(markup, /2048|4096/);
});

test('review shows unavailable resources and distinguishes prepare-only from use', () => {
  const plan = {
    reuse: [], acquire: [], components: [], options: [],
    unavailable: [{ slotId: 'weights', label: 'Model weights' }],
    awaitingChoice: [{ slotId: 'encoder', label: 'Encoder', options: [{
      offerRef: 'recommended:encoder', templateId: 'encoder', title: 'Device fit', variantLabel: '', sizeBytes: null, recommended: true,
    }] }],
    environmentPlanId: 'env-1', candidateRevision: 'r1', selectionRevisionPresent: false,
  } satisfies RuntimeSetupPreparationPlan;
  const markup = renderView(<SetupTaskPlanReview plan={plan} choices={{}} onChoiceChange={() => {}} ownerLabel="Chat" />);
  assert.match(markup, /runtime-setup-unavailable/);
  assert.match(markup, /Model weights/);
  assert.match(markup, /runtime-setup-accept-recommendations/);
  assert.match(markup, /Recommended for this device/);
  assert.match(markup, /Prepare only keeps the current model unchanged/);
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
