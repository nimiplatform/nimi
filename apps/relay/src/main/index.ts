// RL-BOOT-001 — Main Process Initialization
// RL-BOOT-004 — Runtime Unavailable Degradation
// RL-BOOT-005 — Auth Flow Integration

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { parseEnv, type RelayEnv } from './env.js';
import { initPlatformClient } from './platform-client.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { initRealtimeRelay } from './realtime-relay.js';
import { loadToken, saveToken, performDesktopBrowserAuth } from './auth/index.js';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';

let mainWindow: BrowserWindow | null = null;
let env: RelayEnv;
let runtime: Runtime;
let realm: Realm;

export type AuthState = 'pending' | 'authenticating' | 'authenticated' | 'failed';
let currentAuthState: AuthState = 'pending';
let authError: string | null = null;

function getWebContents() {
  return mainWindow?.webContents ?? null;
}

function setAuthState(state: AuthState, error?: string) {
  currentAuthState = state;
  authError = error ?? null;
  const wc = getWebContents();
  if (wc && !wc.isDestroyed()) {
    wc.send('relay:auth:status', { state: currentAuthState, error: authError });
  }
}

export function getAuthState(): { state: AuthState; error: string | null } {
  return { state: currentAuthState, error: authError };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Development: load Vite dev server; Production: load built files
  const isDev = !app.isPackaged;
  if (isDev) {
    const devUrl = 'http://127.0.0.1:1430';
    mainWindow.loadURL(devUrl).catch(() => {
      // Vite dev server not ready yet — retry after a short delay
      setTimeout(() => {
        mainWindow?.loadURL(devUrl).catch(() => {
          console.error('Vite dev server not reachable at', devUrl);
        });
      }, 2000);
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Run browser OAuth and initialize platform clients.
 * Triggered by renderer when user clicks "Login with Browser".
 */
export async function performBrowserLoginAndInit(): Promise<void> {
  try {
    setAuthState('authenticating');
    const result = await performDesktopBrowserAuth({ webUrl: env.NIMI_WEB_URL });
    saveToken(result.accessToken);
    env.NIMI_ACCESS_TOKEN = result.accessToken;

    // Initialize platform clients with new token
    ({ runtime, realm } = initPlatformClient(env));
    registerIpcHandlers(runtime, realm, getWebContents, env);
    initRealtimeRelay(env.NIMI_REALM_URL, env.NIMI_ACCESS_TOKEN!, getWebContents);

    setAuthState('authenticated');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setAuthState('failed', message);
    throw error;
  }
}

app.whenReady().then(async () => {
  // Step 1: Parse environment variables (RL-BOOT-003)
  env = parseEnv();

  // Step 2: Register auth IPC handlers early (before window needs them)
  const { registerAuthIpcHandlers } = await import('./ipc-handlers.js');
  registerAuthIpcHandlers();

  // Step 3: Create window immediately so user sees UI
  createWindow();

  // Step 4: Try silent token resolution (env → persisted)
  const token = env.NIMI_ACCESS_TOKEN || loadToken() || null;

  if (token) {
    // Token available — initialize platform clients
    env.NIMI_ACCESS_TOKEN = token;
    ({ runtime, realm } = initPlatformClient(env));
    initRealtimeRelay(env.NIMI_REALM_URL, token, getWebContents);
    registerIpcHandlers(runtime, realm, getWebContents, env);
    setAuthState('authenticated');
  } else {
    // No token — show login page, wait for user to click "Login with Browser"
    setAuthState('pending');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS: re-create window on dock click
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
