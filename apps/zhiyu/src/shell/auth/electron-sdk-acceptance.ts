import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { normalizeZhiyuElectronRuntimeUnavailableError } from '../runtime/electron-runtime-unavailable';

type ZhiyuElectronSdkAcceptanceProbeResult =
  | {
    readonly ok: true;
    readonly transport: 'electron-ipc';
    readonly status: unknown;
    readonly reason: unknown;
  }
  | {
    readonly ok: false;
    readonly transport: 'electron-ipc';
    readonly name: string;
    readonly message: string;
    readonly code: unknown;
    readonly reasonCode: unknown;
    readonly actionHint: unknown;
    readonly source: unknown;
    readonly details: unknown;
  };

type ZhiyuElectronSdkAcceptanceProbe = {
  runtimeReady(): Promise<ZhiyuElectronSdkAcceptanceProbeResult>;
};

const ELECTRON_SDK_ACCEPTANCE_QUERY = 'nimiElectronSdkAcceptance';

declare global {
  interface Window {
    __NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__?: ZhiyuElectronSdkAcceptanceProbe;
  }
}

export function installZhiyuElectronSdkAcceptanceProbe(): void {
  if (!shouldInstallZhiyuElectronSdkAcceptanceProbe()) {
    return;
  }
  window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__ = {
    async runtimeReady() {
      const runtime = new Runtime({
        appId: 'nimi.zhiyu',
        transport: { type: 'electron-ipc' },
      });
      try {
        const health = await runtime.ready();
        return {
          ok: true,
          transport: 'electron-ipc',
          status: health.status,
          reason: health.reason,
        };
      } catch (error) {
        return serializeSdkAcceptanceError(error);
      }
    },
  };
}

function shouldInstallZhiyuElectronSdkAcceptanceProbe(): boolean {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return false;
  }
  return new URL(window.location.href).searchParams.get(ELECTRON_SDK_ACCEPTANCE_QUERY) === '1';
}

function serializeSdkAcceptanceError(error: unknown): ZhiyuElectronSdkAcceptanceProbeResult {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const unavailable = normalizeZhiyuElectronRuntimeUnavailableError(error);
  return {
    ok: false,
    transport: 'electron-ipc',
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    code: unavailable?.code ?? record.code,
    reasonCode: unavailable?.reasonCode ?? record.reasonCode,
    actionHint: unavailable?.actionHint ?? record.actionHint,
    source: unavailable?.source ?? record.source,
    details: record.details,
  };
}
