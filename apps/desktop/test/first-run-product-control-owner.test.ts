import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  NimiProductControlRecordProjection,
  NimiProductControlState,
} from '@nimiplatform/sdk/runtime';
import {
  ProductControlWorkflow,
  productControlDataRootErrorMessage,
} from '../src/shell/renderer/first-run/product-control-workflow.js';
import { createUnavailableDesktopFirstRunPort } from '../src/shell/renderer/renderer/first-run-port.js';
import { createDesktopProductionFirstRunPort } from '../src/shell/renderer/renderer/production-first-run-port.js';

const TEST_FIRST_RUN = createUnavailableDesktopFirstRunPort('TEST_FIRST_RUN_UNADMITTED');

function projectionFor(
  state: NimiProductControlState,
  error: string | null = null,
): NimiProductControlRecordProjection {
  const ready = state === 'ready_for_use';
  return {
    path: '/tmp/home/.nimi/nimi.json',
    exists: state !== 'config_missing',
    state,
    error,
    record: {
      schemaVersion: 1,
      installId: 'install-1',
      productVersion: '0.1.0',
      state,
      dataRoot: state === 'config_missing' || state === 'data_root_missing' ? null : {
        path: '/tmp/nimi-data-explicit',
        status: ready ? 'ready' : 'selected',
        selectedAt: '2026-05-20T00:00:00.000Z',
        verifiedAt: '2026-05-20T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      firstRun: {
        completed: ready,
        completedAt: ready ? '2026-05-20T00:00:00.000Z' : null,
      },
      pointers: {},
      repair: { required: state === 'repair_required', reason: null },
    },
  };
}

function renderProjection(projection: NimiProductControlRecordProjection): string {
  return renderToStaticMarkup(React.createElement(ProductControlWorkflow, {
    firstRun: TEST_FIRST_RUN,
    projection,
    onProjectionChange: () => {},
  }));
}

test('Desktop first-run port exposes only active Product Control operations', () => {
  assert.deepEqual(Object.keys(createDesktopProductionFirstRunPort()).sort(), [
    'admitReadyForUse',
    'available',
    'ensureRecordCreated',
    'getRecord',
    'pickDataRootDirectory',
    'selectDataRoot',
  ]);
});

test('a failed data-root admission keeps Change folder available', () => {
  const markup = renderProjection(projectionFor(
    'data_root_selected',
    'selected data root could not be verified',
  ));
  assert.match(markup, /selected data root could not be verified/);
  assert.match(markup, /data-testid="first-run-storage-change-folder"/);
  assert.doesNotMatch(
    markup,
    /data-testid="first-run-storage-change-folder"[^>]*disabled=""/,
  );
  assert.match(markup, /data-testid="first-run-storage-retry"/);
  assert.match(markup, /data-testid="first-run-storage-continue"/);
});

test('Product Control first run contains no AI or materialization choices', () => {
  const markup = renderProjection(projectionFor('data_root_selected'));
  assert.doesNotMatch(markup, /Minimal|Recommended|Local AI|AI profile|Downloading local models/);
  assert.doesNotMatch(markup, /device scan|materialization/i);
});

test('repair and blocked copy names only Product Control prerequisites', () => {
  const repair = renderProjection(projectionFor('repair_required'));
  const blocked = renderProjection(projectionFor('blocked'));
  assert.match(repair, /Product Control/);
  assert.match(blocked, /Product Control/);
  assert.doesNotMatch(`${repair} ${blocked}`, /AIProfile|AIConfig|local model|materialization/i);
});

test('data-root validation errors explain actual path and write requirements', () => {
  const error = Object.assign(new Error('Operation failed. Please try again later.'), {
    reasonCode: 'invalid-payload',
  });
  const message = productControlDataRootErrorMessage(
    error,
    (_key, options) => options.defaultValue,
  );
  assert.match(message, /absolute non-root folder/);
  assert.match(message, /create and write data/);
  assert.doesNotMatch(message, /owned by your account|other users cannot modify/i);
  assert.doesNotMatch(message, /try again later/i);
});
