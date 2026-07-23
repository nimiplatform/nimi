import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiElectronDesktopAccountHost,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ProductControlProjectionJson,
  RecordProductControlAccountDefaultProfileEvidenceRequest,
  SelectProductControlDataRootRequest,
  SetProductControlFirstRunInstallLevelRequest,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/local_runtime';
import type { DesktopProductControlEvidence } from '../src-electron/product-control-evidence';
import {
  FIRST_RUN_LOCAL_AI_MINT_TIMEOUT_MS,
  createDesktopElectronProductControlHost,
  type DesktopProductControlTransport,
  formatRuntimeReadinessFailure,
} from '../src-electron/product-control-host';

const GET_RECORD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const GET_SELECTED_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot';
const ENSURE_RECORD = '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated';
const SELECT_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot';
const COMPLETE_DEVICE_SCAN = '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan';
const SET_INSTALL_LEVEL = '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel';
const RECONCILE_SETUP = '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState';
const RECORD_ACCOUNT = '/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence';

function projectionJson(state = 'data_root_selected'): string {
  return JSON.stringify({
    path: 'C:\\ProgramData\\Nimi\\Runtime\\Protected\\users\\sid\\nimi.json',
    exists: true,
    state,
    record: {
      schemaVersion: 1,
      installId: 'install-a',
      productVersion: '1',
      state,
      dataRoot: {
        path: 'D:\\NimiData',
        status: 'ready',
        selectedAt: '2026-07-14T00:00:00.000Z',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'local-speech-ready',
        completed: false,
        builtInAiConfigRefs: [],
      },
      pointers: {},
      repair: { required: false },
    },
    error: null,
  });
}

test('Electron Product Control host maps every renderer command to an exact protected Runtime method', async () => {
  const calls: Array<{ methodId: string; requestBytes: Uint8Array }> = [];
  const control: DesktopProductControlTransport = {
    machineProductUnary: async (input) => {
      calls.push({ methodId: input.methodId, requestBytes: input.requestBytes });
      const json = input.methodId === GET_SELECTED_DATA_ROOT
        ? JSON.stringify({
            path: 'C:\\ProgramData\\Nimi\\Runtime\\Protected\\nimi.json',
            exists: true,
            state: 'ready_for_use',
            dataRoot: {
              path: 'D:\\NimiData',
              status: 'selected',
              selectedAt: '2026-07-14T00:00:00.000Z',
              verifiedAt: '2026-07-14T00:00:00.000Z',
              selectedAtUnixMs: 1,
              verifiedAtUnixMs: 1,
            },
            error: null,
          })
        : projectionJson('ready_for_use');
      return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
    },
  };
  const host = createDesktopElectronProductControlHost({
    control,
    account: {
      invoke: async () => { throw new Error('not-called'); },
      close: () => {},
    },
    evidence: {
      ensureAccountDefaultProfile: () => { throw new Error('not-called'); },
      readAccountDefaultProfile: () => { throw new Error('not-called'); },
      verifyAccountDefaultProfile: () => { throw new Error('not-called'); },
      ensureBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
      readBuiltInAiConfigForScopeInit: () => { throw new Error('not-called'); },
      verifyBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
    },
  });

  await host.commandHandlers.product_control_record_get({ command: 'product_control_record_get', payload: {} });
  const selected = await host.commandHandlers.product_control_selected_data_root_get({
    command: 'product_control_selected_data_root_get', payload: {},
  }) as { dataRoot: { status: string } | null };
  await host.commandHandlers.product_control_record_ensure_created({
    command: 'product_control_record_ensure_created', payload: {},
  });
  await host.commandHandlers.product_control_record_select_data_root({
    command: 'product_control_record_select_data_root', payload: { payload: { dataRoot: 'D:\\NimiData' } },
  });
  await host.commandHandlers.product_control_record_complete_first_run_device_environment_scan({
    command: 'product_control_record_complete_first_run_device_environment_scan', payload: {},
  });
  await host.commandHandlers.product_control_record_set_first_run_install_level({
    command: 'product_control_record_set_first_run_install_level',
    payload: { payload: { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' } },
  });
  await host.commandHandlers.product_control_record_reconcile_first_run_setup_state({
    command: 'product_control_record_reconcile_first_run_setup_state', payload: {},
  });

  assert.equal(selected.dataRoot?.status, 'selected');
  assert.deepEqual(calls.map((call) => call.methodId), [
    GET_RECORD,
    GET_SELECTED_DATA_ROOT,
    ENSURE_RECORD,
    SELECT_DATA_ROOT,
    COMPLETE_DEVICE_SCAN,
    SET_INSTALL_LEVEL,
    RECONCILE_SETUP,
  ]);
  assert.equal(
    SelectProductControlDataRootRequest.fromBinary(calls[3]!.requestBytes).dataRoot,
    'D:\\NimiData',
  );
  assert.deepEqual(
    SetProductControlFirstRunInstallLevelRequest.fromBinary(calls[5]!.requestBytes),
    { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' },
  );
});

test('Electron Product Control host rejects extra renderer fields before protected transport', async () => {
  let calls = 0;
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => { calls += 1; throw new Error('not-called'); },
    },
    account: {
      invoke: async () => { throw new Error('not-called'); },
      close: () => {},
    },
    evidence: {
      ensureAccountDefaultProfile: () => { throw new Error('not-called'); },
      readAccountDefaultProfile: () => { throw new Error('not-called'); },
      verifyAccountDefaultProfile: () => { throw new Error('not-called'); },
      ensureBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
      readBuiltInAiConfigForScopeInit: () => { throw new Error('not-called'); },
      verifyBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
    },
  });

  await assert.rejects(
    host.commandHandlers.product_control_record_select_data_root({
      command: 'product_control_record_select_data_root',
      payload: { payload: { dataRoot: 'D:\\NimiData', methodId: GET_RECORD } },
    }),
    /desktop-product-control-payload-invalid/u,
  );
  await assert.rejects(
    host.commandHandlers.product_control_record_get({
      command: 'product_control_record_get',
      payload: { methodId: GET_RECORD },
    }),
    /desktop-product-control-payload-invalid/u,
  );
  assert.equal(calls, 0);
});

