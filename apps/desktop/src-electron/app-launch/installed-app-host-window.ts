import path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type RegisteredNimiElectronRuntimeBridge,
  type RuntimeGrpcBridgeClient,
} from '@nimiplatform/kit/shell/electron/main';

export type RuntimeAttestedInstalledStandardShell = {
  readonly capabilitySetRef: string;
};

export type DesktopInstalledAppHostWindowInput = {
  readonly appId: string;
  readonly rendererUrl: string;
  readonly preloadPath: string;
  readonly runtimeEndpointLabel: string;
  readonly standardShell: RuntimeAttestedInstalledStandardShell;
  readonly createProtectedRuntimeClient: () => Promise<RuntimeGrpcBridgeClient> | RuntimeGrpcBridgeClient;
};

export type DesktopInstalledAppHostWindow = {
  readonly window: BrowserWindow;
  readonly close: () => void;
};

/**
 * Creates the isolated Electron host only after Runtime has attested the app
 * and its standard-shell capability-set projection. This function does not
 * launch the installed executable and cannot manufacture an installed session;
 * its client factory must already be bound to the native installed carrier.
 */
export async function createDesktopInstalledAppHostWindow(
  input: DesktopInstalledAppHostWindowInput,
): Promise<DesktopInstalledAppHostWindow> {
  const appId = requiredToken(input.appId, 'appId');
  const rendererUrl = requiredUrl(input.rendererUrl, 'rendererUrl');
  const preloadPath = path.resolve(requiredToken(input.preloadPath, 'preloadPath'));
  if (!path.isAbsolute(input.preloadPath)) {
    throw new Error('Installed app host preloadPath must be absolute');
  }
  requiredToken(input.standardShell.capabilitySetRef, 'capabilitySetRef');
  const runtimeEndpointLabel = requiredToken(input.runtimeEndpointLabel, 'runtimeEndpointLabel');

  const bridge: RegisteredNimiElectronRuntimeBridge = registerNimiElectronRuntimeBridge({
    appId,
    runtimeEndpoint: runtimeEndpointLabel,
    allowedOrigins: [new URL(rendererUrl).origin],
    allowedRendererUrls: [rendererUrl],
    ipcMain,
    createGrpcClient: () => input.createProtectedRuntimeClient(),
    standardShellHost: {
      capabilitySetRef: input.standardShell.capabilitySetRef,
    },
  });

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const close = (): void => {
    bridge.unregister();
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };
  window.once('closed', bridge.unregister);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, nextUrl) => {
    if (!isAllowedElectronRendererUrl(nextUrl, [rendererUrl])) {
      event.preventDefault();
    }
  });
  try {
    await window.loadURL(rendererUrl);
    window.show();
    return { window, close };
  } catch (error) {
    close();
    throw error;
  }
}

function requiredToken(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0')) {
    throw new Error(`Installed app host ${field} is required`);
  }
  return normalized;
}

function requiredUrl(value: string, field: string): string {
  const normalized = requiredToken(value, field);
  const parsed = new URL(normalized);
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`Installed app host ${field} must be an absolute HTTP(S) URL`);
  }
  return parsed.toString();
}
