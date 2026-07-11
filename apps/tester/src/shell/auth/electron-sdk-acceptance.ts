import { hasElectronRuntime, hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { getRuntimePlatformProjection } from './runtime-platform.js';
import { createTesterRuntimeTransportConfig } from './runtime-transport.js';
import { testerInstalledAppBootstrap } from '../installed-app-bootstrap.js';

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
  installedProjection(): Promise<TesterElectronSdkAcceptanceProbeResult>;
  installedArtifactRead(): Promise<TesterElectronSdkAcceptanceProbeResult>;
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
    async installedProjection() {
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
    async installedArtifactRead() {
      const transport = acceptanceTransport();
      try {
        const artifact = await testerInstalledAppBootstrap.artifacts.readRuntimeBytes(
          'runtime-artifact-sdk-acceptance',
        );
        return {
          ok: true,
          transport,
          status: 'installed-artifact-readable',
          reason: {
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
            mimeInferred: artifact.mimeInferred,
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
