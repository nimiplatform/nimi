import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  protocol,
  session,
  webContents,
  type OpenDialogOptions,
} from 'electron';
import {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
  type NimiElectronAgentCenterOpenFileDialog,
} from '@nimiplatform/kit/shell/electron/main';
import {
  ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL,
  ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL,
} from './resource-pack-placement-ipc.js';
import {
  createZhiyuElectronResourcePackPlacementHost,
  type ZhiyuElectronResourcePackPlacementHost,
} from './resource-pack-placement-host.js';
import { redeemDesktopZhiyuResourcePackPlacement } from './resource-pack-placement-redemption.js';
import { resolveZhiyuResourcePackPlacementAgentHandle } from './resource-pack-placement-agent-resolution.js';

const APP_ID = 'nimi.zhiyu';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const windowIconPath = path.join(appRoot, 'assets', 'native', process.platform === 'win32' ? 'windows.ico' : process.platform === 'darwin' ? 'macos.png' : 'app.png');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = readArgument('--nimi-dev-renderer-url')
  || normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RENDERER_URL);
const appPackage = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version: string };
const chromeHost = createNimiElectronAppChromeHost({
  metadata: { name: '织羽', version: appPackage.version }, allowedRendererUrls: allowedRendererUrls(), app, menu: Menu,
  appCommands: [{ id: 'zhiyu.account.manage', menu: 'file', labels: { en: 'Manage account in Home', zh: '在 Home 管理账号' } }],
});
let registeredAppBridge: ReturnType<typeof registerNimiElectronAppBridge> | undefined;
let resettingRenderer = false;
let quitting = false;
let scopeReset: Promise<void> | undefined;
let mainWindow: BrowserWindow | undefined;
let resourcePackPlacementHost: ZhiyuElectronResourcePackPlacementHost | undefined;
let quitCleanup: Promise<void> | undefined;
let quitCleanupComplete = false;

app.setName('织羽');
if (process.platform === 'win32') {
  // Separate each App and its development carrier in the Windows taskbar.
  app.setAppUserModelId(`ai.nimi.apps.${APP_ID}${app.isPackaged ? '' : '.dev'}`);
}
configureZhiyuElectronChromiumRuntime();
registerNimiElectronAppAssetProtocolScheme(protocol);

ipcMain.on(ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL, (event, payload) => {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window || event.sender !== window.webContents || window.webContents.isDestroyed()) return;
  resourcePackPlacementHost?.acknowledge(payload);
});

const ZHIYU_HANDOFF_ALLOWED_KEYS = new Set(['agentHandle', 'requestId', 'text', 'handoffBriefText']);

ipcMain.handle('nimi:zhiyu:harness-handoff:submit', async (event, rawPayload: unknown) => {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (
    !window
    || event.sender !== window.webContents
    || window.webContents.isDestroyed()
    || !event.senderFrame
    || event.senderFrame !== event.sender.mainFrame
    || !isAllowedElectronRendererUrl(event.senderFrame.url, allowedRendererUrls())
  ) {
    throw new Error('zhiyu-handoff-sender-unauthorized');
  }
  if (!registeredAppBridge) {
    throw new Error('zhiyu-host-not-ready');
  }
  const record = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload as Record<string, unknown>
    : null;
  if (!record || Object.keys(record).some((k) => !ZHIYU_HANDOFF_ALLOWED_KEYS.has(k))) {
    throw new Error('zhiyu-handoff-invalid-brief');
  }
  const agentHandle = typeof record.agentHandle === 'string' ? record.agentHandle.trim() : '';
  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : '';
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const handoffBriefText = typeof record.handoffBriefText === 'string' ? record.handoffBriefText.trim() : '';
  if (
    !agentHandle || agentHandle.length > 256 || /[\x00-\x1f]/u.test(agentHandle)
    || !requestId || requestId.length > 128 || /[\x00-\x1f]/u.test(requestId)
    || text.length > 2000 || /\x00/u.test(text)
    || !handoffBriefText || handoffBriefText.length > 4000 || /\x00/u.test(handoffBriefText)
  ) {
    throw new Error('zhiyu-handoff-invalid-brief');
  }
  const res = await registeredAppBridge.services.agentSession.routeAndSubmitInput({
    agentHandle,
    requestId,
    text: text || handoffBriefText.slice(0, 200),
    explicitWorkSessionRef: '',
    entrySurface: 'zhiyu_handoff',
    workspaceRoot: '',
    workspaceWritable: false,
    attachmentPaths: [],
    cardSourceSessionRef: '',
    cardSourceMaxSeq: '0',
    handoffBriefText,
    replyToMessageRef: '',
    delegationObjectId: '',
    selectedCandidateRef: '',
    trustTierHint: 'trusted',
  });
  return {
    resolvedWorkSessionRef: res.resolvedWorkSessionRef,
    sessionKind: res.sessionKind,
    ownerBodyKind: res.ownerBodyKind,
    deduplicated: res.deduplicated,
    routeReason: res.routeReason,
  };
});

