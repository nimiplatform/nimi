import { describe, expect, it } from 'vitest';

import {
  createNimiElectronDesktopControlHostForBinding,
  isElectronDesktopProductControlMethod,
  isElectronDesktopRuntimeConsumerMethod,
} from '../src/main/desktop-control-host.js';
import { invokeElectronRuntimeUnary } from '../src/main/runtime.js';
import type { RuntimeGrpcBridgeClient } from '../src/main/types.js';

const PRODUCT_CONTROL_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const RUNTIME_CONSUMER_METHOD = '/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets';

describe('Electron verified Desktop control host', () => {
  it('forwards only the exact native product-control family', async () => {
    const calls: unknown[] = [];
    const host = createNimiElectronDesktopControlHostForBinding({
      desktopProductControlUnary: async (input) => {
        calls.push(input);
        return { status: 'ok' as const, value: Uint8Array.from([7, 8, 9]) };
      },
      desktopRuntimeConsumerUnary: async () => ({
        status: 'ok' as const,
        value: Uint8Array.from([10, 11, 12]),
      }),
    });

    await expect(host.productControlUnary({
      methodId: PRODUCT_CONTROL_METHOD,
      requestBytes: Uint8Array.from([1, 2, 3]),
      timeoutMs: 2_000,
    })).resolves.toEqual(Uint8Array.from([7, 8, 9]));
    await expect(host.productControlUnary({
      methodId: '/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets',
      requestBytes: new Uint8Array(),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
    await expect(host.runtimeConsumerUnary({
      methodId: RUNTIME_CONSUMER_METHOD,
      requestBytes: Uint8Array.from([4, 5, 6]),
    })).resolves.toEqual(Uint8Array.from([10, 11, 12]));
    await expect(host.runtimeConsumerUnary({
      methodId: '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels',
      requestBytes: new Uint8Array(),
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
    expect(calls).toEqual([{
      methodId: PRODUCT_CONTROL_METHOD,
      requestBytes: Uint8Array.from([1, 2, 3]),
      timeoutMs: 2_000,
    }]);
  });

  it('routes generated product-control bytes through the native host without public gRPC', async () => {
    let publicUnaryCalls = 0;
    const client: RuntimeGrpcBridgeClient = {
      unary: async () => {
        publicUnaryCalls += 1;
        throw new Error('public Runtime must not carry Desktop product-control');
      },
      serverStream: () => { throw new Error('not used'); },
      close: () => undefined,
    };
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding({
      desktopProductControlUnary: async () => ({
        status: 'ok' as const,
        value: Uint8Array.from([4, 5, 6]),
      }),
      desktopRuntimeConsumerUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-untrusted',
        retryable: false,
      }),
    });

    await expect(invokeElectronRuntimeUnary({
      client,
      payload: {
        methodId: PRODUCT_CONTROL_METHOD,
        requestBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
      },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: '127.0.0.1:46371',
      command: 'runtime_bridge_unary',
      desktopControlHost,
    })).resolves.toEqual({
      responseBytesBase64: Buffer.from([4, 5, 6]).toString('base64'),
    });
    expect(publicUnaryCalls).toBe(0);
  });

  it('fails closed when the Desktop native carrier is absent and preserves typed Runtime reasons', async () => {
    const client: RuntimeGrpcBridgeClient = {
      unary: async () => { throw new Error('not used'); },
      serverStream: () => { throw new Error('not used'); },
      close: () => undefined,
    };
    const base = {
      client,
      payload: { methodId: PRODUCT_CONTROL_METHOD, requestBytesBase64: '' },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: '127.0.0.1:46371',
      command: 'runtime_bridge_unary',
    } as const;

    await expect(invokeElectronRuntimeUnary(base)).rejects.toMatchObject({
      code: 'protected-carrier-required',
      reasonCode: 'protected-carrier-required',
    });

    const deniedHost = createNimiElectronDesktopControlHostForBinding({
      desktopProductControlUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'PRODUCT_CONTROL_TRANSITION_INVALID',
        retryable: false,
      }),
      desktopRuntimeConsumerUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-untrusted',
        retryable: false,
      }),
    });
    await expect(invokeElectronRuntimeUnary({ ...base, desktopControlHost: deniedHost }))
      .rejects.toMatchObject({
        code: 'runtime-permission-denied',
        reasonCode: 'PRODUCT_CONTROL_TRANSITION_INVALID',
        details: { retryable: false },
      });
  });

  it('routes the exact Desktop runtime-consumer family without creating a public gRPC client', async () => {
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding({
      desktopProductControlUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-untrusted',
        retryable: false,
      }),
      desktopRuntimeConsumerUnary: async (input) => ({
        status: 'ok' as const,
        value: Uint8Array.from([input.requestBytes.length, 42]),
      }),
    });

    await expect(invokeElectronRuntimeUnary({
      payload: {
        methodId: RUNTIME_CONSUMER_METHOD,
        requestBytesBase64: Buffer.from([1, 2, 3]).toString('base64'),
      },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
    })).resolves.toEqual({
      responseBytesBase64: Buffer.from([3, 42]).toString('base64'),
    });
  });

  it('fails unadmitted Desktop methods closed before any public gRPC call', async () => {
    let publicUnaryCalls = 0;
    const client: RuntimeGrpcBridgeClient = {
      unary: async () => {
        publicUnaryCalls += 1;
        return { responseBytes: new Uint8Array() };
      },
      serverStream: () => { throw new Error('not used'); },
      close: () => undefined,
    };
    const desktopControlHost = createNimiElectronDesktopControlHostForBinding({
      desktopProductControlUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-untrusted',
        retryable: false,
      }),
      desktopRuntimeConsumerUnary: async () => ({
        status: 'error' as const,
        reasonCode: 'runtime-service-untrusted',
        retryable: false,
      }),
    });

    await expect(invokeElectronRuntimeUnary({
      client,
      payload: {
        methodId: '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels',
        requestBytesBase64: '',
      },
      appId: 'nimi.desktop',
      event: {},
      runtimeEndpoint: 'protected-desktop-control',
      command: 'runtime_bridge_unary',
      desktopControlHost,
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-desktop-runtime-method-not-admitted',
    });
    expect(publicUnaryCalls).toBe(0);
  });

  it('pins all 21 K-RPC-004 selectors and excludes unrelated Runtime methods', () => {
    const admitted = [
      'CollectDeviceProfile', 'ResolveLocalEnvironmentPlan', 'ListLocalEnvironmentDependencyJobs',
      'StartLocalEnvironmentDependencyJob', 'CancelLocalEnvironmentDependencyJob',
      'RetryLocalEnvironmentDependencyJob', 'RepairLocalEnvironmentDependency',
      'ResolveRuntimeBaselineReadiness', 'MintRuntimeBaselineReadiness',
      'ResolveFirstRunExecutionEvidence', 'MintFirstRunExecutionEvidence',
      'GetProductControlRecord', 'GetProductControlSelectedDataRoot',
      'EnsureProductControlRecordCreated', 'SelectProductControlDataRoot',
      'SetProductControlFirstRunInstallLevel', 'CompleteProductControlFirstRunDeviceEnvironmentScan',
      'AdmitProductControlReadyForUse', 'RecordProductControlAccountDefaultProfileEvidence',
      'RecordProductControlFirstRunLocalAiReadyEvidence', 'ReconcileProductControlFirstRunSetupState',
    ];
    expect(admitted).toHaveLength(21);
    for (const method of admitted) {
      expect(isElectronDesktopProductControlMethod(`/nimi.runtime.v1.RuntimeLocalService/${method}`)).toBe(true);
    }
    expect(isElectronDesktopProductControlMethod('/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets')).toBe(false);
    expect(isElectronDesktopProductControlMethod('/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession')).toBe(false);
  });

  it('pins all 11 exact Desktop runtime consumers and excludes raw audit, streams, and adjacent methods', () => {
    const admitted = [
      '/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets',
      '/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog',
      '/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth',
      '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors',
      '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
      '/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth',
      '/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents',
      '/nimi.runtime.v1.RuntimeAuditService/ListUsageStats',
      '/nimi.runtime.v1.RuntimeAiService/PeekScheduling',
      '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
      '/nimi.runtime.v1.RuntimeAgentService/ListAgents',
    ];
    expect(admitted).toHaveLength(11);
    for (const method of admitted) {
      expect(isElectronDesktopRuntimeConsumerMethod(method)).toBe(true);
    }
    expect(isElectronDesktopRuntimeConsumerMethod(
      '/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents',
    )).toBe(false);
    expect(isElectronDesktopRuntimeConsumerMethod(
      '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents',
    )).toBe(false);
    expect(isElectronDesktopRuntimeConsumerMethod(
      '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels',
    )).toBe(false);
    expect(isElectronDesktopRuntimeConsumerMethod(PRODUCT_CONTROL_METHOD)).toBe(false);
  });
});
