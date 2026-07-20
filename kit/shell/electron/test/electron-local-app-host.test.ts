import { describe, expect, it } from 'vitest';

import {
  createNimiElectronLocalAppHostForBinding,
  primeNimiElectronLocalAppHost,
  resolveNimiElectronProtectedLocalBindingPackage,
  startNimiElectronLocalAppHostMaintenance,
} from '../src/main/local-app-host.js';
import { vi } from 'vitest';

describe('Electron protected local-app host', () => {
  it('can bootstrap the request-empty session before renderer navigation', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(primeNimiElectronLocalAppHost(host)).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: 'localAppSessionStatus' }]);
  });

  it('rotates the technical session in main and stops maintenance exactly', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const host = createNimiElectronLocalAppHostForBinding(binding(calls));
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000);

      await maintenance.ready;
      expect(calls.map(({ method }) => method)).toEqual(['localAppSessionStatus']);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.map(({ method }) => method)).toEqual([
        'localAppSessionStatus',
        'localAppSessionRenew',
      ]);
      maintenance.close();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes maintenance and reports one typed failure when rotation fails', async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ method: string; input?: unknown }> = [];
      const candidate = {
        ...binding(calls),
        localAppSessionRenew: async () => {
          calls.push({ method: 'localAppSessionRenew' });
          return { status: 'error' as const, reasonCode: 'revoked', retryable: false };
        },
      };
      const host = createNimiElectronLocalAppHostForBinding(candidate);
      const failures: Array<{ reasonCode: string; retryable: boolean }> = [];
      const maintenance = startNimiElectronLocalAppHostMaintenance(host, 1_000, (failure) => {
        failures.push(failure);
      });

      await maintenance.ready;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(failures).toEqual([{ reasonCode: 'revoked', retryable: false }]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls.filter(({ method }) => method === 'localAppSessionRenew')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards only session, product permission, and app-private storage operations', async () => {
    const calls: Array<{ method: string; input?: unknown }> = [];
    const host = createNimiElectronLocalAppHostForBinding(binding(calls));

    await expect(host.sessionStatus()).resolves.toEqual(statusProjection());
    await expect(host.permissionStatus({ permissionId: 'agents.interact' })).resolves.toMatchObject({
      state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
    });
    await expect(host.permissionRequest({ permissionId: 'agents.interact', reason: 'Continue the conversation' }))
      .resolves.toMatchObject({ state: 'unavailable', permissionId: 'agents.interact', canRequest: false });
    await expect(host.storageReadJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ value: { version: 1 }, sizeBytes: 13 });
    await expect(host.storageWriteJson({ relativePath: 'agent-chat/state.json', value: { version: 2 } }))
      .resolves.toEqual({ value: { version: 2 }, sizeBytes: 13 });
    await expect(host.storageRemoveJson({ relativePath: 'agent-chat/state.json' }))
      .resolves.toEqual({ removed: false });

    expect(calls.map(({ method }) => method)).toEqual([
      'localAppSessionStatus',
      'localAppPermissionStatus',
      'localAppPermissionRequest',
      'localAppStorageReadJson',
      'localAppStorageWriteJson',
      'localAppStorageRemoveJson',
    ]);
  });

  it('preserves closed product permission reasons and rejects unknown native reasons', async () => {
    for (const reasonCode of ['permission-unavailable', 'request-pending', 'process-replaced', 'account-changed', 'revoked']) {
      const candidate = {
        ...binding([]),
        localAppPermissionStatus: async () => ({ status: 'error' as const, reasonCode, retryable: false }),
      };
      await expect(createNimiElectronLocalAppHostForBinding(candidate).permissionStatus({
        permissionId: 'agents.interact',
      })).rejects.toMatchObject({ reasonCode, retryable: false });
    }
    const unknown = {
      ...binding([]),
      localAppPermissionStatus: async () => ({ status: 'error' as const, reasonCode: 'private-detail', retryable: false }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(unknown).permissionStatus({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({ reasonCode: 'runtime-service-untrusted', retryable: false });
  });

  it('rejects protected authority material returned by the native carrier', async () => {
    const candidate = {
      ...binding([]),
      localAppSessionStatus: async () => ({
        status: 'ok' as const,
        value: { ...statusProjection(), sessionId: 'forbidden' },
      }),
    };
    await expect(createNimiElectronLocalAppHostForBinding(candidate).sessionStatus()).rejects.toMatchObject({
      reasonCode: 'runtime-service-untrusted', retryable: false,
    });
  });

  it('resolves only independently admitted fixed native binding package identities', () => {
    expect(resolveNimiElectronProtectedLocalBindingPackage('win32', 'x64')).toBe(
      '@nimiplatform/kit-protected-local-win32-x64',
    );
    expect(resolveNimiElectronProtectedLocalBindingPackage('darwin', 'arm64')).toBe(
      '@nimiplatform/kit-protected-local-darwin-arm64',
    );
    for (const [platform, architecture] of [['win32', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) {
      expect(() => resolveNimiElectronProtectedLocalBindingPackage(platform, architecture)).toThrow(
        expect.objectContaining({ reasonCode: 'protected-carrier-required', retryable: false }),
      );
    }
  });
});

function statusProjection() {
  return { state: 'ready', reasonCode: 'action-executed', retryable: false };
}

function binding(calls: Array<{ method: string; input?: unknown }>) {
  const record = (method: string, value: unknown) => async (input?: unknown) => {
    calls.push({ method, ...(input === undefined ? {} : { input }) });
    return { status: 'ok' as const, value };
  };
  const unavailable = {
    state: 'unavailable', permissionId: 'agents.interact', canRequest: false,
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
  };
  return {
    localAppSessionStatus: record('localAppSessionStatus', statusProjection()),
    localAppSessionRenew: record('localAppSessionRenew', statusProjection()),
    localAppPermissionStatus: record('localAppPermissionStatus', unavailable),
    localAppPermissionRequest: record('localAppPermissionRequest', unavailable),
    localAppStorageReadJson: record('localAppStorageReadJson', { value: { version: 1 }, sizeBytes: 13 }),
    localAppStorageWriteJson: record('localAppStorageWriteJson', { value: { version: 2 }, sizeBytes: 13 }),
    localAppStorageRemoveJson: record('localAppStorageRemoveJson', { removed: false }),
  };
}
