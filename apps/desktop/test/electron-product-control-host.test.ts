import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdmitProductControlReadyForUseRequest,
  CheckSyncProjectionJson,
  ProductControlProjectionJson,
  ReplaceProductControlDataRootRequest,
  SelectProductControlDataRootRequest,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/local_runtime';
import {
  createDesktopElectronProductControlHost,
  type DesktopProductControlTransport,
} from '../src-electron/product-control-host';
import { createDesktopDataRootOperationGate } from '../src-electron/data-root-operation-gate';

const GET_RECORD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const GET_SELECTED_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot';
const ENSURE_RECORD = '/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated';
const SELECT_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot';
const REPLACE_DATA_ROOT = '/nimi.runtime.v1.RuntimeLocalService/ReplaceProductControlDataRoot';
const START_CHECK_SYNC = '/nimi.runtime.v1.RuntimeLocalService/StartProductControlCheckSync';
const GET_CHECK_SYNC = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlCheckSync';
const ADMIT_READY = '/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse';

function projectionJson(state = 'data_root_selected'): string {
  return JSON.stringify({
    path: '/Users/tester/Library/Application Support/Nimi/product-control.json',
    exists: true,
    state,
    record: {
      schemaVersion: 2,
      installId: 'install-a',
      productVersion: '1',
      state,
      dataRoot: {
        path: '/Users/tester/NimiData',
        status: state === 'ready_for_use' ? 'ready' : 'selected',
        rootActivationId: 'rootact_test',
        selectedAt: '2026-07-14T00:00:00.000Z',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        selectedAtUnixMs: 1,
        verifiedAtUnixMs: 1,
      },
      firstRun: {
        completed: state === 'ready_for_use',
        completedAt: state === 'ready_for_use' ? '2026-07-14T00:00:00.000Z' : null,
      },
      pointers: {},
      repair: { required: false },
    },
    error: null,
  });
}

function readyProjectionJson(
  dataRoot: string,
  rootActivationId: string,
  handoffDisposition: 'active_current_process' | 'activation_not_bound' | 'committed_restart_required' | 'committed_repair_required' = 'active_current_process',
): string {
  const projection = JSON.parse(projectionJson('ready_for_use')) as Record<string, unknown>;
  const record = projection.record as Record<string, unknown>;
  const root = record.dataRoot as Record<string, unknown>;
  root.path = dataRoot;
  root.rootActivationId = rootActivationId;
  projection.rootHandoff = {
    disposition: handoffDisposition,
    rootActivationId,
    actionHint: handoffDisposition === 'active_current_process'
      ? 'continue'
      : handoffDisposition === 'committed_repair_required'
        ? 'repair_runtime_config'
        : 'restart_runtime_and_check_sync',
  };
  return JSON.stringify(projection);
}

