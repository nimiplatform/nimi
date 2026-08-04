import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdmitProductControlReadyForUseRequest,
  ProductControlProjectionJson,
  SelectProductControlDataRootRequest,
  SetProductControlFirstRunInstallLevelRequest,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/local_runtime';
import {
  createDesktopElectronProductControlHost,
  type DesktopProductControlTransport,
} from '../src-electron/product-control-host';

const GET_RECORD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const GET_SELECTED_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot';
const ENSURE_RECORD = '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated';
const SELECT_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot';
const COMPLETE_DEVICE_SCAN = '/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan';
const SET_INSTALL_LEVEL = '/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel';
const RECONCILE_SETUP = '/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState';
const ADMIT_READY = '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse';

function projectionJson(state = 'data_root_selected'): string {
  return JSON.stringify({
    path: '/Users/tester/Library/Application Support/Nimi/product-control.json',
    exists: true,
    state,
    record: {
      schemaVersion: 1,
      installId: 'install-a',
      productVersion: '1',
      state,
      dataRoot: {
        path: '/Users/tester/NimiData',
        status: state === 'ready_for_use' ? 'ready' : 'selected',
        selectedAt: '2026-07-14T00:00:00.000Z',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      firstRun: {
        installLevel: 'minimal',
        aiProfileAlias: 'local-speech-ready',
        completed: state === 'ready_for_use',
        completedAt: state === 'ready_for_use' ? '2026-07-14T00:00:00.000Z' : null,
      },
      pointers: {},
      repair: { required: false },
    },
    error: null,
  });
}

test('Electron Product Control maps direct commands and sends empty ready admission', async () => {
  const calls: Array<{ methodId: string; requestBytes: Uint8Array }> = [];
  const control: DesktopProductControlTransport = {
    machineProductUnary: async (input) => {
      calls.push({ methodId: input.methodId, requestBytes: input.requestBytes });
      const json = input.methodId === GET_SELECTED_DATA_ROOT
        ? JSON.stringify({
            path: '/Users/tester/Library/Application Support/Nimi/product-control.json',
            exists: true,
            state: 'ready_for_use',
            dataRoot: {
              path: '/Users/tester/NimiData',
              status: 'ready',
              selectedAt: '2026-07-14T00:00:00.000Z',
              verifiedAt: '2026-07-14T00:00:00.000Z',
              selectedAtUnixMs: 1,
              verifiedAtUnixMs: 1,
            },
            error: null,
          })
        : projectionJson(input.methodId === ADMIT_READY ? 'ready_for_use' : 'data_root_selected');
      return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
    },
  };
  const host = createDesktopElectronProductControlHost({ control });
  assert.equal(
    Object.hasOwn(host.commandHandlers, 'account_profile_library_list'),
    false,
  );

  await host.commandHandlers.product_control_record_get({ command: 'product_control_record_get', payload: {} });
  await host.commandHandlers.product_control_selected_data_root_get({
    command: 'product_control_selected_data_root_get',
    payload: {},
  });
  await host.commandHandlers.product_control_record_ensure_created({
    command: 'product_control_record_ensure_created',
    payload: {},
  });
  await host.commandHandlers.product_control_record_select_data_root({
    command: 'product_control_record_select_data_root',
    payload: { payload: { dataRoot: '/Users/tester/NimiData' } },
  });
  await host.commandHandlers.product_control_record_complete_first_run_device_environment_scan({
    command: 'product_control_record_complete_first_run_device_environment_scan',
    payload: {},
  });
  await host.commandHandlers.product_control_record_set_first_run_install_level({
    command: 'product_control_record_set_first_run_install_level',
    payload: { payload: { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' } },
  });
  await host.commandHandlers.product_control_record_reconcile_first_run_setup_state({
    command: 'product_control_record_reconcile_first_run_setup_state',
    payload: {},
  });
  const admitted = await host.commandHandlers.product_control_record_admit_ready_for_use({
    command: 'product_control_record_admit_ready_for_use',
    payload: {},
  }) as { state: string };

  assert.equal(admitted.state, 'ready_for_use');
  assert.deepEqual(calls.map((call) => call.methodId), [
    GET_RECORD,
    GET_SELECTED_DATA_ROOT,
    ENSURE_RECORD,
    SELECT_DATA_ROOT,
    COMPLETE_DEVICE_SCAN,
    SET_INSTALL_LEVEL,
    RECONCILE_SETUP,
    ADMIT_READY,
  ]);
  assert.equal(
    SelectProductControlDataRootRequest.fromBinary(calls[3]!.requestBytes).dataRoot,
    '/Users/tester/NimiData',
  );
  assert.deepEqual(
    SetProductControlFirstRunInstallLevelRequest.fromBinary(calls[5]!.requestBytes),
    { installLevel: 'minimal', aiProfileAlias: 'local-speech-ready' },
  );
  assert.deepEqual(
    AdmitProductControlReadyForUseRequest.fromBinary(calls[7]!.requestBytes),
    {},
  );
});

test('selected data-root resolver accepts only canonical selected/ready projections', async () => {
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => ProductControlProjectionJson.toBinary(
        ProductControlProjectionJson.create({
          json: JSON.stringify({
            path: '/Users/tester/Library/Application Support/Nimi/product-control.json',
            exists: true,
            state: 'ready_for_use',
            dataRoot: {
              path: '/Users/tester/NimiData',
              status: 'ready',
              selectedAt: '2026-07-14T00:00:00.000Z',
              verifiedAt: '2026-07-14T00:00:00.000Z',
              selectedAtUnixMs: 1,
              verifiedAtUnixMs: 1,
            },
            error: null,
          }),
        }),
      ),
    },
  });

  assert.equal(await host.resolveSelectedDataRoot(), '/Users/tester/NimiData');
  assert.equal(await host.resolveReadyDataRoot(), '/Users/tester/NimiData');
});