const openZhiyuAgentCenterFileDialog: NimiElectronAgentCenterOpenFileDialog = async (payload) => {
  const properties: OpenDialogOptions['properties'] = [
    payload.kind === 'directory' ? 'openDirectory' : 'openFile',
  ];
  if (payload.multiple) properties.push('multiSelections');
  const options: OpenDialogOptions = {
    title: payload.title,
    properties,
    filters: payload.filters?.map((filter) => ({
      name: filter.name,
      extensions: [...filter.extensions],
    })),
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return { canceled: result.canceled, paths: result.filePaths };
};

void app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(windowIconPath);
  registeredAppBridge = registerNimiElectronAppBridge({
    chromeHost,
    appId: APP_ID,
    allowedRendererUrls: allowedRendererUrls(),
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    agentCenterOpenFileDialog: openZhiyuAgentCenterFileDialog,
    ipcMain,
    onSessionInvalidated: resetAccountScopedRenderer,
  });

  await createMainWindow();
  await startResourcePackPlacementHost();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !resettingRenderer) {
      void createMainWindow();
    }
  });
});

async function startResourcePackPlacementHost(): Promise<void> {
  if (!registeredAppBridge) throw new Error('zhiyu-host-not-ready');
  const localAppHost = registeredAppBridge.localAppHost;
  resourcePackPlacementHost = await createZhiyuElectronResourcePackPlacementHost({
    homeDirectory: app.getPath('home'),
    focusMainWindow: focusZhiyuMainWindow,
    redeemPlacement: (correlationRef) => redeemDesktopZhiyuResourcePackPlacement({ correlationRef }),
    resolveDestinationAgent: (conversationAnchorId) => resolveZhiyuResourcePackPlacementAgentHandle(
      localAppHost,
      conversationAnchorId,
    ),
    emitPlacement: (event) => {
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      if (!window || window.webContents.isDestroyed()) {
        throw new Error('zhiyu-resource-pack-placement-renderer-not-ready');
      }
      window.webContents.send(ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL, event);
    },
  });
}

function resetAccountScopedRenderer(): void {
  if (quitting || scopeReset || !BrowserWindow.getAllWindows().length) return;
  resettingRenderer = true;
  const placementHost = resourcePackPlacementHost;
  resourcePackPlacementHost = undefined;
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  scopeReset = (async () => {
    await placementHost?.shutdown();
    if (quitting) return;
    await createMainWindow();
    await startResourcePackPlacementHost();
  })().catch(error => { process.stderr.write(`[zhiyu-session-reset] ${String(error)}\n`); }).finally(() => { scopeReset = undefined; resettingRenderer = false; });
}

function configureZhiyuElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !resettingRenderer) {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  quitting = true;
  if (quitCleanupComplete || !resourcePackPlacementHost) return;
  event.preventDefault();
  quitCleanup ??= resourcePackPlacementHost.shutdown()
    .then(() => {
      resourcePackPlacementHost = undefined;
      quitCleanupComplete = true;
      app.quit();
    })
    .catch((error: unknown) => {
      process.stderr.write(`[zhiyu-resource-pack-placement] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      resourcePackPlacementHost = undefined;
      quitCleanupComplete = true;
      app.quit();
    })
    .finally(() => {
      quitCleanup = undefined;
    });
});
app.on('will-quit', () => chromeHost.dispose());

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 720,
    icon: windowIconPath,
    title: '织羽',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  chromeHost.bindWindow(window);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  secureZhiyuWindow(window);
  await loadRendererRoute(window);
  return window;
}

async function focusZhiyuMainWindow(): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (!window) throw new Error('zhiyu-resource-pack-placement-window-unavailable');
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
}

async function loadRendererRoute(window: BrowserWindow): Promise<void> {
  await window.loadURL(rendererUrl || rendererDistUrl);
}

function secureZhiyuWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isZhiyuRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_ZHIYU_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function isZhiyuRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readArgument(name: string): string {
  return readOptionalArgument(name) || '';
}

function readOptionalArgument(name: string): string | undefined {
  const prefix = `${name}=`;
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix));
  return argument === undefined ? undefined : normalizeText(argument.slice(prefix.length));
}
