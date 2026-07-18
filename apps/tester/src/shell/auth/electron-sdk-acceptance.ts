import { hasElectronRuntime, hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { getRuntimePlatformProjection } from './runtime-platform.js';
import { testerLocalAppClient } from '../local-app-runtime-platform.js';

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
  localAppAuthStatus(): Promise<TesterElectronSdkAcceptanceProbeResult>;
  localAppProjection(): Promise<TesterElectronSdkAcceptanceProbeResult>;
  localAppStorageWrite(): Promise<TesterElectronSdkAcceptanceProbeResult>;
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
    async localAppAuthStatus() {
      const transport = acceptanceTransport();
      try {
        const status = await testerLocalAppClient.auth.status();
        return {
          ok: true,
          transport,
          status: status.state,
          reason: {
            sessionBound: status.sessionBound,
            reasonCode: status.reasonCode,
            actionHint: status.actionHint,
          },
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error, transport);
      }
    },
    async localAppProjection() {
      const transport = acceptanceTransport();
      try {
        const projection = await getRuntimePlatformProjection();
        return {
          ok: true,
          transport,
          status: projection.status,
          reason: {
            mode: projection.mode,
            reasonCode: projection.status === 'ready' ? undefined : projection.reasonCode,
            actionHint: projection.status === 'ready' ? undefined : projection.actionHint,
          },
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error, transport);
      }
    },
    async localAppStorageWrite() {
      const transport = acceptanceTransport();
      try {
        const document = await testerLocalAppClient.storage.writeJson(
          'acceptance/app-private.json',
          { source: 'tester-electron-acceptance' },
        );
        return {
          ok: true,
          transport,
          status: 'app-private-storage-writable',
          reason: {
            sizeBytes: document.sizeBytes,
          },
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
