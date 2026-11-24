import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, dialog, shell, BrowserWindow, ipcMain, Menu, protocol, session, utilityProcess, webContents } from 'electron';
import { configureNimiElectronAppHostProfile } from '@nimiplatform/kit/shell/electron/host-profile';
import type { openHarness as OpenHarness, PermissionMode } from './harness.js';
import { HarnessBodySymbiosisClient } from './body-symbiosis.js';
import { EngineWorkerHostClient } from './engine-worker.js';

declare const __NIMI_ELECTRON_PRODUCTION__: boolean;

// Bind user data, session data and temp to the Host profile Nimi Desktop
// prepared under the selected data root, before any session or window and
// before the rest of Kit loads: a module that failed to load first would
// leave Electron on its default paths in the OS user's profile.
try {
  configureNimiElectronAppHostProfile(app);
} catch (error) {
  process.stderr.write(`[nimi-app-host-profile] ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(78);
  throw error;
}

const {
  createNimiElectronAppChromeHost,
  createNimiElectronAppChromeWindowOptions,
  isAllowedElectronRendererUrl,
  registerNimiElectronAppAssetProtocolScheme,
  registerNimiElectronAppBridge,
} = await import('@nimiplatform/kit/shell/electron/main');

const APP_ID = 'nimi.harness';
const NATIVE_BUNDLE_IDENTIFIER = 'ai.nimi.apps.nimi.harness';
const IS_PRODUCTION_BUNDLE = typeof __NIMI_ELECTRON_PRODUCTION__ !== 'undefined'
  && __NIMI_ELECTRON_PRODUCTION__;
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.exit(0);
  process.exit(0);
}
let pendingDeepLinkWorkSessionRef: string | undefined = extractWorkSessionRefArg(process.argv);
let focusDeepLinkHandler: ((workSessionRef: string) => void) | undefined;
app.on('second-instance', (_event, commandLine) => {
  const deepLinkRef = extractWorkSessionRefArg(commandLine);
  if (deepLinkRef) {
    pendingDeepLinkWorkSessionRef = deepLinkRef;
    focusDeepLinkHandler?.(deepLinkRef);
  }
  const existing = BrowserWindow.getAllWindows()[0];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
  }
});
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, '..');
const APP_VERSION = readPackageVersion(appRoot);
const appIconPath = path.join(currentDir, process.platform === 'win32' ? 'app-icon.ico' : process.platform === 'darwin' ? 'app-icon-macos.png' : 'app-icon.png');
if (IS_PRODUCTION_BUNDLE && !existsSync(appIconPath)) throw new Error('Packaged App icon is missing.');
const windowIcon = existsSync(appIconPath) ? appIconPath : undefined;
const preloadPath = path.join(currentDir, 'preload.cjs');
const productionRendererUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString();
const developmentRendererUrl = readDevelopmentRendererUrl();
const rendererUrl = developmentRendererUrl || productionRendererUrl;
const allowedRendererUrls = [rendererUrl];
let resettingRenderer = false;
let quitting = false;
let account = new AbortController();
let harness: ReturnType<typeof OpenHarness> | undefined;
let symbiosis: HarnessBodySymbiosisClient | undefined;
let engineWorker: EngineWorkerHostClient | undefined;
let retiringHarness = Promise.resolve();

app.setName('Nimi Harness');
if (process.platform === 'win32') {
  app.setAppUserModelId(IS_PRODUCTION_BUNDLE ? NATIVE_BUNDLE_IDENTIFIER : `ai.nimi.dev.apps.${APP_ID}`);
}
const chromeHost = createNimiElectronAppChromeHost({
  metadata: { name: 'Nimi Harness', version: APP_VERSION },
  allowedRendererUrls, app,
  appCommands: [{ id: 'app.nimi-account', menu: 'file', labels: { en: 'Nimi account', zh: 'Nimi 账号' } }],
  menu: { buildFromTemplate: template => Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]), setApplicationMenu: menu => Menu.setApplicationMenu(menu as Electron.Menu | null) },
});
registerNimiElectronAppAssetProtocolScheme(protocol);

void app.whenReady().then(async () => {
  if (process.platform === 'darwin' && !IS_PRODUCTION_BUNDLE && windowIcon) app.dock?.setIcon(windowIcon);
  const [{ serveSessions }, { openHarness }] = await Promise.all([import('./session-provider.js'), import('./harness.js')]);
  const harnessDataRoot = path.join(app.getPath('userData'), 'harness');

  // Spawn dedicated Electron utilityProcess for off-main-thread SQLite durability & hash I/O (Gate 7).
  const engineWorkerPath = path.join(currentDir, 'engine-worker.js');
  if (existsSync(engineWorkerPath)) {
    try {
      const forked = utilityProcess.fork(engineWorkerPath, [], { serviceName: 'nimi-harness-engine' });
      engineWorker = new EngineWorkerHostClient(forked);
      void engineWorker.request({ kind: 'ping' }).catch(() => {});
    } catch (error) {
      process.stderr.write(`[nimi-harness-worker] ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  const notifyRendererViewChanged = () => {
    if (account.signal.aborted || quitting) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && isAllowedElectronRendererUrl(window.webContents.getURL(), allowedRendererUrls)) {
        window.webContents.send('harness:view-changed');
      }
    }
  };

  focusDeepLinkHandler = (workSessionRef: string) => {
    void getHarness()
      .then(h => h.selectByWorkSessionRef(workSessionRef))
      .then(selected => { if (selected) notifyRendererViewChanged(); })
      .catch(() => {});
  };

  const bridge = registerNimiElectronAppBridge({
    chromeHost,
    appId: APP_ID,
    allowedRendererUrls,
    assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
    ipcMain,
    onSessionReady: services => {
      const signal = account.signal;
      void serveSessions(services.integration, getHarness, signal).catch(error => {
        if (!signal.aborted) process.stderr.write(`[nimi-harness-integration] ${error instanceof Error ? error.message : String(error)}\n`);
      });
      void startBodySymbiosis(services, signal).catch(error => {
        if (!signal.aborted) process.stderr.write(`[nimi-harness-symbiosis] ${error instanceof Error ? error.message : String(error)}\n`);
      });
    },
    onSessionInvalidated: () => {
      void closeHarness().catch(reportHarnessCloseFailure);
      resetAccountScopedRenderer();
    },
  });

  async function resolvePersistentDeviceId(storage: typeof bridge.services.storage, signal: AbortSignal): Promise<string> {
    try {
      const existing = (await storage.readJson('harness-device-id.json')).value;
      if (typeof existing === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(existing)) {
        return existing;
      }
    } catch {
      // Missing device id; allocate one durably under account storage.
    }
    signal.throwIfAborted();
    const created = `pc-${randomUUID()}`;
    await storage.writeJson('harness-device-id.json', created).catch(() => {});
    return created;
  }

  async function startBodySymbiosis(services: typeof bridge.services, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const deviceId = await resolvePersistentDeviceId(services.storage, signal);
    signal.throwIfAborted();
    const client = new HarnessBodySymbiosisClient({
      deviceId,
      client: services.agentSession,
      handlers: {
        onPurgeSession: async (workSessionRef) => {
          await (await getHarness()).handleBodyPurgeSession(workSessionRef);
          notifyRendererViewChanged();
        },
        onPurgeAgent: async (agentBinding) => {
          await (await getHarness()).handleBodyPurgeAgent(agentBinding);
          notifyRendererViewChanged();
        },
        onInvalidateMemory: async (workSessionRef) => {
          await (await getHarness()).handleBodyInvalidateMemory(workSessionRef);
          notifyRendererViewChanged();
        },
        onNewIntent: async (env) => {
          await (await getHarness()).handleBodyNewIntent(env);
          notifyRendererViewChanged();
        },
        onReconcileAfterTombstones: async () => (await getHarness()).listBodyProjectionsForReconcile(),
        onLeaseLost: (reason) => {
          process.stderr.write(`[nimi-harness-symbiosis] lease lost: ${reason}\n`);
          notifyRendererViewChanged();
        },
      },
    });
    symbiosis = client;
    if (harness) {
      const active = await harness.catch(() => undefined);
      active?.attachSymbiosis(client);
    }
    await client.start(signal);
    if (pendingDeepLinkWorkSessionRef) {
      const ref = pendingDeepLinkWorkSessionRef;
      pendingDeepLinkWorkSessionRef = undefined;
      focusDeepLinkHandler?.(ref);
    }
  }

  function getHarness(): ReturnType<typeof OpenHarness> {
    if (harness) return harness;
    const signal = account.signal;
    const pending = retiringHarness.then(() => {
      signal.throwIfAborted();
      let queued: ReturnType<typeof setTimeout> | undefined;
      return openHarness(bridge.services, signal, () => {
        if (queued || signal.aborted) return;
        // Coalesce rapid stream deltas to a crisp 60ms frame cadence without IPC flooding.
        queued = setTimeout(() => {
          queued = undefined;
          notifyRendererViewChanged();
        }, 60);
        queued.unref();
      }, {
        dataRoot: harnessDataRoot,
        symbiosis,
        requireSymbiosis: true,
      });
    });
    harness = pending;
    void pending.catch(() => { if (harness === pending) harness = undefined; });
    return pending;
  }

  ipcMain.handle('harness:snapshot', async event => {
    assertHarnessSender(event);
    return (await getHarness()).snapshot();
  });
  ipcMain.handle('harness:import-home', async (event, source: unknown) => {
    assertHarnessSender(event);
    await (await getHarness()).importHome(source);
  });
  ipcMain.handle('harness:import-material', async (event, id: string, name: string, data: Uint8Array) => {
    assertHarnessSender(event);
    return (await getHarness()).importMaterial(id, name, data);
  });
  ipcMain.handle('harness:list-files', async (event, id: string, folder: string, offset: number) => {
    assertHarnessSender(event);
    return (await getHarness()).listFiles(id, folder, offset);
  });
  ipcMain.handle('harness:preview-file', async (event, id: string, ref: string, page?: number) => {
    assertHarnessSender(event);
    return (await getHarness()).previewFile(id, ref, page);
  });
  ipcMain.handle('harness:reveal-file', async (event, id: string, ref: string) => {
    assertHarnessSender(event);
    const lifetime = account.signal;
    const filePath = await (await getHarness()).revealFile(id, ref);
    lifetime.throwIfAborted();
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle('harness:reveal-workspace', async (event, id: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    const lifetime = account.signal;
    const dir = await (await getHarness()).revealWorkspace(id);
    lifetime.throwIfAborted();
    await shell.openPath(dir);
  });
  ipcMain.handle('harness:choose-workspace', async event => {
    assertHarnessSender(event);
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('harness:set-workspace', async (event, id: unknown, dir: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    if (dir !== null && (typeof dir !== 'string' || !path.isAbsolute(dir) || /[\x00-\x1f]/u.test(dir))) {
      throw new Error('Choose an absolute directory path for the workspace.');
    }
    await (await getHarness()).setWorkspace(id, dir);
  });
  ipcMain.handle('harness:create', async (event, configRef: unknown, workspaceDir?: unknown) => {
    assertHarnessSender(event);
    if (configRef !== undefined && (typeof configRef !== 'string' || !/^(main|[0-9a-f]{32})$/.test(configRef))) {
      throw new Error('Invalid configuration reference.');
    }
    if (workspaceDir !== undefined && (typeof workspaceDir !== 'string' || !path.isAbsolute(workspaceDir) || /[\x00-\x1f]/u.test(workspaceDir))) {
      throw new Error('Invalid workspace directory.');
    }
    await (await getHarness()).create(configRef, workspaceDir);
  });
  ipcMain.handle('harness:select', async (event, id: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).select(id);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  ipcMain.handle('harness:rename', async (event, id: unknown, title: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
      throw new Error('Choose a session name of up to 120 characters.');
    }
    await (await getHarness()).rename(id, title.trim());
  });
  ipcMain.handle('harness:delete-session', async (event, id: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).deleteSession(id);
  });
  ipcMain.handle('harness:pin-session', async (event, id: unknown, pinned: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || typeof pinned !== 'boolean') throw new Error('Invalid pin update.');
    await (await getHarness()).pinSession(id, pinned);
  });
  ipcMain.handle('harness:set-permission-mode', async (event, id: unknown, mode: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || (mode !== 'strict' && mode !== 'workspace-edit' && mode !== 'plan-readonly')) {
      throw new Error('Invalid permission mode.');
    }
    await (await getHarness()).setPermissionMode(id, mode as PermissionMode);
  });
  ipcMain.handle('harness:set-reasoning-effort', async (event, id: unknown, effort: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || (effort !== null && (typeof effort !== 'string' || !effort.trim() || effort.length > 32))) {
      throw new Error('Invalid reasoning effort.');
    }
    await (await getHarness()).setReasoningEffort(id, effort);
  });
  ipcMain.handle('harness:export-markdown', async (event, id: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string') throw new Error('Invalid session.');
    return (await getHarness()).exportMarkdown(id);
  });
  ipcMain.handle('harness:list-integrations', async event => {
    assertHarnessSender(event);
    return (await getHarness()).listIntegrations();
  });
  ipcMain.handle('harness:withdraw', async (event, id: unknown, input: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) throw new Error('Invalid queued follow-up.');
    await (await getHarness()).withdraw(id, input);
  });
  ipcMain.handle('harness:instructions', async (event, id: unknown, text: unknown) => {
    assertHarnessSender(event);
    if (typeof id !== 'string' || typeof text !== 'string' || text.length > 4000) throw new Error('Use up to 4,000 characters for session instructions.');
    await (await getHarness()).setInstructions(id, text.trim());
  });
  ipcMain.handle('harness:submit', async (event, sessionId: unknown, text: unknown, requestId: unknown, queue: unknown = false) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string' || typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 64 * 1024
      || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId) || typeof queue !== 'boolean') {
      throw new Error('Invalid task input.');
    }
    await (await getHarness()).submit(sessionId, text, requestId, queue);
  });
  ipcMain.handle('harness:decide', async (event, sessionId: unknown, id: unknown, allow: unknown, feedback?: unknown, allowForSession?: unknown, revision?: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string' || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof allow !== 'boolean') {
      throw new Error('Invalid tool decision.');
    }
    if (feedback !== undefined && (allow || typeof feedback !== 'string' || !feedback.trim() || feedback.length > 4000)) {
      throw new Error('A change request needs a note of up to 4,000 characters and declines the current proposal.');
    }
    if (allowForSession !== undefined && (typeof allowForSession !== 'boolean' || (allowForSession && !allow))) {
      throw new Error('Session allowlist applies only to allowed actions.');
    }
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      throw new Error('Decision revision is required to prevent stale approvals.');
    }
    await (await getHarness()).decide(sessionId, id, allow, feedback?.trim(), allowForSession === true, revision);
  });
  ipcMain.handle('harness:list-snapshots', async (event, sessionId: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    return (await getHarness()).listSnapshots(sessionId);
  });
  ipcMain.handle('harness:restore-snapshot', async (event, sessionId: unknown, snapshotId: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string' || typeof snapshotId !== 'string' || !snapshotId.trim()) {
      throw new Error('Invalid snapshot restore request.');
    }
    return (await getHarness()).restoreSnapshot(sessionId, snapshotId);
  });
  ipcMain.handle('harness:review-model', async (event, sessionId: unknown, confirmation: unknown, configRef: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string' || (confirmation !== undefined && (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation)))) {
      throw new Error('Invalid session model selection.');
    }
    if (configRef !== undefined && (typeof configRef !== 'string' || !/^(main|[0-9a-f]{32})$/.test(configRef))) throw new Error('Invalid configuration reference.');
    return (await getHarness()).reviewModel(sessionId, confirmation, configRef);
  });
  ipcMain.handle('harness:stop', async (event, sessionId: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).stop(sessionId);
  });
  ipcMain.handle('harness:resume', async (event, sessionId: unknown) => {
    assertHarnessSender(event);
    if (typeof sessionId !== 'string') throw new Error('Invalid session.');
    await (await getHarness()).resume(sessionId);
  });
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !resettingRenderer && BrowserWindow.getAllWindows().length === 0) app.quit();
});
app.on('before-quit', event => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void closeHarness().catch(reportHarnessCloseFailure).finally(() => app.quit());
});