function checkSyncJson(rootActivationId: string, obligationState: 'required' | 'completed' = 'required'): Uint8Array {
  return CheckSyncProjectionJson.toBinary(CheckSyncProjectionJson.create({
    json: JSON.stringify({
      run: {
        runId: `sync_${rootActivationId}`,
        rootActivationId,
        trigger: 'activation',
        state: obligationState === 'completed' ? 'completed' : 'running',
        startedAt: '2026-08-30T00:00:00Z',
        ...(obligationState === 'completed' ? { completedAt: '2026-08-30T00:00:01Z' } : {}),
        owners: [],
        unclaimed: [],
      },
      obligation: { rootActivationId, state: obligationState },
      error: null,
    }),
  }));
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
              rootActivationId: 'rootact_test',
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
  assert.equal(Object.hasOwn(host.commandHandlers, 'product_control_record_set_first_run_install_level'), false);
  assert.equal(Object.hasOwn(host.commandHandlers, 'product_control_record_complete_first_run_device_environment_scan'), false);
  assert.equal(Object.hasOwn(host.commandHandlers, 'product_control_record_reconcile_first_run_setup_state'), false);

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
    ADMIT_READY,
  ]);
  assert.equal(
    SelectProductControlDataRootRequest.fromBinary(calls[3]!.requestBytes).dataRoot,
    '/Users/tester/NimiData',
  );
  assert.deepEqual(
    AdmitProductControlReadyForUseRequest.fromBinary(calls[4]!.requestBytes),
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
              rootActivationId: 'rootact_test',
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

  const supportHost = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => ProductControlProjectionJson.toBinary(
        ProductControlProjectionJson.create({
          json: JSON.stringify({
            path: '/Users/tester/Library/Application Support/Nimi/product-control.json',
            exists: true,
            state: 'repair_required',
            dataRoot: {
              path: '/Users/tester/NimiDataNext',
              status: 'repair_required',
              rootActivationId: 'rootact_repair',
              selectedAt: '2026-07-14T00:00:00.000Z',
              verifiedAt: '2026-07-14T00:00:00.000Z',
              selectedAtUnixMs: 1,
              verifiedAtUnixMs: 1,
            },
            error: 'CONFIG_WRITE_FAILED',
          }),
        }),
      ),
    },
  });
  await assert.rejects(
    supportHost.resolveSelectedDataRoot(),
    /desktop-product-control-selected-data-root-unavailable/u,
  );
  assert.equal(await supportHost.resolveSupportDataRoot(), '/Users/tester/NimiDataNext');
});

test('Electron Product Control supervises committed replacement through fixed Runtime restart', async () => {
  const events: string[] = [];
  let recordReads = 0;
  const control: DesktopProductControlTransport = {
    machineProductUnary: async (input) => {
      events.push(input.methodId);
      if (input.methodId === GET_RECORD) {
        recordReads += 1;
        const json = recordReads === 1
          ? readyProjectionJson('D:/NimiData', 'rootact_old')
          : readyProjectionJson('D:/NimiDataNext', 'rootact_next');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
      }
      const state = JSON.parse(projectionJson('ready_for_use')) as Record<string, unknown>;
      const record = state.record as Record<string, unknown>;
      const dataRoot = record.dataRoot as Record<string, unknown>;
      dataRoot.path = 'D:/NimiDataNext';
      dataRoot.rootActivationId = 'rootact_next';
      if (input.methodId === REPLACE_DATA_ROOT) {
        state.activation = {
          activated: true,
          reasonCode: 'DATA_ROOT_REPLACED',
          actionHint: 'restart_runtime_and_check_sync',
        };
        state.configMutation = {
          disposition: 'restart_required',
          reasonCode: 'CONFIG_RESTART_REQUIRED',
          actionHint: 'request_typed_runtime_restart',
        };
      }
      if (input.methodId === GET_CHECK_SYNC || input.methodId === START_CHECK_SYNC) {
        return CheckSyncProjectionJson.toBinary(CheckSyncProjectionJson.create({
          json: JSON.stringify({
            run: {
              runId: 'sync_next', rootActivationId: 'rootact_next', trigger: 'activation', state: 'running',
              startedAt: '2026-08-30T00:00:00Z', owners: [], unclaimed: [],
            },
            obligation: { rootActivationId: 'rootact_next', state: 'required' }, error: null,
          }),
        }));
      }
      return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json: JSON.stringify(state) }));
    },
  };
  const host = createDesktopElectronProductControlHost({
    control,
    runtimeLifecycleProfile: 'fixed',
    restartRuntime: async () => { events.push('restart'); },
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    commitHostDataRoot: () => { events.push('commit'); },
    activateHostDataRoot: () => { events.push('activate'); },
  });
  const replaced = await host.commandHandlers.product_control_data_root_replace({
    command: 'product_control_data_root_replace',
    payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
  }) as { activation?: { activated?: boolean }; record?: { dataRoot?: { rootActivationId?: string } }; error?: string | null };
  assert.equal(replaced.activation?.activated, true);
  assert.equal(replaced.record?.dataRoot?.rootActivationId, 'rootact_next');
  assert.equal(replaced.error, null);
  assert.deepEqual(events, [GET_RECORD, 'quiesce', REPLACE_DATA_ROOT, 'commit', 'restart', GET_RECORD, GET_CHECK_SYNC, 'activate']);
  const replaceCall = events.indexOf(REPLACE_DATA_ROOT);
  assert.ok(replaceCall >= 0);

  const encodedCalls: Array<{ methodId: string; requestBytes: Uint8Array }> = [];
  const payloadHost = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async (input) => {
        encodedCalls.push({ methodId: input.methodId, requestBytes: input.requestBytes });
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json: projectionJson('ready_for_use') }));
      },
    },
    runtimeLifecycleProfile: 'source',
  });
  await payloadHost.commandHandlers.product_control_data_root_replace({
    command: 'product_control_data_root_replace',
    payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
  });
  const encodedReplace = encodedCalls.find((call) => call.methodId === REPLACE_DATA_ROOT);
  assert.ok(encodedReplace);
  assert.equal(ReplaceProductControlDataRootRequest.fromBinary(encodedReplace.requestBytes).targetRoot, 'D:/NimiDataNext');
});

