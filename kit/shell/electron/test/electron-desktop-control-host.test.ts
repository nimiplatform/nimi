import { describe, expect, it } from 'vitest';

import { ReasonCode } from '@nimiplatform/kit/core/sdk-contract';

import {
  createNimiElectronDesktopControlHostForBinding,
  isElectronDesktopAccountProductMethod,
  isElectronDesktopMachineProductMethod,
  type NimiElectronDesktopControlBinding,
} from '../src/main/desktop-control-host.js';
import { invokeElectronRuntimeUnary } from '../src/main/runtime.js';
import type { RuntimeGrpcBridgeClient } from '../src/main/types.js';

const MACHINE_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const ACCOUNT_METHOD = '/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource';

function binding(overrides: Partial<NimiElectronDesktopControlBinding> = {}): NimiElectronDesktopControlBinding {
  const bytesError = async () => ({
    status: 'error' as const,
    reasonCode: 'runtime-service-untrusted',
    retryable: false,
  });
  const jsonError = async () => ({
    status: 'error' as const,
    reasonCode: 'runtime-service-untrusted',
    retryable: false,
  });
  return {
    desktopMachineProductUnary: bytesError,
    desktopAccountProductUnary: bytesError,
    desktopMachineProductStreamOpen: jsonError,
    desktopAccountProductStreamOpen: jsonError,
    desktopFirstPartyProductStreamNext: async () => ({
      status: 'error' as const,
      reasonCode: 'runtime-service-untrusted',
      retryable: false,
    }),
    desktopFirstPartyProductStreamClose: async () => ({ status: 'ok' as const, value: {} }),
    desktopBundledAvatarUnary: bytesError,
    desktopBundledAvatarStreamOpen: jsonError,
    desktopBundledAvatarStreamNext: async () => ({
      status: 'error' as const,
      reasonCode: 'runtime-service-untrusted',
      retryable: false,
    }),
    desktopBundledAvatarStreamClose: async () => ({ status: 'ok' as const, value: {} }),
    ...overrides,
  };
}

function unusedPublicClient(onUnary?: () => void): RuntimeGrpcBridgeClient {
  return {
    unary: async () => {
      onUnary?.();
      throw new Error('public Runtime must not carry Desktop product profiles');
    },
    serverStream: () => { throw new Error('not used'); },
    close: () => undefined,
  };
}

