import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { Runtime } from '@nimiplatform/sdk/runtime';

type AvatarElectronSdkAcceptanceProbeResult =
  | {
    ok: true;
    transport: 'electron-ipc';
    status: unknown;
    reason: unknown;
  }
  | {
    ok: false;
    transport: 'electron-ipc';
    name: string;
    message: string;
    code: unknown;
    reasonCode: unknown;
    actionHint: unknown;
    source: unknown;
    details: unknown;
  };

type AvatarElectronSdkAcceptanceProbe = {
  runtimeReady(): Promise<AvatarElectronSdkAcceptanceProbeResult>;
};

const ELECTRON_SDK_ACCEPTANCE_QUERY = 'nimiElectronSdkAcceptance';

declare global {
  interface Window {
    __NIMI_AVATAR_ELECTRON_SDK_ACCEPTANCE__?: AvatarElectronSdkAcceptanceProbe;
  }
}

export function installAvatarElectronSdkAcceptanceProbe(): void {
  if (!shouldInstallAvatarElectronSdkAcceptanceProbe()) {
    return;
  }
  window.__NIMI_AVATAR_ELECTRON_SDK_ACCEPTANCE__ = {
    async runtimeReady() {
      const runtime = new Runtime({
        appId: 'nimi.avatar',
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

function shouldInstallAvatarElectronSdkAcceptanceProbe(): boolean {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return false;
  }
  return new URL(window.location.href).searchParams.get(ELECTRON_SDK_ACCEPTANCE_QUERY) === '1';
}

function serializeSdkAcceptanceError(error: unknown): AvatarElectronSdkAcceptanceProbeResult {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    ok: false,
    transport: 'electron-ipc',
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : String(error),
    code: record.code,
    reasonCode: record.reasonCode,
    actionHint: record.actionHint,
    source: record.source,
    details: record.details,
  };
}
