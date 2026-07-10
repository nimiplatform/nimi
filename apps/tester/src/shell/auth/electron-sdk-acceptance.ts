import { hasElectronRuntime, hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { createRuntimeAccountMediatedRealmTransport } from '@nimiplatform/sdk/app';
import { Realm } from '@nimiplatform/sdk/realm';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { getRuntimeAccountCaller } from './runtime-platform.js';
import { createTesterRuntimeTransportConfig } from './runtime-transport.js';

type TesterElectronSdkAcceptanceProbeResult =
  | {
    ok: true;
    transport: 'electron-ipc' | 'tauri-ipc';
    status: unknown;
    reason: unknown;
  }
  | {
    ok: false;
    transport: 'electron-ipc' | 'tauri-ipc';
    name: string;
    message: string;
    code: unknown;
    reasonCode: unknown;
    actionHint: unknown;
    source: unknown;
    details: unknown;
  };

type TesterElectronSdkAcceptanceProbe = {
  runtimeReady(): Promise<TesterElectronSdkAcceptanceProbeResult>;
  accountProjection(): Promise<TesterElectronSdkAcceptanceProbeResult>;
  sharedAuthBroker(): Promise<TesterElectronSdkAcceptanceProbeResult>;
};

const ELECTRON_SDK_ACCEPTANCE_QUERY = 'nimiElectronSdkAcceptance';

declare global {
  interface Window {
    __NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__?: TesterElectronSdkAcceptanceProbe;
    __NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__?: Array<{ kind: string; message: string }>;
    __NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEM_CAPTURED__?: boolean;
  }
}

export function installTesterShellAcceptanceProblemCapture(): void {
  if (!shouldInstallTesterElectronSdkAcceptanceProbe() || window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEM_CAPTURED__) {
    return;
  }
  window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEM_CAPTURED__ = true;
  window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__ = [];
  const capture = (kind: string, value: unknown) => {
    window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__?.push({
      kind,
      message: value instanceof Error ? value.message : String(value || ''),
    });
  };
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    capture('console.error', args.map((value) => value instanceof Error ? value.message : String(value)).join(' '));
    originalConsoleError(...args);
  };
  window.addEventListener('error', (event) => capture('window.error', event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => capture('unhandledrejection', event.reason));
}

export function installTesterElectronSdkAcceptanceProbe(): void {
  if (!shouldInstallTesterElectronSdkAcceptanceProbe()) {
    return;
  }
  window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__ = {
    async runtimeReady() {
      const transport = acceptanceTransport();
      const runtime = new Runtime({
        appId: 'nimi.tester',
        transport: createTesterRuntimeTransportConfig(),
      });
      try {
        const health = await runtime.ready();
        return {
          ok: true,
          transport,
          status: health.status,
          reason: health.reason,
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error, transport);
      }
    },
    async accountProjection() {
      const transport = acceptanceTransport();
      const runtime = new Runtime({
        appId: 'nimi.tester',
        transport: createTesterRuntimeTransportConfig(),
      });
      try {
        const response = await runtime.account.getAccountSessionStatus({
          caller: getRuntimeAccountCaller(),
        });
        return {
          ok: true,
          transport,
          status: response.state,
          reason: {
            reasonCode: response.reasonCode,
            accountReasonCode: response.accountReasonCode,
            accountProjection: response.accountProjection,
          },
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error, transport);
      }
    },
    async sharedAuthBroker() {
      const transport = acceptanceTransport();
      const runtime = new Runtime({
        appId: 'nimi.tester',
        transport: createTesterRuntimeTransportConfig(),
      });
      const realm = new Realm({
        transport: createRuntimeAccountMediatedRealmTransport({
          runtime,
          accountCaller: getRuntimeAccountCaller(),
        }),
      });
      try {
        const response = await realm.worldPublic.worldPublicControllerListWorlds({ path: {} });
        return {
          ok: true,
          transport,
          status: 'runtime-mediated-realm-ready',
          reason: response.length,
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error, transport);
      }
    },
  };
}

function shouldInstallTesterElectronSdkAcceptanceProbe(): boolean {
  if (typeof window === 'undefined' || (!hasElectronRuntime() && !hasTauriRuntime())) {
    return false;
  }
  return new URL(window.location.href).searchParams.get(ELECTRON_SDK_ACCEPTANCE_QUERY) === '1';
}

function acceptanceTransport(): 'electron-ipc' | 'tauri-ipc' {
  return hasElectronRuntime() ? 'electron-ipc' : 'tauri-ipc';
}

function serializeSdkAcceptanceError(
  error: unknown,
  transport: 'electron-ipc' | 'tauri-ipc',
): TesterElectronSdkAcceptanceProbeResult {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    ok: false,
    transport,
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    code: record.code,
    reasonCode: record.reasonCode,
    actionHint: record.actionHint,
    source: record.source,
    details: record.details,
  };
}
