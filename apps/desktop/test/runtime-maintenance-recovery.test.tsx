import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
(globalThis as { React?: typeof React }).React = React;

import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  RuntimeMaintenanceRecoveryContent,
  runtimeMaintenancePhaseForReplacement,
  type RuntimeMaintenanceRecoveryViewProps,
} from '../src/shell/renderer/app-shell/routes/runtime-maintenance-recovery-view';
import type { ProductControlMaintenanceReplacementProjection } from '../src/shell/renderer/bridge/runtime-bridge/product-control';

const REASON = 'runtime-stored-data-unsupported';

function render(overrides: Partial<RuntimeMaintenanceRecoveryViewProps> = {}): string {
  const props: RuntimeMaintenanceRecoveryViewProps = {
    reasonCode: REASON,
    currentRoot: '/Users/tester/NimiData',
    phase: 'idle',
    pendingTarget: null,
    technicalDetail: null,
    sourceRuntime: false,
    onChooseFolder: () => undefined,
    onConfirm: () => undefined,
    onCancel: () => undefined,
    onReopen: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<RuntimeMaintenanceRecoveryContent {...props} />);
}

function outsideDetails(html: string): string {
  return html.replace(/<details[\s\S]*<\/details>/u, '');
}

test('the recovery page offers only the new empty folder, keeps Support and folds the reason away', async () => {
  await initI18n(); await changeLocale('en');
  const html = render();
  assert.match(html, /data-phase="idle"/);
  assert.match(html, /\/Users\/tester\/NimiData/);
  assert.match(html, /choose a new, empty folder/);
  assert.match(html, /data-testid="runtime-maintenance-choose-folder"/);
  assert.match(html, /data-testid="support-degraded-entry/);
  assert.doesNotMatch(html, /runtime-maintenance-reopen/);
  // The typed reason is diagnostic only; the page body never shows it.
  assert.doesNotMatch(outsideDetails(html), new RegExp(REASON));
  assert.match(html, /<details[\s\S]*runtime-stored-data-unsupported[\s\S]*<\/details>/u);
  assert.doesNotMatch(html, /runtime:convert-chat-storage/);
});

test('the source Runtime adds the developer offline hint inside technical details only', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({ sourceRuntime: true });
  assert.match(html, /<details[\s\S]*pnpm runtime:convert-chat-storage[\s\S]*<\/details>/u);
  assert.doesNotMatch(outsideDetails(html), /pnpm runtime:convert-chat-storage/);
});

test('typed non-activation keeps the choice open with a plain explanation', async () => {
  await initI18n(); await changeLocale('en');
  const notEmpty = render({ phase: 'not-empty' });
  assert.match(notEmpty, /role="alert"[^>]*>That folder isn&#x27;t empty/);
  assert.match(notEmpty, /data-testid="runtime-maintenance-choose-folder"/);
  assert.match(render({ phase: 'overlaps' }), /outside the current data folder/);
  const failed = render({ phase: 'failed', technicalDetail: 'validate prepared nimi_data root: denied' });
  assert.match(failed, /couldn&#x27;t use that folder/);
  assert.match(failed, /<details[\s\S]*validate prepared nimi_data root: denied[\s\S]*<\/details>/u);
});

test('after activation the page stops offering a new choice and reports what happens next', async () => {
  await initI18n(); await changeLocale('en');
  const relaunching = render({ phase: 'relaunching' });
  assert.match(relaunching, /Restarting Nimi in the new folder/);
  assert.doesNotMatch(relaunching, /runtime-maintenance-choose-folder|runtime-maintenance-reopen/);
  const source = render({ phase: 'source-restart' });
  assert.match(source, /pnpm dev:runtime/);
  assert.match(source, /data-testid="runtime-maintenance-reopen"/);
  assert.doesNotMatch(source, /runtime-maintenance-choose-folder/);
  assert.match(render({ phase: 'restart-failed' }), /couldn&#x27;t restart by itself/);
  await changeLocale('zh');
  assert.match(render({ phase: 'relaunching' }), /正在用新文件夹重新启动 Nimi/);
  assert.match(render(), /Nimi 无法打开当前文件夹中的数据|选择新的空文件夹/);
});

test('the page state follows the typed replacement outcome only', () => {
  const base = { path: '', exists: true, state: 'ready_for_use', record: null, error: null } as unknown as ProductControlMaintenanceReplacementProjection;
  const activated = { activated: true, reasonCode: 'DATA_ROOT_REPLACED', actionHint: 'restart_runtime_and_check_sync' } as const;
  assert.equal(runtimeMaintenancePhaseForReplacement({ ...base, activation: activated, maintenanceRestart: 'relaunching' }), 'relaunching');
  assert.equal(runtimeMaintenancePhaseForReplacement({ ...base, activation: activated, maintenanceRestart: 'source_runtime_restart_required' }), 'source-restart');
  assert.equal(runtimeMaintenancePhaseForReplacement({ ...base, activation: activated, maintenanceRestart: 'restart_failed' }), 'restart-failed');
  assert.equal(runtimeMaintenancePhaseForReplacement({
    ...base, maintenanceRestart: null,
    activation: { activated: false, reasonCode: 'DATA_ROOT_NOT_EMPTY', actionHint: 'choose_new_empty_root' },
  }), 'not-empty');
  assert.equal(runtimeMaintenancePhaseForReplacement({
    ...base, maintenanceRestart: null,
    activation: { activated: false, reasonCode: 'DATA_ROOT_OVERLAPS_CURRENT', actionHint: 'choose_path_disjoint_root' },
  }), 'overlaps');
  assert.equal(runtimeMaintenancePhaseForReplacement({ ...base, maintenanceRestart: null, activation: null }), 'failed');
});
