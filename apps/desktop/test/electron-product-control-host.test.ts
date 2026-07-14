import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiElectronDesktopAccountHost,
  NimiElectronDesktopControlHost,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ProductControlProjectionJson,
  RecordProductControlAccountDefaultProfileEvidenceRequest,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/local_runtime';
import type { DesktopProductControlEvidence } from '../src-electron/product-control-evidence';
import { createDesktopElectronProductControlHost } from '../src-electron/product-control-host';

const GET_RECORD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
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

test('Electron first-run host records Desktop evidence through the exact protected Runtime method', async () => {
  const calls: Array<{ methodId: string; requestBytes: Uint8Array }> = [];
  const control: NimiElectronDesktopControlHost = {
    productControlUnary: async (input) => {
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
    control: { productControlUnary: async () => { throw new Error('not-called'); } },
    account: { invoke: async () => { throw new Error('not-called'); } },
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