test('Electron Product Control reopens host root state only when replacement did not commit', async () => {
  const events: string[] = [];
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async (input) => {
        events.push(input.methodId);
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
          json: projectionJson('ready_for_use'),
        }));
      },
    },
    runtimeLifecycleProfile: 'fixed',
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    commitHostDataRoot: () => { events.push('commit'); },
    activateHostDataRoot: () => { events.push('activate'); },
  });

  const result = await host.commandHandlers.product_control_data_root_replace({
    command: 'product_control_data_root_replace',
    payload: { payload: { targetRoot: 'D:/NimiData' } },
  }) as { activation?: { activated?: boolean } | null };

  assert.equal(result.activation, null);
  assert.deepEqual(events, [GET_RECORD, 'quiesce', REPLACE_DATA_ROOT, 'abort']);

  const quiesceEvents: string[] = [];
  const quiesceFailureHost = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => {
        quiesceEvents.push('runtime-call');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
          json: projectionJson('ready_for_use'),
        }));
      },
    },
    quiesceHostDataRoot: async () => {
      quiesceEvents.push('quiesce');
      throw new Error('quiesce-failed');
    },
    abortHostDataRoot: () => { quiesceEvents.push('abort'); },
  });
  await assert.rejects(
    quiesceFailureHost.commandHandlers.product_control_data_root_replace({
      command: 'product_control_data_root_replace',
      payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
    }),
    /quiesce-failed/u,
  );
  assert.deepEqual(quiesceEvents, ['runtime-call', 'quiesce', 'abort']);
});

