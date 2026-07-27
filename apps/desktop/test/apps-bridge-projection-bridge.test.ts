import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { getAppsBridgeProjection } from '../src/shell/renderer/bridge/runtime-bridge/apps-projection.js';

type ShellTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

afterEach(() => {
  delete (globalThis as ShellTestGlobal).__NIMI_ELECTRON_TEST__;
});

test('Desktop apps bridge projection uses standard platformProjection.get', async () => {
  const calls: Array<{ command: string; payload: unknown }> = [];
  (globalThis as ShellTestGlobal).__NIMI_ELECTRON_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      return {
        projectionId: 'apps-bridge',
        record: appsBridgeRecordFixture(),
      };
    },
    listen: () => () => undefined,
  };

  const projection = await getAppsBridgeProjection();

  assert.deepEqual(calls, [{
    command: NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get'],
    payload: { payload: { projectionId: 'apps-bridge' } },
  }]);
  assert.deepEqual(projection.registryRows.map((row) => row.appId), ['nimi.example-app']);
  assert.deepEqual(projection.releaseDescriptors.map((descriptor) => descriptor.appId), ['nimi.example-app']);
});

function appsBridgeRecordFixture(): Record<string, unknown> {
  return {
    registryRows: [{
      appId: 'nimi.example-app',
      appKind: 'nimi-app',
      displayName: 'Example App',
      publisher: 'Nimi',
      trustTier: 'nimi-first-party',
      ordinaryVisibility: 'ordinary-visible',
      aiProfileSelectionRef: 'local-standard',
      capabilitySet: ['text.generate'],
      releaseDescriptorRef: 'nimi.example-app.bundled-with-nimi',
      installStoragePolicyRef: 'nimi-data-app-roots',
      sourceRule: 'P-NAPP-004',
      admissionStatus: 'admitted',
    }, {
      appId: 'nimi.hidden-app',
      appKind: 'nimi-app',
      displayName: 'Hidden App',
      publisher: 'Nimi',
      trustTier: 'nimi-first-party',
      ordinaryVisibility: 'hidden-internal',
      aiProfileSelectionRef: 'local-standard',
      capabilitySet: ['text.generate'],
      releaseDescriptorRef: 'nimi.hidden-app.bundled-with-nimi',
      installStoragePolicyRef: 'nimi-data-app-roots',
      sourceRule: 'P-NAPP-004',
      admissionStatus: 'admitted',
    }],
    releaseDescriptors: [{
      descriptorId: 'nimi.example-app.bundled-with-nimi',
      appId: 'nimi.example-app',
      version: '1.0.0',
      descriptorClass: 'bundled-with-nimi',
      sourceKind: 'nimi-bundle',
      sourceRef: 'nimi-release',
      artifactLocator: 'bundle:nimi.example-app',
      digestAlgorithm: 'sha256',
      sha256: 'abc',
      size: '42',
      provenanceRef: 'provenance:nimi',
      packageKind: 'nimi-app',
      entryRef: 'index.html',
      sandboxRef: 'sandbox:nimi.example-app',
      permissionsRef: 'permissions:nimi.example-app',
      storagePolicyRef: 'nimi-data-app-roots',
      admissionPath: 'config/platform-nimi-app-registry.yaml',
      mutableSourceAllowed: false,
      installDigestVerificationRequired: 'required',
      sourceRule: 'P-NAPP-004',
    }, {
      descriptorId: 'nimi.hidden-app.bundled-with-nimi',
      appId: 'nimi.hidden-app',
      version: '1.0.0',
      descriptorClass: 'bundled-with-nimi',
      sourceKind: 'nimi-bundle',
      sourceRef: 'nimi-release',
      artifactLocator: 'bundle:nimi.hidden-app',
      digestAlgorithm: 'sha256',
      sha256: 'def',
      size: '42',
      provenanceRef: 'provenance:nimi',
      packageKind: 'nimi-app',
      entryRef: 'index.html',
      sandboxRef: 'sandbox:nimi.hidden-app',
      permissionsRef: 'permissions:nimi.hidden-app',
      storagePolicyRef: 'nimi-data-app-roots',
      admissionPath: 'config/platform-nimi-app-registry.yaml',
      mutableSourceAllowed: false,
      installDigestVerificationRequired: 'required',
      sourceRule: 'P-NAPP-004',
    }],
  };
}
