import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  NIMI_FIRST_RUN_PHASES,
  isNimiProductControlPhaseTransient,
  isNimiProductControlTransientState,
  projectNimiProductControlFirstRunScreen,
  type NimiProductControlRecord,
  type NimiProductControlRecordProjection,
  type NimiProductControlState,
} from '@nimiplatform/sdk/runtime';
import { ProductControlWorkflow } from '../src/shell/renderer/first-run/product-control-workflow.js';
import { createUnavailableDesktopFirstRunPort } from '../src/shell/renderer/renderer/first-run-port.js';

const TEST_FIRST_RUN = createUnavailableDesktopFirstRunPort('TEST_FIRST_RUN_UNADMITTED');

function projectionFor(
  state: NimiProductControlState,
  override: Partial<NimiProductControlRecord> = {},
): NimiProductControlRecordProjection {
  const ready = state === 'ready_for_use';
  const dataRoot = override.dataRoot ?? (
    state === 'config_missing' || state === 'data_root_missing'
      ? null
      : {
          path: '/tmp/nimi-data-explicit',
          status: ready ? 'ready' as const : 'selected' as const,
          selectedAt: '2026-05-20T00:00:00.000Z',
          verifiedAt: '2026-05-20T00:00:00.000Z',
          selectedAtUnixMs: 1,
          verifiedAtUnixMs: 1,
        }
  );
  return {
    path: '/tmp/home/.nimi/nimi.json',
    exists: state !== 'config_missing',
    state,
    error: null,
    record: {
      schemaVersion: 1,
      installId: 'install-1',
      productVersion: '0.1.0',
      state,
      dataRoot,
      firstRun: {
        completed: ready,
        completedAt: ready ? '2026-05-20T00:00:00.000Z' : null,
        ...override.firstRun,
      },
      pointers: {},
      repair: { required: state === 'repair_required', reason: null },
      ...override,
    },
  };
}

function render(state: NimiProductControlState, override: Partial<NimiProductControlRecord> = {}): string {
  return renderToStaticMarkup(React.createElement(ProductControlWorkflow, {
    firstRun: TEST_FIRST_RUN,
    projection: projectionFor(state, override),
    onProjectionChange: () => {},
  }));
}

test('the first-run screen projection contains only Product Control states', () => {
  assert.deepEqual(NIMI_FIRST_RUN_PHASES, ['storage']);
  assert.deepEqual(projectNimiProductControlFirstRunScreen('config_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('data_root_missing'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('data_root_selected'), { kind: 'phase', phase: 'storage' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('repair_required'), { kind: 'terminal', screen: 'repair' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('blocked'), { kind: 'terminal', screen: 'blocked' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('ready_for_use'), { kind: 'terminal', screen: 'ready' });
  assert.deepEqual(projectNimiProductControlFirstRunScreen('not_logged_in'), { kind: 'terminal', screen: 'login' });
  assert.equal(isNimiProductControlTransientState('config_missing'), true);
  assert.equal(isNimiProductControlPhaseTransient('data_root_selected'), false);
});

test('config_missing is transient and data_root_missing asks for a user-selected folder', () => {
  const configMissing = render('config_missing');
  assert.match(configMissing, /data-product-state="config_missing"/);
  assert.match(configMissing, /data-phase-transient="true"/);
  assert.doesNotMatch(configMissing, /first-run-storage-choose-folder/);

  const dataRootMissing = render('data_root_missing');
  assert.match(dataRootMissing, /data-phase-transient="false"/);
  assert.match(dataRootMissing, /Choose where Nimi stores models, apps, and large local data/);
  assert.match(dataRootMissing, /data-testid="first-run-storage-choose-folder"/);
  assert.match(dataRootMissing, /data-testid="first-run-storage-continue"/);
});

test('data_root_selected remains in Storage with Change, Retry, and Continue', () => {
  const markup = render('data_root_selected');
  assert.match(markup, /data-product-state="data_root_selected"/);
  assert.match(markup, /data-testid="first-run-step-storage" data-active="true"/);
  assert.match(markup, /data-testid="first-run-storage-change-folder"/);
  assert.match(markup, /data-testid="first-run-storage-retry"/);
  assert.match(markup, /data-testid="first-run-storage-continue"/);
  assert.match(markup, /\/tmp\/nimi-data-explicit/);
  assert.doesNotMatch(markup, /first-run-phase-device-scan/);
  assert.doesNotMatch(markup, /first-run-phase-local-ai/);
  assert.doesNotMatch(markup, /first-run-phase-setup/);
  assert.doesNotMatch(markup, /Downloading local models/);
});

test('repair, blocked, and ready states render Product Control terminal surfaces', () => {
  assert.match(render('repair_required'), /data-testid="first-run-screen-repair"/);
  assert.match(render('blocked'), /data-testid="first-run-screen-blocked"/);
  assert.match(render('ready_for_use'), /data-testid="first-run-screen-ready"/);
});

test('every Product Control state renders human copy rather than a raw enum', () => {
  const states: readonly NimiProductControlState[] = [
    'not_logged_in',
    'config_missing',
    'data_root_missing',
    'data_root_selected',
    'repair_required',
    'blocked',
    'ready_for_use',
  ];
  for (const state of states) {
    const visibleText = render(state)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    assert.ok(visibleText.length > 0);
    assert.doesNotMatch(visibleText, new RegExp(`(^|\\s)${state}(\\s|$)`));
  }
});