test('Electron Product Control reconnects source Runtime through the explicit Check & Sync action', async () => {
  const events: string[] = [];
  let recordReads = 0;
  const control: DesktopProductControlTransport = {
    machineProductUnary: async (input) => {
      events.push(input.methodId);
      if (input.methodId === GET_CHECK_SYNC || input.methodId === START_CHECK_SYNC) {
        return CheckSyncProjectionJson.toBinary(CheckSyncProjectionJson.create({
          json: JSON.stringify({
            run: {
              runId: 'sync_next', rootActivationId: 'rootact_next', trigger: 'activation', state: 'running',
              startedAt: '2026-08-30T00:00:00Z', owners: [], unclaimed: [],
            },
            obligation: { rootActivationId: 'rootact_next', state: 'required' }, error: null,
          }),
        }));
      }
      if (input.methodId === GET_RECORD) {
        recordReads += 1;
        const json = recordReads === 1
          ? readyProjectionJson('D:/NimiData', 'rootact_old')
          : readyProjectionJson('D:/NimiDataNext', 'rootact_next');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
      }
      const state = JSON.parse(projectionJson('ready_for_use')) as Record<string, unknown>;
      const record = state.record as Record<string, unknown>;
      const dataRoot = record.dataRoot as Record<string, unknown>;
      dataRoot.path = 'D:/NimiDataNext';
      dataRoot.rootActivationId = 'rootact_next';
      if (input.methodId === REPLACE_DATA_ROOT) {
        state.activation = {
          activated: true,
          reasonCode: 'DATA_ROOT_REPLACED',
          actionHint: 'restart_runtime_and_check_sync',
        };
        state.configMutation = {
          disposition: 'restart_required',
          reasonCode: 'CONFIG_RESTART_REQUIRED',
          actionHint: 'request_typed_runtime_restart',
        };
      }
      return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json: JSON.stringify(state) }));
    },
  };
  const host = createDesktopElectronProductControlHost({
    control,
    runtimeLifecycleProfile: 'source',
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    commitHostDataRoot: () => { events.push('commit'); },
    activateHostDataRoot: () => { events.push('activate'); },
  });

  const replacement = await host.commandHandlers.product_control_data_root_replace({
    command: 'product_control_data_root_replace',
    payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
  }) as { error?: string | null };
  assert.equal(replacement.error, 'SOURCE_RUNTIME_RESTART_THEN_RUN_CHECK_SYNC_REQUIRED_AFTER_DATA_ROOT_ACTIVATION');
  assert.deepEqual(events, [GET_RECORD, 'quiesce', REPLACE_DATA_ROOT, 'commit']);

  await host.commandHandlers.product_control_check_sync_start({
    command: 'product_control_check_sync_start',
    payload: {},
  });
  assert.deepEqual(events, [
    GET_RECORD,
    'quiesce',
    REPLACE_DATA_ROOT,
    'commit',
    GET_RECORD,
    GET_CHECK_SYNC,
    'activate',
    START_CHECK_SYNC,
  ]);
});

test('Electron Product Control uses canonical activation to resolve a lost replacement response', async () => {
  const events: string[] = [];
  let recordReads = 0;
  const gate = createDesktopDataRootOperationGate();
  const host = createDesktopElectronProductControlHost({
    operationGate: gate,
    runtimeLifecycleProfile: 'fixed',
    restartRuntime: async () => { events.push('restart'); },
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    commitHostDataRoot: () => { events.push('commit'); },
    activateHostDataRoot: () => { events.push('activate'); },
    control: {
      machineProductUnary: async (input) => {
        events.push(input.methodId);
        if (input.methodId === GET_RECORD) {
          recordReads += 1;
          const json = recordReads === 1
            ? readyProjectionJson('D:/NimiData', 'rootact_old')
            : recordReads === 2
              ? readyProjectionJson('D:/NimiDataNext', 'rootact_next', 'committed_restart_required')
              : readyProjectionJson('D:/NimiDataNext', 'rootact_next');
          return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
        }
        if (input.methodId === REPLACE_DATA_ROOT) {
          throw new Error('transport-lost');
        }
        if (input.methodId === GET_CHECK_SYNC) return checkSyncJson('rootact_next');
        throw new Error(`unexpected-method:${input.methodId}`);
      },
    },
  });

  const result = await host.commandHandlers.product_control_data_root_replace({
    command: 'product_control_data_root_replace',
    payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
  }) as { error?: string | null; record?: { dataRoot?: { rootActivationId?: string } } };

  assert.equal(result.record?.dataRoot?.rootActivationId, 'rootact_next');
  assert.equal(result.error, 'REPLACEMENT_TRANSPORT_LOST_AFTER_DATA_ROOT_ACTIVATION');
  assert.equal(gate.isClosed(), false);
  assert.deepEqual(events, [
    GET_RECORD,
    'quiesce',
    REPLACE_DATA_ROOT,
    GET_RECORD,
    'commit',
    'restart',
    GET_RECORD,
    GET_CHECK_SYNC,
    'activate',
  ]);
});