function readPackageVersion(root: string): string {
  try {
    const raw = readFileSync(path.join(root, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim()) return parsed.version.trim();
  } catch { /* fall through */ }
  return '0.2.0';
}

function assertHarnessSender(event: Electron.IpcMainInvokeEvent): void {
  if (quitting || !event.senderFrame || event.senderFrame !== event.sender.mainFrame
    || !isAllowedElectronRendererUrl(event.senderFrame.url, allowedRendererUrls)) {
    throw new Error('Nimi Harness accepts commands from its main window.');
  }
}

function closeHarness(): Promise<void> {
  account.abort();
  account = new AbortController();
  const previous = harness;
  const prevSymbiosis = symbiosis;
  harness = undefined;
  symbiosis = undefined;
  const closing = retiringHarness.then(async () => {
    await prevSymbiosis?.stop().catch(() => undefined);
    const opened = await previous?.catch(() => undefined);
    await opened?.close();
    if (quitting) {
      engineWorker?.close();
      engineWorker = undefined;
    }
  });
  retiringHarness = closing;
  return closing;
}

function extractWorkSessionRefArg(argv: readonly string[]): string | undefined {
  const prefix = '--work-session=';
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(prefix)) {
      const ref = arg.slice(prefix.length).trim();
      if (ref && ref.length <= 128 && !/[\x00-\x1f]/u.test(ref)) {
        return ref;
      }
    }
  }
  return undefined;
}

