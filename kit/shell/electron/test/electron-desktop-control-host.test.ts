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
const SCENARIO_JOB_METHOD = '/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob';
const SCENARIO_STREAM_METHOD = '/nimi.runtime.v1.RuntimeAiService/StreamScenario';
const FORMAL_AGENT_METHOD = '/nimi.runtime.v1.RuntimeAgentService/InspectLocalAppAgentMemory';
const AVATAR_TARGET_RESOLVE_METHOD = '/nimi.runtime.v1.RuntimeAgentService/ResolveLocalAppAvatarHostTarget';
const AVATAR_TARGET_REVALIDATE_METHOD = '/nimi.runtime.v1.RuntimeAgentService/RevalidateLocalAppAvatarHostTarget';
const AVATAR_METHOD = '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset';

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
    desktopAccountProductClientStream: bytesError,
    desktopFirstPartyProductUnaryCancel: async () => ({ status: 'ok' as const, value: { canceled: false } }),
    desktopFirstPartyProductUnaryRelease: async () => ({ status: 'ok' as const, value: { released: false } }),
    desktopMachineProductStreamOpen: jsonError,
    desktopAccountProductStreamOpen: jsonError,
    desktopFirstPartyProductStreamNext: async () => ({
      status: 'error' as const,
      reasonCode: 'runtime-service-untrusted',
      retryable: false,
    }),
    desktopFirstPartyProductStreamClose: async () => ({ status: 'ok' as const, value: {} }),
    desktopBundledAvatarUnary: bytesError,
    desktopBundledAvatarClientStream: bytesError,
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
    const nativeRequestIds: string[] = [];
    const host = createNimiElectronDesktopControlHostForBinding(binding({
      desktopMachineProductUnary: async (input) => {
        calls.push(`machine:${input.methodId}`);
        nativeRequestIds.push(input.requestId);
        return { status: 'ok', value: Uint8Array.from([1]) };
      },
      desktopAccountProductUnary: async (input) => {
        calls.push(`account:${input.methodId}`);
        nativeRequestIds.push(input.requestId);
        return { status: 'ok', value: Uint8Array.from([2]) };
      },
    }));

    await expect(host.machineProductUnary({
      methodId: MACHINE_METHOD,
      requestBytes: new Uint8Array(),
      requestId: 'caller-selected-shared-request-id',
    })).resolves.toEqual(Uint8Array.from([1]));
    await expect(host.accountProductUnary({
      methodId: ACCOUNT_METHOD,
      requestBytes: new Uint8Array(),
      requestId: 'caller-selected-shared-request-id',
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
    expect(nativeRequestIds[0]).toMatch(/^desktop-protected-machine-unary-/u);
    expect(nativeRequestIds[1]).toMatch(/^desktop-protected-account-unary-/u);
    expect(new Set(nativeRequestIds).size).toBe(2);
    expect(nativeRequestIds).not.toContain('caller-selected-shared-request-id');
  });

  it('retires Desktop self ScenarioJob submission from the raw account product carrier', async () => {
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

    expect(isElectronDesktopMachineProductMethod(SCENARIO_JOB_METHOD, 'unary')).toBe(false);
    expect(isElectronDesktopAccountProductMethod(SCENARIO_JOB_METHOD, 'unary')).toBe(false);
    await expect(invokeElectronRuntimeUnary({
      client: unusedPublicClient(),
      payload: { methodId: SCENARIO_JOB_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    })).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    expect(calls).toEqual([]);
  });

  it('rejects formal App product methods from the renderer raw Runtime bridge', async () => {
    let nativeCalls = 0;
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopAccountProductUnary: async () => {
        nativeCalls += 1;
        return { status: 'ok', value: new Uint8Array() };
      },
    }));
    expect(isElectronDesktopAccountProductMethod(FORMAL_AGENT_METHOD, 'unary')).toBe(true);
    await expect(invokeElectronRuntimeUnary({
      payload: { methodId: FORMAL_AGENT_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    })).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    expect(nativeCalls).toBe(0);
  });

  it('keeps current Avatar target revalidation on the private Desktop account binding', async () => {
    let nativeCalls = 0;
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding({
      desktopAccountProductUnary: async () => {
        nativeCalls += 1;
        return { status: 'ok', value: new Uint8Array() };
      },
    }));
    expect(isElectronDesktopAccountProductMethod(AVATAR_TARGET_REVALIDATE_METHOD, 'unary')).toBe(true);
    await expect(invokeElectronRuntimeUnary({
      payload: { methodId: AVATAR_TARGET_REVALIDATE_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
      desktopSenderAuthorized: true,
    })).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    expect(nativeCalls).toBe(0);
  });

  it('admits Avatar target resolution through the bundled Avatar native profile', async () => {
    const calls: string[] = [];
    const host = createNimiElectronDesktopControlHostForBinding(binding({
      desktopBundledAvatarUnary: async (input) => {
        calls.push(input.methodId);
        return { status: 'ok', value: Uint8Array.from([7, 8, 9]) };
      },
    }));

    await expect(host.bundledAvatarUnary({
      methodId: AVATAR_TARGET_RESOLVE_METHOD,
      requestBytes: Uint8Array.from([1]),
    })).resolves.toEqual(Uint8Array.from([7, 8, 9]));
    expect(calls).toEqual([AVATAR_TARGET_RESOLVE_METHOD]);
    await expect(host.bundledAvatarUnary({
      methodId: AVATAR_TARGET_REVALIDATE_METHOD,
      requestBytes: new Uint8Array(),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted' });
  });

  it('cancels an active account unary in the native binding before rejecting its signal', async () => {
    const controller = new AbortController();
    let finishNative: ((outcome: unknown) => void) | undefined;
    let markNativeStarted: (() => void) | undefined;
    const nativeStarted = new Promise<void>((resolve) => {
      markNativeStarted = resolve;
    });
    const canceledRequestIds: string[] = [];
    const releasedRequestIds: string[] = [];
    let nativeRequestId = '';
    let releaseCancelAcknowledgement: (() => void) | undefined;
    const cancelAcknowledgement = new Promise<void>((resolve) => {
      releaseCancelAcknowledgement = resolve;
    });
    const overrides = {
      desktopAccountProductUnary: async (input: { requestId: string }) => {
        nativeRequestId = input.requestId;
        markNativeStarted?.();
        return new Promise((resolve) => {
          finishNative = resolve;
        });
      },
      desktopFirstPartyProductUnaryCancel: async (input: { requestId: string }) => {
        canceledRequestIds.push(input.requestId);
        finishNative?.({
          status: 'error',
          reasonCode: 'runtime-request-canceled',
          retryable: false,
        });
        await cancelAcknowledgement;
        return { status: 'ok', value: { canceled: true } };
      },
      desktopFirstPartyProductUnaryRelease: async (input: { requestId: string }) => {
        releasedRequestIds.push(input.requestId);
        return { status: 'ok', value: { released: true } };
      },
    } as unknown as Partial<NimiElectronDesktopControlBinding>;
    const host = createNimiElectronDesktopControlHostForBinding(binding(overrides));
    const operation = host.accountProductUnary({
      methodId: ACCOUNT_METHOD,
      requestBytes: new Uint8Array(),
      requestId: 'runtime-client-unary-native-1',
      signal: controller.signal,
    } as never);
    try {
      await nativeStarted;
      controller.abort(new DOMException('voice input canceled', 'AbortError'));
      await Promise.resolve();
      await Promise.resolve();

      expect(nativeRequestId).toMatch(/^desktop-protected-account-unary-/u);
      expect(nativeRequestId).not.toBe('runtime-client-unary-native-1');
      expect(canceledRequestIds).toEqual([nativeRequestId]);
      expect(releasedRequestIds).toEqual([]);
      releaseCancelAcknowledgement?.();
      await expect(operation).rejects.toMatchObject({ reasonCode: 'runtime-request-canceled' });
      expect(releasedRequestIds).toEqual([nativeRequestId]);
    } finally {
      releaseCancelAcknowledgement?.();
      finishNative?.({ status: 'ok', value: new Uint8Array() });
      await operation.catch(() => undefined);
    }
  });

  it('carries request-keyed invalidation through the bundled Avatar unary owner', async () => {
    const controller = new AbortController();
    let finishNative: ((outcome: unknown) => void) | undefined;
    let markNativeStarted: (() => void) | undefined;
    const nativeStarted = new Promise<void>((resolve) => {
      markNativeStarted = resolve;
    });
    const canceledRequestIds: string[] = [];
    let nativeRequestId = '';
    const host = createNimiElectronDesktopControlHostForBinding(binding({
      desktopBundledAvatarUnary: async (input) => {
        nativeRequestId = input.requestId;
        markNativeStarted?.();
        return new Promise((resolve) => {
          finishNative = resolve;
        });
      },
      desktopFirstPartyProductUnaryCancel: async (input) => {
        canceledRequestIds.push(input.requestId);
        finishNative?.({
          status: 'error',
          reasonCode: 'runtime-request-canceled',
          retryable: false,
        });
        return { status: 'ok', value: { canceled: true } };
      },
    }));
    const operation = invokeElectronRuntimeUnary({
      payload: { methodId: AVATAR_METHOD, requestBytesBase64: '' },
      appId: 'nimi.avatar',
      event: {},
      runtimeEndpoint: 'protected-avatar-control',
      command: 'runtime_bridge_unary',
      desktopControlHost: host,
      bundledAvatarProfile: true,
      requestId: 'runtime-client-avatar-unary-1',
      signal: controller.signal,
    });
    try {
      await nativeStarted;
      controller.abort(new DOMException('Avatar sender invalidated', 'AbortError'));
      await Promise.resolve();
      await Promise.resolve();

      expect(nativeRequestId).toMatch(/^desktop-protected-avatar-unary-/u);
      expect(canceledRequestIds).toEqual([nativeRequestId]);
      await expect(operation).rejects.toMatchObject({ reasonCode: 'runtime-request-canceled' });
    } finally {
      finishNative?.({ status: 'ok', value: new Uint8Array() });
      await operation.catch(() => undefined);
    }
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
    expect(isElectronDesktopMachineProductMethod(SCENARIO_STREAM_METHOD, 'server_stream')).toBe(false);
    expect(isElectronDesktopAccountProductMethod(ACCOUNT_METHOD, 'unary')).toBe(true);
    expect(isElectronDesktopAccountProductMethod(
      '/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages',
      'server_stream',
    )).toBe(true);
    expect(isElectronDesktopAccountProductMethod(SCENARIO_STREAM_METHOD, 'server_stream')).toBe(true);
    expect(isElectronDesktopMachineProductMethod(ACCOUNT_METHOD, 'unary')).toBe(false);
    expect(isElectronDesktopAccountProductMethod(MACHINE_METHOD, 'unary')).toBe(false);
  });
});