test('Electron Product Control resumes the former Host root only after canonical non-commit evidence', async () => {
  const events: string[] = [];
  const gate = createDesktopDataRootOperationGate();
  const host = createDesktopElectronProductControlHost({
    operationGate: gate,
    runtimeLifecycleProfile: 'fixed',
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    control: {
      machineProductUnary: async (input) => {
        events.push(input.methodId);
        if (input.methodId === REPLACE_DATA_ROOT) throw new Error('transport-lost-before-commit');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
          json: readyProjectionJson('D:/NimiData', 'rootact_old'),
        }));
      },
    },
  });

  await assert.rejects(
    host.commandHandlers.product_control_data_root_replace({
      command: 'product_control_data_root_replace',
      payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
    }),
    /transport-lost-before-commit/u,
  );
  assert.equal(gate.isClosed(), false);
  assert.deepEqual(events, [GET_RECORD, 'quiesce', REPLACE_DATA_ROOT, GET_RECORD, 'abort']);
});

test('Electron Product Control does not adopt a different committed target after response loss', async () => {
  let recordReads = 0;
  const events: string[] = [];
  const gate = createDesktopDataRootOperationGate();
  const host = createDesktopElectronProductControlHost({
    operationGate: gate,
    runtimeLifecycleProfile: 'fixed',
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    commitHostDataRoot: () => { events.push('commit'); },
    control: {
      machineProductUnary: async (input) => {
        events.push(input.methodId);
        if (input.methodId === REPLACE_DATA_ROOT) throw new Error('transport-lost');
        recordReads += 1;
        const json = recordReads === 1
          ? readyProjectionJson('D:/NimiData', 'rootact_old')
          : readyProjectionJson('D:/AnotherRoot', 'rootact_other', 'committed_restart_required');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({ json }));
      },
    },
  });

  await assert.rejects(
    host.commandHandlers.product_control_data_root_replace({
      command: 'product_control_data_root_replace',
      payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
    }),
    /transport-lost/u,
  );
  assert.equal(gate.isClosed(), true);
  assert.equal(events.includes('abort'), false);
  assert.equal(events.includes('commit'), false);
});

test('Electron Product Control keeps an ambiguous transport failure closed until canonical recovery', async () => {
  const events: string[] = [];
  let recordReads = 0;
  const gate = createDesktopDataRootOperationGate();
  const host = createDesktopElectronProductControlHost({
    operationGate: gate,
    runtimeLifecycleProfile: 'source',
    quiesceHostDataRoot: async () => { events.push('quiesce'); },
    abortHostDataRoot: () => { events.push('abort'); },
    control: {
      machineProductUnary: async (input) => {
        events.push(input.methodId);
        if (input.methodId === GET_RECORD) {
          recordReads += 1;
          if (recordReads === 2) throw new Error('canonical-read-unavailable');
          return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
            json: readyProjectionJson('D:/NimiData', 'rootact_old'),
          }));
        }
        if (input.methodId === REPLACE_DATA_ROOT) throw new Error('transport-lost');
        if (input.methodId === GET_CHECK_SYNC) return checkSyncJson('rootact_old');
        throw new Error(`unexpected-method:${input.methodId}`);
      },
    },
  });

  await assert.rejects(
    host.commandHandlers.product_control_data_root_replace({
      command: 'product_control_data_root_replace',
      payload: { payload: { targetRoot: 'D:/NimiDataNext' } },
    }),
    /transport-lost/u,
  );
  assert.equal(gate.isClosed(), true);
  assert.equal(events.includes('abort'), false);
  await assert.rejects(
    gate.runExclusive(async () => undefined),
    /desktop-data-root-handoff-disposition-ambiguous/u,
  );

  await host.recoverDataRootHandoff();
  assert.equal(gate.isClosed(), false);
  assert.equal(events.at(-1), 'abort');
});

