import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { setRuntimeLogger } from '../src/runtime/telemetry/logger.js';
import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store.js';
import {
  loadLocalRouteMetadata,
  loadRuntimeRouteOptions,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-route-options';

const SETTINGS_DEVELOPER_PAGE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/settings/settings-developer-page.tsx',
);
const settingsDeveloperPageSource = readFileSync(SETTINGS_DEVELOPER_PAGE_PATH, 'utf8');
const initialRuntimeFields = { ...useAppStore.getState().runtimeFields };

test.afterEach(() => {
  setRuntimeLogger(null);
  useAppStore.setState({
    runtimeFields: { ...initialRuntimeFields },
  });
});

test('D-ERR-009: loadLocalRouteMetadata logs and rejects when listNodesCatalog fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  await assert.rejects(
    () => loadLocalRouteMetadata('text.generate', {
      pollLocalSnapshotWithTimeout: async () => ({
        models: [],
      }),
      listNodesCatalog: async () => {
        throw new Error('catalog offline');
      },
      listGoRuntimeModelsSnapshot: async () => [],
    }),
    (error: unknown) => {
      const record = error as { reasonCode?: string; actionHint?: string };
      assert.equal(record.reasonCode, 'RUNTIME_UNAVAILABLE');
      assert.equal(record.actionHint, 'check_runtime_daemon_health');
      return true;
    },
  );

  const failedLog = logs.find((entry) => entry.message === 'action:list-nodes-catalog:failed');
  assert.ok(failedLog, 'list-nodes-catalog failure must emit a warn log');
  assert.equal(failedLog?.level, 'warn');
  assert.equal(failedLog?.area, 'route-options');
  assert.equal((failedLog?.details as Record<string, unknown>)?.error, 'catalog offline');
});

test('D-ERR-009: loadLocalRouteMetadata logs and rejects when listGoRuntimeModelsSnapshot fails', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  await assert.rejects(
    () => loadLocalRouteMetadata('audio.synthesize', {
      pollLocalSnapshotWithTimeout: async () => ({
        models: [],
      }),
      listNodesCatalog: async () => [],
      listGoRuntimeModelsSnapshot: async () => {
        throw new Error('go runtime unavailable');
      },
    }),
    /go runtime unavailable/,
  );

  const failedLog = logs.find((entry) => entry.message === 'action:list-go-runtime-models:failed');
  assert.ok(failedLog, 'list-go-runtime-models failure must emit a warn log');
  assert.equal((failedLog?.details as Record<string, unknown>)?.error, 'go runtime unavailable');
});

test('D-ERR-009: settings developer page no longer uses silent empty catch', () => {
  assert.ok(
    !settingsDeveloperPageSource.includes('.catch(() => {})'),
    'settings developer page must not use silent .catch(() => {})',
  );
  assert.match(
    settingsDeveloperPageSource,
    /logRendererEvent\(\{/,
    'settings developer page should emit a renderer warning when getRuntimeModStorageDirs fails',
  );
});

test('D-ERR-009: loadRuntimeRouteOptions degrades gracefully when local metadata times out', async () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  useAppStore.setState({
    runtimeFields: {
      ...useAppStore.getState().runtimeFields,
      provider: 'localai',
      localProviderModel: 'local-model',
      connectorId: '',
    },
  });

  const options = await loadRuntimeRouteOptions({
    capability: 'text.generate',
    modId: 'world.nimi.test-ai',
  }, {
    sdkListConnectors: async () => ([
      {
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
      },
    ]),
    sdkListConnectorModelDescriptors: async () => ([
      {
        modelId: 'gpt-4.1-mini',
        capabilities: ['text.generate'],
      },
    ]),
    loadLocalRouteMetadata: async () => {
      throw new Error('local runtime snapshot timed out after 3500ms');
    },
  });

  assert.equal(options.local.models.length, 0);
  assert.equal(options.connectors.length, 1);
  assert.equal(options.connectors[0]?.id, 'connector-openai');
  assert.equal(options.selected.source, 'local');
  assert.equal(options.selected.model, 'local-model');

  const degradedLog = logs.find((entry) => entry.message === 'action:load-local-route-metadata:degraded');
  assert.ok(degradedLog, 'local metadata timeout should emit a degrade log instead of rejecting the dialog');
  assert.equal(degradedLog?.level, 'warn');
  assert.equal((degradedLog?.details as Record<string, unknown>)?.error, 'local runtime snapshot timed out after 3500ms');
});
