import { describe, expect, it, vi } from 'vitest';
import {
  createNimiElectronDesktopAccountHostForBinding,
  type NimiElectronDesktopAccountBinding,
} from '../src/main/desktop-account-host.js';
import { registerNimiElectronRuntimeBridge } from '../src/main/host.js';
import type { DesktopAccountSessionStatus } from '../../shared/runtime-account-projection.js';

type NativeOutcome = Awaited<ReturnType<NimiElectronDesktopAccountBinding['desktopAccountSessionEventsNext']>>;

const projection = (sequence = '1'): DesktopAccountSessionStatus => ({
  sequence, state: 'authenticated', reasonCode: 1, accountReasonCode: 1,
  authorizationRevision: 'opaque-revision-1',
  accountProjection: { accountId: 'account-1', displayName: 'Nimi User', realmEnvironmentId: 'realm-1' },
});
const eventOutcome = (sequence = '1'): NativeOutcome => ({
  status: 'ok', value: { completed: false, event: {
    ...projection(sequence), deliveryKind: 'snapshot', replayTruncated: false,
  } },
});

function binding(overrides: Partial<NimiElectronDesktopAccountBinding> = {}): NimiElectronDesktopAccountBinding {
  const unavailable = async () => ({ status: 'error' as const, reasonCode: 'runtime-service-unavailable', retryable: true });
  return {
    desktopAccountSessionStatus: unavailable,
    desktopAccountSessionEventsOpen: unavailable,
    desktopAccountSessionEventsNext: unavailable,
    desktopAccountSessionEventsClose: async () => ({ status: 'ok', value: { closed: true } }),
    desktopAccountBeginLogin: unavailable,
    desktopAccountCompleteLogin: unavailable,
    desktopAccountInvokeRealmUnary: unavailable,
    desktopAccountLogout: unavailable,
    desktopAccountSwitchAccount: unavailable,
    ...overrides,
  };
}

describe('Desktop main account observation', () => {
  it('reads fresh native status and rejects credential-adjacent projection fields', async () => {
    let sequence = '1';
    const status = vi.fn(async () => ({ status: 'ok' as const, value: projection(sequence) }));
    const host = createNimiElectronDesktopAccountHostForBinding(binding({ desktopAccountSessionStatus: status }));
    expect((await host.readSessionStatus()).sequence).toBe('1');
    sequence = '2';
    expect((await host.readSessionStatus()).sequence).toBe('2');
    expect(status).toHaveBeenCalledTimes(2);
    const invalid = createNimiElectronDesktopAccountHostForBinding(binding({
      desktopAccountSessionStatus: async () => ({ status: 'ok', value: { ...projection(), accessToken: 'forbidden' } }),
    }));
    await expect(invalid.readSessionStatus()).rejects.toThrow('forbidden fields');
    host.close(); invalid.close();
  });

  it('shares a native stream, survives renderer invalidation and discards late events after unsubscribe', async () => {
    const pending: Array<(value: NativeOutcome) => void> = [];
    const open = vi.fn(async () => ({ status: 'ok' as const, value: { streamId: 'main-observer' } }));
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
    const host = createNimiElectronDesktopAccountHostForBinding(binding({
      desktopAccountSessionEventsOpen: open,
      desktopAccountSessionEventsNext: () => new Promise((resolve) => pending.push(resolve)),
      desktopAccountSessionEventsClose: close,
    }));
    const first: Array<DesktopAccountSessionStatus | null> = [];
    const second: Array<DesktopAccountSessionStatus | null> = [];
    const stopFirst = host.subscribeSessionProjection((value) => {
      first.push(value);
      if (value?.accountProjection) value.accountProjection.displayName = 'consumer mutation';
    });
    const stopSecond = host.subscribeSessionProjection((value) => second.push(value));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!(eventOutcome());
    await vi.waitFor(() => expect(second).toHaveLength(2));
    expect(open).toHaveBeenCalledExactlyOnceWith({ afterSequence: '0' });
    expect(second[1]?.accountProjection?.displayName).toBe('Nimi User');
    host.closeRendererStreams();
    expect(close).not.toHaveBeenCalled();
    pending.shift()!(eventOutcome('2'));
    await vi.waitFor(() => expect(second.at(-1)?.sequence).toBe('2'));
    stopFirst();
    expect(close).not.toHaveBeenCalled();
    stopSecond();
    expect(close).toHaveBeenCalledExactlyOnceWith({ streamId: 'main-observer' });
    const delivered = second.length;
    pending.shift()!(eventOutcome('3'));
    await Promise.resolve(); await Promise.resolve();
    expect(second).toHaveLength(delivered);
    host.close();
  });

  it('closes a late native open after its last listener has gone', async () => {
    let resolveOpen!: (value: NativeOutcome) => void;
    const close = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
    const host = createNimiElectronDesktopAccountHostForBinding(binding({
      desktopAccountSessionEventsOpen: () => new Promise((resolve) => { resolveOpen = resolve; }),
      desktopAccountSessionEventsClose: close,
    }));
    const listener = vi.fn();
    const stop = host.subscribeSessionProjection(listener);
    stop();
    resolveOpen({ status: 'ok', value: { streamId: 'late-open' } });
    await vi.waitFor(() => expect(close).toHaveBeenCalledExactlyOnceWith({ streamId: 'late-open' }));
    expect(listener).toHaveBeenCalledExactlyOnceWith(null);
    host.close();
  });

  it('invalidates observation before a failed stream finishes closing', async () => {
    const pending: Array<(value: NativeOutcome) => void> = [];
    let resolveClose!: (value: NativeOutcome) => void;
    const host = createNimiElectronDesktopAccountHostForBinding(binding({
      desktopAccountSessionEventsOpen: async () => ({ status: 'ok', value: { streamId: 'failed-observer' } }),
      desktopAccountSessionEventsNext: () => new Promise((resolve) => pending.push(resolve)),
      desktopAccountSessionEventsClose: () => new Promise((resolve) => { resolveClose = resolve; }),
    }));
    const listener = vi.fn();
    host.subscribeSessionProjection(listener);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!(eventOutcome());
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    pending.shift()!({ status: 'error', reasonCode: 'runtime-service-unavailable', retryable: true });
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(null));
    expect(listener).toHaveBeenCalledTimes(3);
    host.close();
    resolveClose({ status: 'ok', value: { closed: true } });
    await expect(host.readSessionStatus()).rejects.toMatchObject({ reasonCode: 'protected-carrier-required' });
  });

  it('exposes only exact main ports for Desktop and closes them on unregister', async () => {
    const makeBridge = (appId: string) => registerNimiElectronRuntimeBridge({
      appId, runtimeEndpoint: '127.0.0.1:46371', allowedOrigins: ['http://localhost:1430'],
      ipcMain: { handle() {}, removeHandler() {} },
    });
    const app = makeBridge('acme.widget');
    expect(app.readDesktopAccountSessionStatus).toBeUndefined();
    expect(app.subscribeDesktopAccountSessionProjection).toBeUndefined();
    app.unregister();
    const home = makeBridge('nimi.desktop');
    expect(typeof home.readDesktopAccountSessionStatus).toBe('function');
    expect(typeof home.subscribeDesktopAccountSessionProjection).toBe('function');
    expect('invoke' in home).toBe(false);
    home.unregister();
    await expect(home.readDesktopAccountSessionStatus!()).rejects.toMatchObject({ reasonCode: 'protected-carrier-required' });
  });
});