test('Electron Product Control bootstrap opens only a ready activation with a Check & Sync obligation', async () => {
  const readyGate = createDesktopDataRootOperationGate();
  const readyHost = createDesktopElectronProductControlHost({
    operationGate: readyGate,
    activateHostDataRoot: () => undefined,
    control: {
      machineProductUnary: async (input) => {
        if (input.methodId === GET_CHECK_SYNC) return checkSyncJson('rootact_ready', 'completed');
        return ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
          json: readyProjectionJson('D:/NimiData', 'rootact_ready'),
        }));
      },
    },
  });
  await readyHost.bootstrapDataRootHandoff();
  assert.equal(readyGate.isClosed(), false);

  const unboundGate = createDesktopDataRootOperationGate();
  const unboundHost = createDesktopElectronProductControlHost({
    operationGate: unboundGate,
    control: {
      machineProductUnary: async () => ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
        json: readyProjectionJson('D:/NimiData', 'rootact_unbound', 'activation_not_bound'),
      })),
    },
  });
  await unboundHost.bootstrapDataRootHandoff();
  assert.equal(unboundGate.isClosed(), true);

  const repairGate = createDesktopDataRootOperationGate();
  const repairProjection = JSON.parse(readyProjectionJson(
    'D:/NimiDataNext',
    'rootact_repair',
    'committed_repair_required',
  )) as Record<string, unknown>;
  repairProjection.state = 'repair_required';
  const repairRecord = repairProjection.record as Record<string, unknown>;
  repairRecord.state = 'repair_required';
  (repairRecord.dataRoot as Record<string, unknown>).status = 'repair_required';
  (repairRecord.firstRun as Record<string, unknown>).completed = true;
  (repairRecord.firstRun as Record<string, unknown>).completedAt = '2026-08-30T00:00:00Z';
  (repairRecord.repair as Record<string, unknown>).required = true;
  const repairHost = createDesktopElectronProductControlHost({
    operationGate: repairGate,
    control: {
      machineProductUnary: async () => ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
        json: JSON.stringify(repairProjection),
      })),
    },
  });
  await repairHost.bootstrapDataRootHandoff();
  assert.equal(repairGate.isClosed(), true);
  await assert.rejects(
    repairHost.commandHandlers.product_control_check_sync_start({
      command: 'product_control_check_sync_start',
      payload: {},
    }),
    /desktop-product-control-data-root-repair-required/u,
  );
});

test('Electron Product Control rejects an inconsistent Runtime root-handoff disposition', async () => {
  const raw = JSON.parse(readyProjectionJson(
    'D:/NimiData',
    'rootact_current',
    'committed_restart_required',
  )) as Record<string, unknown>;
  (raw.rootHandoff as Record<string, unknown>).actionHint = 'continue';
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => ProductControlProjectionJson.toBinary(ProductControlProjectionJson.create({
        json: JSON.stringify(raw),
      })),
    },
  });

  await assert.rejects(
    host.commandHandlers.product_control_record_get({
      command: 'product_control_record_get',
      payload: {},
    }),
    /runtime-product-control-response-invalid/u,
  );
});

test('Electron Product Control admits only the executable Check & Sync owner action', async () => {
  let nextAction = 'rerun_check_sync';
  const host = createDesktopElectronProductControlHost({
    control: {
      machineProductUnary: async () => CheckSyncProjectionJson.toBinary(CheckSyncProjectionJson.create({
        json: JSON.stringify({
          run: {
            runId: 'sync_action', rootActivationId: 'rootact_action', trigger: 'manual', state: 'completed',
            startedAt: '2026-08-30T00:00:00Z', completedAt: '2026-08-30T00:00:01Z',
            owners: [{
              ownerId: 'dependencies_environments', state: 'completed',
              resources: [{ kind: 'python_profile', status: 'unavailable', reason: 'PROFILE_RETRY_REQUIRED', nextAction }],
            }],
            unclaimed: [],
          },
          obligation: { rootActivationId: 'rootact_action', state: 'completed' },
          error: null,
        }),
      })),
    },
  });
  const projection = await host.commandHandlers.product_control_check_sync_get({
    command: 'product_control_check_sync_get', payload: {},
  }) as { run?: { owners?: Array<{ resources?: Array<{ nextAction?: string }> }> } };
  assert.equal(projection.run?.owners?.[0]?.resources?.[0]?.nextAction, 'rerun_check_sync');

  nextAction = 'rebuild_from_local_lock_cache';
  await assert.rejects(
    host.commandHandlers.product_control_check_sync_get({ command: 'product_control_check_sync_get', payload: {} }),
    /runtime-check-sync-response-invalid/u,
  );
});
