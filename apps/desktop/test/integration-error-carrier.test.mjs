import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppClient } from '@nimiplatform/sdk/app';
import { LocalAppSessionState, ReasonCode } from '@nimiplatform/sdk/runtime/generated';
import { OpenLocalAppSessionResponse } from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/auth.js';
import { StartIntegrationConnectionSetupRequest } from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/integration.js';
import { createNimiElectronDesktopControlHostForBinding } from '../../../kit/shell/electron/src/main/desktop-control-host.js';
import { createNimiElectronFormalAppLocalHostOwner } from '../../../kit/shell/electron/src/main/formal-app-local-host.js';
import { dispatchElectronLocalAppCommand } from '../../../kit/shell/electron/src/main/local-app-commands.js';
import { toSerializedElectronShellError } from '../../../kit/shell/electron/src/main/errors.js';
import { installNimiElectronRuntimeBridge } from '../../../kit/shell/electron/src/preload/index.js';
import { createNimiLocalAppStandardShellSurface } from '../../../kit/shell/renderer/src/bridge/local-app.js';
import { integrationErrorCode } from '../src/shell/renderer/features/integrations/integration-error.js';

test('formal Home setup rejection reaches the SDK consumer through actual IPC and preload projection', async () => {
  const session = OpenLocalAppSessionResponse.toBinary(OpenLocalAppSessionResponse.create({
    state: LocalAppSessionState.READY, reasonCode: ReasonCode.ACTION_EXECUTED,
    currentUserReasonCode: ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE,
  }));
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__NIMI_ELECTRON_RUNTIME__');
  let calls = 0;
  const unused = async () => { throw new Error('unexpected native operation'); };
  const control = createNimiElectronDesktopControlHostForBinding({
    desktopMachineProductUnary: unused,
    desktopAccountProductClientStream: unused,
    desktopMachineProductStreamOpen: unused,
    desktopAccountProductStreamOpen: unused,
    desktopFirstPartyProductStreamNext: unused,
    desktopFirstPartyProductStreamClose: unused,
    desktopBundledAvatarUnary: unused,
    desktopBundledAvatarClientStream: unused,
    desktopBundledAvatarStreamOpen: unused,
    desktopBundledAvatarStreamNext: unused,
    desktopBundledAvatarStreamClose: unused,
    desktopAccountProductUnary: async ({ methodId, requestBytes }) => {
      if (methodId.endsWith('/OpenLocalAppSession')) return { status: 'ok', value: session };
      assert.equal(methodId, '/nimi.runtime.v1.RuntimeIntegrationService/StartIntegrationConnectionSetup');
      const request = StartIntegrationConnectionSetupRequest.fromBinary(requestBytes);
      assert.equal(request.adapter, 'onebot-v11');
      assert.equal(request.config?.onebotV11?.listener, '127.0.0.1:0');
      calls++;
      // Native boundary fixture; the Go-status/Rust-carrier regression covers
      // the serialized upstream source of this exact owner error separately.
      return { status: 'error', reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE', retryable: false,
        reasonMetadata: { integration_reason: 'INTEGRATION_CONFIGURATION_INVALID' } };
    },
    desktopFirstPartyProductUnaryRelease: async () => ({ status: 'ok', value: { released: true } }),
    desktopFirstPartyProductUnaryCancel: async () => { throw new Error('unexpected cancellation'); },
  });
  const owner = createNimiElectronFormalAppLocalHostOwner({ profile: 'desktop', appId: 'nimi.desktop', control });
  try {
    await owner.host.sessionStatus();
    installNimiElectronRuntimeBridge({
      contextBridge: { exposeInMainWorld: (key, api) => Object.defineProperty(globalThis, key, { value: api, configurable: true }) },
      ipcRenderer: {
        invoke: async (_channel, envelope) => {
          const request = envelope;
          try {
            return { ok: true, value: await dispatchElectronLocalAppCommand({ host: owner.host, command: request.command, payload: request.payload.payload }) };
          } catch (error) {
            return JSON.parse(JSON.stringify({ ok: false, error: toSerializedElectronShellError(error, 'source') }));
          }
        },
        on: () => { throw new Error('unexpected event subscription'); },
        removeListener: () => undefined,
      },
    });
    const client = createNimiLocalAppClient({ standardShell: createNimiLocalAppStandardShellSurface() });
    const error = await client.integration.startConnectionSetup({
      targetRef: '', adapter: 'onebot-v11', displayName: 'Invalid configuration regression', accountLabel: '',
      config: { onebotV11: { listener: '127.0.0.1:0', selfId: 'invalid-account' } },
    }).then(() => assert.fail('owner rejection became success'), error => error);
    assert.equal(calls, 1, `setup did not reach the native boundary: ${error.reasonCode} ${error.message}`);
    assert.equal(error.reasonCode, 'local-app-operation-unavailable');
    assert.equal(integrationErrorCode(error), 'INTEGRATION_CONFIGURATION_INVALID');
    assert.equal(error.details.reasonMetadata.integration_reason, 'INTEGRATION_CONFIGURATION_INVALID');
  } finally {
    await owner.dispose();
    if (previous) Object.defineProperty(globalThis, '__NIMI_ELECTRON_RUNTIME__', previous);
    else Reflect.deleteProperty(globalThis, '__NIMI_ELECTRON_RUNTIME__');
  }
});
