import type { BrowserWindowConstructorOptions } from 'electron';
import type {
  ElectronRuntimeBridgeTrustedMetadataProvider,
  NimiElectronIpcMain,
  NimiElectronAIConfigStore,
  NimiElectronStandardDataRootBinding,
  RegisteredNimiElectronRuntimeBridge,
  RegisterNimiElectronRuntimeBridgeInput,
} from '@nimiplatform/kit/shell/electron/main';

export type DesktopInstalledAppStandardShellPlan = {
  readonly capabilitySetRef: string;
  readonly standardDataRootBinding: NimiElectronStandardDataRootBinding;
  readonly localAssetRoots: readonly string[];
  readonly aiConfigStore?: NimiElectronAIConfigStore;
};

export type DesktopInstalledAppRendererLaunchBinding = {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly bindingSource: 'host-owned-installed-app-bridge';
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
  readonly realmBaseUrl: string;
};

export type DesktopInstalledAppHostWindowInput = {
  readonly appId: string;
  readonly preloadPath: string;
  readonly entryUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly runtimeEndpoint: string;
  readonly trustedRuntimeMetadataProvider: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly rendererLaunchBinding: DesktopInstalledAppRendererLaunchBinding;
  readonly standardShell: DesktopInstalledAppStandardShellPlan;
};

export type DesktopInstalledAppHostWindowResult = {
  readonly windowId?: number;
  readonly entryUrl: string;
};

export type DesktopInstalledAppBrowserWindow = {
  readonly id?: number;
  readonly webContents: {
    setWindowOpenHandler: (handler: (details: { readonly url: string }) => { readonly action: 'allow' | 'deny' }) => void;
    on: (event: 'will-navigate', handler: (event: { preventDefault: () => void }, url: string) => void) => void;
  };
  loadURL: (url: string) => Promise<void>;
};

export type DesktopInstalledAppBrowserWindowConstructor = new (
  options: BrowserWindowConstructorOptions,
) => DesktopInstalledAppBrowserWindow;

export function buildDesktopInstalledAppHostWindowOptions(input: {
  readonly appId: string;
  readonly preloadPath: string;
  readonly bridgeInvokeChannel?: string;
  readonly bridgeEventChannelPrefix?: string;
  readonly rendererLaunchBinding?: DesktopInstalledAppRendererLaunchBinding;
}): BrowserWindowConstructorOptions {
  const additionalArguments = [
    input.bridgeInvokeChannel ? `--nimi-electron-runtime-invoke-channel=${input.bridgeInvokeChannel}` : '',
    input.bridgeEventChannelPrefix ? `--nimi-electron-runtime-event-channel-prefix=${input.bridgeEventChannelPrefix}` : '',
    input.rendererLaunchBinding
      ? `--nimi-installed-app-launch-binding=${encodeRendererLaunchBinding(input.rendererLaunchBinding)}`
      : '',
  ].filter(Boolean);
  return {
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: input.appId,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(additionalArguments.length > 0 ? { additionalArguments } : {}),
    },
  };
}

export async function createDesktopInstalledAppHostWindow(
  input: DesktopInstalledAppHostWindowInput,
  deps: {
    readonly BrowserWindow: DesktopInstalledAppBrowserWindowConstructor;
    readonly ipcMain: NimiElectronIpcMain;
    readonly registerRuntimeBridge: (input: RegisterNimiElectronRuntimeBridgeInput) => RegisteredNimiElectronRuntimeBridge;
  },
): Promise<DesktopInstalledAppHostWindowResult> {
  const window = new deps.BrowserWindow(buildDesktopInstalledAppHostWindowOptions({
    appId: input.appId,
    preloadPath: input.preloadPath,
    bridgeInvokeChannel: installedAppInvokeChannel(input.appId),
    bridgeEventChannelPrefix: installedAppEventChannelPrefix(input.appId),
    rendererLaunchBinding: input.rendererLaunchBinding,
  }));
  secureInstalledAppWindow(window, input.entryUrl, input.allowedOrigins);
  deps.registerRuntimeBridge({
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
    allowedOrigins: input.allowedOrigins,
    allowedRendererUrls: [input.entryUrl],
    ipcMain: deps.ipcMain,
    invokeChannel: installedAppInvokeChannel(input.appId),
    eventChannelPrefix: installedAppEventChannelPrefix(input.appId),
    trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
    standardShellHost: {
      capabilitySetRef: input.standardShell.capabilitySetRef,
      standardDataRootBinding: input.standardShell.standardDataRootBinding,
      localAssetRoots: input.standardShell.localAssetRoots,
      aiConfigStore: input.standardShell.aiConfigStore,
    },
  });
  await window.loadURL(input.entryUrl);
  return {
    windowId: window.id,
    entryUrl: input.entryUrl,
  };
}

function encodeRendererLaunchBinding(binding: DesktopInstalledAppRendererLaunchBinding): string {
  return Buffer.from(JSON.stringify(binding), 'utf8').toString('base64url');
}

function installedAppInvokeChannel(appId: string): string {
  return `nimi:installed-app:${encodeBridgeChannelSegment(appId)}:runtime:invoke`;
}

function installedAppEventChannelPrefix(appId: string): string {
  return `nimi:installed-app:${encodeBridgeChannelSegment(appId)}:runtime:event:`;
}

function encodeBridgeChannelSegment(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%/g, '_').toLowerCase();
}

function secureInstalledAppWindow(
  window: DesktopInstalledAppBrowserWindow,
  entryUrl: string,
  allowedOrigins: readonly string[],
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedInstalledAppUrl(url, entryUrl, allowedOrigins)) {
      event.preventDefault();
    }
  });
}

function isAllowedInstalledAppUrl(url: string, entryUrl: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (url === entryUrl) {
    return true;
  }
  const origin = `${parsed.protocol}//${parsed.host}`;
  return allowedOrigins.includes(origin);
}
