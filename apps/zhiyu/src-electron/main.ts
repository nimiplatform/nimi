import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, ipcMain, protocol, dialog } from 'electron';
import {
  createNimiElectronStandardApplicationMenuTemplate,
  createElectronShellFileProtocolHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppBridge,
  registerNimiElectronRuntimeBridge,
  type NimiElectronFileDialogOpenPayload,
  type NimiElectronFileDialogOpenResult,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronStandardDataRootBinding,
} from '@nimiplatform/kit/shell/electron/main';
import { registerZhiyuAvatarLaunchHandoffBridge } from './avatar-launch-handoff.js';
import {
  ZHIYU_RUNTIME_AGENT_SCOPED_BINDING_COMMAND,
  createZhiyuRuntimeAgentScopedBindingCommandHandler,
} from './runtime-agent-scoped-binding.js';

const APP_ID = 'nimi.zhiyu';
const LOCAL_AGENT_ID_PATTERN = /^local-agent:runtime-[0-9a-f]{32}$/u;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const windowIconPath = path.join(currentDir, 'app-icon.png');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = readArgument('--nimi-dev-renderer-url')
  || normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RENDERER_URL);
const isLocalDevelopmentBuild = Boolean(readArgument('--nimi-dev-renderer-url'));
const localDevelopmentAgentId = readArgument('--nimi-dev-agent-id');
if (isLocalDevelopmentBuild && !LOCAL_AGENT_ID_PATTERN.test(localDevelopmentAgentId)) {
  throw new Error('Zhiyu local-development Agent selector is missing or invalid.');
}
if (!isLocalDevelopmentBuild && localDevelopmentAgentId) {
  throw new Error('Zhiyu local-development Agent selector is forbidden outside local development.');
}
let mainWindow: BrowserWindow | undefined;

app.setName('织羽 Zhiyu');
const applicationMenu = Menu.buildFromTemplate(
  createNimiElectronStandardApplicationMenuTemplate({
    appName: '织羽 Zhiyu',
  }),
);
Menu.setApplicationMenu(applicationMenu);
configureZhiyuElectronChromiumRuntime();

const localAssetProtocolHost = createLocalAssetProtocolHost();
localAssetProtocolHost.registerPrivilegedSchemes();

void app.whenReady().then(async () => {
  const standardDataRoot = resolveStandardDataRoot();
  localAssetProtocolHost.registerProtocolHandler();
  if (isLocalDevelopmentBuild) {
    registerNimiElectronAppBridge({
      appId: APP_ID,
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
    });
  } else {
    const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
      || normalizeText(process.env.NIMI_ZHIYU_ELECTRON_RUNTIME_ENDPOINT)
      || '127.0.0.1:46371';
    registerZhiyuAvatarLaunchHandoffBridge({
      ipcMain,
      dataRoot: standardDataRoot,
      runtimeEndpoint,
      isAllowedRendererUrl: isZhiyuRendererUrl,
    });
    registerNimiElectronRuntimeBridge({
      appId: APP_ID,
      runtimeEndpoint,
      allowedOrigins: allowedRendererOrigins(),
      allowedRendererUrls: allowedRendererUrls(),
      ipcMain,
      standardShellHost: {
        allowAllStandardShellCommands: true,
        runtimeTrustedCaller: { mode: 'local-first-party-app' as const },
        standardDataRootBinding: resolveStandardDataRootBinding(),
        localAssetRoots: resolveLocalAssetRoots(standardDataRoot),
        localAssetProtocolHost,
        openFileDialog: openZhiyuStandardFileDialog,
      },
      commandHandlers: {
        [ZHIYU_RUNTIME_AGENT_SCOPED_BINDING_COMMAND]: createZhiyuRuntimeAgentScopedBindingCommandHandler({
          appId: APP_ID,
          runtimeEndpoint,
        }),
      },
    });
  }

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function configureZhiyuElectronChromiumRuntime(): void {
  app.commandLine.appendSwitch('disable-background-networking');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: isLocalDevelopmentBuild ? 1060 : 1280,
    height: isLocalDevelopmentBuild ? 780 : 860,
    minWidth: isLocalDevelopmentBuild ? 360 : 980,
    minHeight: isLocalDevelopmentBuild ? 640 : 720,
    icon: windowIconPath,
    title: isLocalDevelopmentBuild ? '知语 · 开发内核联调' : '织羽 Zhiyu',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  secureZhiyuWindow(window);
  await loadRendererRoute(window);
  return window;
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

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(originForRendererUrl(url));
  }
  for (const origin of normalizeText(process.env.NIMI_ZHIYU_ELECTRON_ALLOWED_ORIGINS).split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
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

function originForRendererUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function isZhiyuRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function createLocalAssetProtocolHost(): NimiElectronShellFileProtocolHost {
  return createElectronShellFileProtocolHost({
    protocol: {
      registerSchemesAsPrivileged: (schemes) => protocol.registerSchemesAsPrivileged([...schemes]),
      handle: (scheme, handler) => protocol.handle(scheme, (request) => handler(request) as Promise<Response>),
    },
    roots: resolveLocalAssetRoots(resolveStandardDataRoot()),
  });
}

async function openZhiyuStandardFileDialog(
  payload: NimiElectronFileDialogOpenPayload,
): Promise<NimiElectronFileDialogOpenResult> {
  const injected = consumeInjectedTestFileDialogPath();
  if (injected) {
    return { canceled: false, paths: [injected] };
  }
  const properties: Electron.OpenDialogOptions['properties'] = [
    payload.kind === 'directory' ? 'openDirectory' : 'openFile',
  ];
  if (payload.multiple) {
    properties.push('multiSelections');
  }
  const options: Electron.OpenDialogOptions = {
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
  return {
    canceled: result.canceled,
    paths: result.filePaths,
  };
}

function consumeInjectedTestFileDialogPath(): string | null {
  const raw = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_TEST_FILE_DIALOG_PATHS);
  if (!raw) {
    return null;
  }
  const [next, ...remaining] = raw.split(path.delimiter).map((entry) => normalizeText(entry)).filter(Boolean);
  process.env.NIMI_ZHIYU_ELECTRON_TEST_FILE_DIALOG_PATHS = remaining.join(path.delimiter);
  return next ? path.resolve(next) : null;
}

function resolveLocalAssetRoots(dataRoot: string): string[] {
  const fromEnv = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS);
  if (!fromEnv) {
    return [path.resolve(dataRoot)];
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function resolveStandardDataRoot(): string {
  const fromEnv = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT);
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveStandardDataRootBinding(): NimiElectronStandardDataRootBinding {
  const fromEnv = normalizeText(process.env.NIMI_ZHIYU_ELECTRON_STANDARD_DATA_ROOT);
  if (fromEnv) {
    return {
      source: 'runtime-launch-projection',
      durableDataRoot: path.resolve(fromEnv),
      projectionRef: 'zhiyu-electron-acceptance-fixture',
    };
  }
  return { source: 'runtime-get-app-storage' };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readArgument(name: string): string {
  const prefix = `${name}=`;
  return normalizeText(process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length));
}
