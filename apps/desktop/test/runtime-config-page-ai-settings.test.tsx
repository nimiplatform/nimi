import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import {
  buildRuntimeSetupCapabilityCards,
  RuntimeConfigAiSettingsView,
  runtimeSetupTaskIsActive,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-ai-settings';
import type { RuntimeSetupTask } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store';

(globalThis as { React?: typeof React }).React = React;

const I18N_RESOURCE = { instance: { t: (key: string) => key } } as never;

function renderView(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={I18N_RESOURCE}>
      {element}
    </DesktopI18nResourceProvider>,
  );
}

function task(overrides: Partial<RuntimeSetupTask> & { readonly taskId: string }): RuntimeSetupTask {
  return {
    capabilityContract: 'image.generate',
    source: { kind: 'runtime', accountId: 'acct-1', returnFocus: 'runtime.aiSettings' },
    refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [] },
    status: 'review',
    nextAction: 'confirm-preparation',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

test('capability cards merge recipe capabilities, selections, and active tasks', () => {
  const cards = buildRuntimeSetupCapabilityCards({
    aggregate: {
      loadouts: [{
        loadoutId: 'loadout-1',
        capabilityContract: 'image.generate',
        displayName: 'Image Model',
      }],
      selections: [{ capabilityContract: 'image.generate', loadoutId: 'loadout-1', effectiveDefaults: {} }],
      selectionRevisions: {},
    } as never,
    recipes: [
      { capabilityContract: 'image.generate' },
      { capabilityContract: 'audio.transcribe' },
    ] as never,
    tasks: [task({ taskId: 'task-1', capabilityContract: 'audio.transcribe' })],
  });

  assert.deepEqual(cards, [
    {
      capabilityContract: 'image.generate',
      selectedLoadoutLabel: 'Image Model',
      activeTaskId: null,
      activeTaskStatus: null,
    },
    {
      capabilityContract: 'audio.transcribe',
      selectedLoadoutLabel: null,
      activeTaskId: 'task-1',
      activeTaskStatus: 'review',
    },
  ]);
});

test('terminal tasks are not active tasks', () => {
  assert.equal(runtimeSetupTaskIsActive(task({ taskId: 'a', status: 'done' })), false);
  assert.equal(runtimeSetupTaskIsActive(task({ taskId: 'b', status: 'failed' })), false);
  assert.equal(runtimeSetupTaskIsActive(task({ taskId: 'c', status: 'stopped' })), false);
  assert.equal(runtimeSetupTaskIsActive(task({ taskId: 'd', status: 'preparing' })), true);
  assert.equal(runtimeSetupTaskIsActive(task({ taskId: 'e', status: 'needs-attention' })), true);
});

test('AI settings view renders the machine scope, cards, and task entry strip', () => {
  const markup = renderView(
    <RuntimeConfigAiSettingsView
      cards={[{
        capabilityContract: 'image.generate',
        selectedLoadoutLabel: 'Image Model',
        activeTaskId: null,
        activeTaskStatus: null,
      }, {
        capabilityContract: 'audio.transcribe',
        selectedLoadoutLabel: null,
        activeTaskId: 'task-1',
        activeTaskStatus: 'preparing',
      }]}
      tasks={[task({ taskId: 'task-1', capabilityContract: 'audio.transcribe', status: 'preparing' })]}
      loading={false}
      loadError={null}
      runtimeWritesDisabled={false}
      busyCapability={null}
      onStartTask={() => {}}
      onContinueTask={() => {}}
      onOpenSavedConfigs={() => {}}
      profilesSection={<div data-testid="runtime-ai-settings-profiles" />}
    />,
  );

  assert.match(markup, /runtime-ai-settings-active-tasks/);
  assert.match(markup, /runtime-ai-settings-capability:image\.generate/);
  assert.match(markup, /runtime-ai-settings-capability:audio\.transcribe/);
  // The configured card offers Change; the unset card offers its in-progress task.
  assert.match(markup, /runtime-ai-settings-start:image\.generate/);
  assert.match(markup, /runtime-ai-settings-continue:audio\.transcribe/);
  assert.match(markup, /Image Model/);
  assert.match(markup, /runtime-ai-settings-saved-configs/);
  assert.match(markup, /runtime-ai-settings-profiles/);
});

test('AI settings view shows the read-only banner when runtime writes are disabled', () => {
  const markup = renderView(
    <RuntimeConfigAiSettingsView
      cards={[]}
      tasks={[]}
      loading={false}
      loadError={null}
      runtimeWritesDisabled={true}
      busyCapability={null}
      onStartTask={() => {}}
      onContinueTask={() => {}}
      onOpenSavedConfigs={() => {}}
      profilesSection={<div data-testid="runtime-ai-settings-profiles" />}
    />,
  );
  assert.match(markup, /runtime-ai-settings-readonly/);
});

test('AI settings view renders load failures without pretending there is nothing configured', () => {
  const markup = renderView(
    <RuntimeConfigAiSettingsView
      cards={[]}
      tasks={[]}
      loading={false}
      loadError="runtime read failed"
      runtimeWritesDisabled={false}
      busyCapability={null}
      onStartTask={() => {}}
      onContinueTask={() => {}}
      onOpenSavedConfigs={() => {}}
      profilesSection={<div data-testid="runtime-ai-settings-profiles" />}
    />,
  );
  assert.match(markup, /runtime-ai-settings-load-error/);
  assert.match(markup, /runtime read failed/);
  assert.doesNotMatch(markup, /nimi-empty-state__title/);
});