function reportHarnessCloseFailure(error: unknown): void {
  process.stderr.write(`[nimi-harness-close] ${error instanceof Error ? error.message : String(error)}\n`);
}

// A revoked/account-changed scope must not leave renderer timers or queued
// promises alive to use the rebound Host. This does not run on normal renewal.
function resetAccountScopedRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  if (quitting || windows.length === 0) return;
  resettingRenderer = true;
  try {
    for (const window of windows) window.destroy();
    void createMainWindow().catch((error: unknown) => {
      process.stderr.write(`[nimi-app-session-reset] ${error instanceof Error ? error.message : String(error)}\n`);
    });
  } finally { resettingRenderer = false; }
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    ...createNimiElectronAppChromeWindowOptions(),
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    title: 'Nimi Harness',
    icon: windowIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chromeHost.bindWindow(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedElectronRendererUrl(url, allowedRendererUrls)) event.preventDefault();
  });
  try {
    await window.loadURL(rendererUrl);
  } catch (error) {
    if (!window.isDestroyed()) throw error;
  }
}

function readDevelopmentRendererUrl(): string {
  const flag = '--nimi-dev-renderer-url';
  const prefix = '--nimi-dev-renderer-url=';
  const hasDevelopmentRendererArgument = process.argv.some((value) => value === flag || value.startsWith(prefix));
  if (IS_PRODUCTION_BUNDLE && hasDevelopmentRendererArgument) {
    throw new Error('The production Electron bundle rejects --nimi-dev-renderer-url.');
  }
  if (process.argv.includes(flag)) throw new Error('Nimi development renderer URL is missing.');
  const values = process.argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return '';
  if (values.length !== 1) throw new Error('Nimi development renderer URL must be singular.');
  const selected = values[0];
  if (!selected) throw new Error('Nimi development renderer URL is missing.');
  const raw = selected.slice(prefix.length);
  const parsed = new URL(raw);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    || !parsed.port
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Nimi development renderer URL must be exact loopback.');
  }
  return parsed.origin;
}