describe('Electron verified Desktop control host', () => {
  it('uses separate generated machine and account unary entrypoints', async () => {
    const calls: string[] = [];
    const host = createNimiElectronDesktopControlHostForBinding(binding({
      desktopMachineProductUnary: async (input) => {
        calls.push(`machine:${input.methodId}`);
        return { status: 'ok', value: Uint8Array.from([1]) };
      },
      desktopAccountProductUnary: async (input) => {
        calls.push(`account:${input.methodId}`);
        return { status: 'ok', value: Uint8Array.from([2]) };
      },
    }));

    await expect(host.machineProductUnary({
      methodId: MACHINE_METHOD,
      requestBytes: new Uint8Array(),
    })).resolves.toEqual(Uint8Array.from([1]));
    await expect(host.accountProductUnary({
      methodId: ACCOUNT_METHOD,
      requestBytes: new Uint8Array(),
    })).resolves.toEqual(Uint8Array.from([2]));
    await expect(host.machineProductUnary({
      methodId: ACCOUNT_METHOD,
      requestBytes: new Uint8Array(),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
    await expect(host.accountProductUnary({
      methodId: MACHINE_METHOD,
      requestBytes: new Uint8Array(),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
    expect(calls).toEqual([`machine:${MACHINE_METHOD}`, `account:${ACCOUNT_METHOD}`]);
  });

  it('routes machine and account bytes without public gRPC', async () => {
    let publicUnaryCalls = 0;
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopMachineProductUnary: async () => ({ status: 'ok', value: Uint8Array.from([4]) }),
      desktopAccountProductUnary: async () => ({ status: 'ok', value: Uint8Array.from([5]) }),
    }));
    const base = {
      client: unusedPublicClient(() => { publicUnaryCalls += 1; }),
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    } as const;

    await expect(invokeElectronRuntimeUnary({
      ...base,
      payload: { methodId: MACHINE_METHOD, requestBytesBase64: '' },
    })).resolves.toEqual({ responseBytesBase64: Buffer.from([4]).toString('base64') });
    await expect(invokeElectronRuntimeUnary({
      ...base,
      payload: { methodId: ACCOUNT_METHOD, requestBytesBase64: '' },
    })).resolves.toEqual({ responseBytesBase64: Buffer.from([5]).toString('base64') });
    expect(publicUnaryCalls).toBe(0);
  });

  it('requires named ListConnectors intent instead of method-precedence routing', async () => {
    const calls: string[] = [];
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopMachineProductUnary: async () => {
        calls.push('machine');
        return { status: 'ok', value: Uint8Array.from([1]) };
      },
      desktopAccountProductUnary: async () => {
        calls.push('account');
        return { status: 'ok', value: Uint8Array.from([2]) };
      },
    }));
    const base = {
      client: unusedPublicClient(),
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    } as const;
    const methodId = '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors';
    await expect(invokeElectronRuntimeUnary({
      ...base,
      payload: { methodId, requestBytesBase64: '', productIntent: 'machine.route-connectors.list' },
    })).resolves.toEqual({ responseBytesBase64: Buffer.from([1]).toString('base64') });
    await expect(invokeElectronRuntimeUnary({
      ...base,
      payload: { methodId, requestBytesBase64: '', productIntent: 'account.connector-admin.list' },
    })).resolves.toEqual({ responseBytesBase64: Buffer.from([2]).toString('base64') });
    await expect(invokeElectronRuntimeUnary({
      ...base,
      payload: { methodId, requestBytesBase64: '' },
    })).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    expect(calls).toEqual(['machine', 'account']);
  });

  it('requires the exact Desktop sender before native dispatch', async () => {
    let nativeCalls = 0;
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopMachineProductUnary: async () => {
        nativeCalls += 1;
        return { status: 'ok', value: new Uint8Array() };
      },
    }));
    await expect(invokeElectronRuntimeUnary({
      payload: { methodId: MACHINE_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: false,
    })).rejects.toMatchObject({ reasonCode: 'protected-carrier-required' });
    expect(nativeCalls).toBe(0);
  });

  it('fails profile-external methods before public or native dispatch', async () => {
    let publicUnaryCalls = 0;
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding());
    await expect(invokeElectronRuntimeUnary({
      client: unusedPublicClient(() => { publicUnaryCalls += 1; }),
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeLocalService/InstallLocalService',
        requestBytesBase64: '',
      },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-desktop-runtime-method-not-admitted',
    });
    expect(publicUnaryCalls).toBe(0);
  });

  it('projects typed Runtime reasons without fallback', async () => {
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopAccountProductUnary: async () => ({
        status: 'error',
        reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
        retryable: false,
      }),
    }));
    await expect(invokeElectronRuntimeUnary({
      payload: { methodId: ACCOUNT_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    })).rejects.toMatchObject({
      code: 'runtime-permission-denied',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      details: { retryable: false },
    });
  });

  it('classifies exact generated unary and stream memberships', () => {
    expect(isElectronDesktopMachineProductMethod(MACHINE_METHOD, 'unary')).toBe(true);
    expect(isElectronDesktopMachineProductMethod(
      '/nimi.runtime.v1.RuntimeAiService/StreamScenario',
      'server_stream',
    )).toBe(true);
    expect(isElectronDesktopAccountProductMethod(ACCOUNT_METHOD, 'unary')).toBe(true);
    expect(isElectronDesktopAccountProductMethod(
      '/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages',
      'server_stream',
    )).toBe(true);
    expect(isElectronDesktopMachineProductMethod(ACCOUNT_METHOD, 'unary')).toBe(false);
    expect(isElectronDesktopAccountProductMethod(MACHINE_METHOD, 'unary')).toBe(false);
  });
});