test('Electron first-run host records Desktop evidence through the exact protected Runtime method', async () => {
  const calls: Array<{ methodId: string; requestBytes: Uint8Array }> = [];
  const control: DesktopProductControlTransport = {
    machineProductUnary: async (input) => {
      calls.push({ methodId: input.methodId, requestBytes: input.requestBytes });
      assert.ok(input.methodId === GET_RECORD || input.methodId === RECORD_ACCOUNT);
      return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
        json: projectionJson(input.methodId === RECORD_ACCOUNT ? 'ai_environment_unconfigured' : undefined),
      }));
    },
  };
  const account: NimiElectronDesktopAccountHost = {
    invoke: async () => ({
      state: 'authenticated',
      accountProjection: {
        accountId: 'account-a',
        displayName: 'Account A',
        realmEnvironmentId: 'production',
      },
    }),
    close: () => {},
  };
  const evidenceCalls: unknown[] = [];
  const evidence: DesktopProductControlEvidence = {
    ensureAccountDefaultProfile: (input) => {
      evidenceCalls.push(input);
      return { accountDefaultProfileRef: 'account-default-profile:v1:bound' };
    },
    readAccountDefaultProfile: () => { throw new Error('not-called'); },
    verifyAccountDefaultProfile: () => { throw new Error('not-called'); },
    ensureBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
    readBuiltInAiConfigForScopeInit: () => { throw new Error('not-called'); },
    verifyBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
  };
  const host = createDesktopElectronProductControlHost({ control, account, evidence });
  const result = await host.commandHandlers.product_control_record_ensure_account_default_profile({
    command: 'product_control_record_ensure_account_default_profile',
    payload: {},
  }) as { state: string };

  assert.equal(result.state, 'ai_environment_unconfigured');
  assert.deepEqual(evidenceCalls, [{
    dataRoot: 'D:\\NimiData',
    accountId: 'account-a',
    aiProfileAlias: 'local-speech-ready',
    installLevel: 'minimal',
  }]);
  assert.deepEqual(calls.map((call) => call.methodId), [GET_RECORD, RECORD_ACCOUNT]);
  const recorded = RecordProductControlAccountDefaultProfileEvidenceRequest.fromBinary(calls[1]!.requestBytes);
  assert.deepEqual(JSON.parse(recorded.accountDefaultProfileEvidenceJson), {
    accountDefaultProfileRef: 'account-default-profile:v1:bound',
  });
});
test('Electron first-run host rejects renderer-supplied evidence fields', async () => {
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => { throw new Error('not-called'); },
    },
    account: {
      invoke: async () => { throw new Error('not-called'); },
      close: () => {},
    },
    evidence: {
      ensureAccountDefaultProfile: () => { throw new Error('not-called'); },
      readAccountDefaultProfile: () => { throw new Error('not-called'); },
      verifyAccountDefaultProfile: () => { throw new Error('not-called'); },
      ensureBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
      readBuiltInAiConfigForScopeInit: () => { throw new Error('not-called'); },
      verifyBuiltInAiConfigEvidenceSet: () => { throw new Error('not-called'); },
    },
  });
  await assert.rejects(
    host.commandHandlers.product_control_record_admit_ready_for_use({
      command: 'product_control_record_admit_ready_for_use',
      payload: { accountDefaultProfileRef: 'caller-controlled' },
    }),
    /desktop-product-control-payload-invalid/u,
  );
});

test('Electron first-run host preserves bounded Runtime readiness detail', () => {
  assert.equal(FIRST_RUN_LOCAL_AI_MINT_TIMEOUT_MS, 600_000);
  assert.equal(
    formatRuntimeReadinessFailure('first-run-execution-not-ready', {
      reasonCode: 'FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED',
      detail: 'local baseline execution failed for capability local_text_chat_execution: engine unavailable',
    }),
    'first-run-execution-not-ready:FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED: '
      + 'local baseline execution failed for capability local_text_chat_execution: engine unavailable',
  );
  assert.equal(
    formatRuntimeReadinessFailure('runtime-baseline-not-ready', {
      reasonCode: 'RUNTIME_BASELINE_READINESS_BLOCKED',
    }),
    'runtime-baseline-not-ready:RUNTIME_BASELINE_READINESS_BLOCKED',
  );
  assert.equal(
    formatRuntimeReadinessFailure('first-run-execution-not-ready', {
      reasonCode: 'FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED',
      detail: ` ${'x'.repeat(5_000)} `,
    }).length,
    'first-run-execution-not-ready:FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED: '.length + 4_096,
  );
});
