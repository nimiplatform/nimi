// RL-BOOT-001 — Main Process Initialization
// RL-BOOT-004 — Runtime Unavailable Degradation
// RL-BOOT-005 — Auth Flow Integration

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { parseEnv, type RelayEnv } from './env.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerModelIpcHandlers } from './model-handlers.js';
import { registerDesktopInteropHandlers } from './desktop-interop.js';
import { initRealtimeRelay } from './realtime-relay.js';
import { loadToken, saveToken, clearToken } from './auth/index.js';
import { createRouteState } from './route/route-state.js';
import { registerRouteHandlers } from './route/route-handlers.js';
import type { RouteState } from './route/route-state.js';

/**
 * Invalidate the current auth session: clear persisted token,
 * wipe the in-memory token, and transition to 'pending' state
 * so the renderer shows the login page.
 */
export function invalidateAuth(): void {
  clearToken();
  env.NIMI_ACCESS_TOKEN = undefined;
  setAuthState('pending');
}

let mainWindow: BrowserWindow | null = null;
let env: RelayEnv;
let runtime: PlatformClient['runtime'];
let realm: PlatformClient['realm'];
let routeState: RouteState;

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

async function initializeRouteStateOrThrow(runtimeClient: PlatformClient['runtime']): Promise<RouteState> {
  const nextRouteState = createRouteState();
  await nextRouteState.initialize(runtimeClient);
  registerRouteHandlers(runtimeClient, nextRouteState);
  return nextRouteState;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
 * Apply a token obtained by the renderer (via Social OAuth) and initialize
 * platform clients. Called from `relay:auth:apply-token` IPC handler.
 */
export async function applyTokenAndInit(accessToken: string): Promise<void> {
  try {
    setAuthState('authenticating');
    saveToken(accessToken);
    env.NIMI_ACCESS_TOKEN = accessToken;

    // Initialize platform clients with new token
    ({ runtime, realm } = await createPlatformClient({
      appId: 'nimi.relay',
      realmBaseUrl: env.NIMI_REALM_URL,
      accessToken,
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: env.NIMI_RUNTIME_GRPC_ADDR,
      },
    }));

    routeState = await initializeRouteStateOrThrow(runtime);

    registerIpcHandlers(runtime, realm, getWebContents, env, routeState);
    registerModelIpcHandlers(runtime);
    initRealtimeRelay(env.NIMI_REALM_URL, env.NIMI_ACCESS_TOKEN!, getWebContents, {
      allowInsecureHttp: !app.isPackaged,
    });

    setAuthState('authenticated');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setAuthState('failed', message);
    throw error;
  }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getEnv(): RelayEnv {
  return env;
}

app.whenReady().then(async () => {
  // Step 1: Parse environment variables (RL-BOOT-003)
  env = parseEnv();

  // Step 2: Register auth + desktop interop IPC handlers early (before window needs them)
  const { registerAuthIpcHandlers } = await import('./ipc-handlers.js');
  registerAuthIpcHandlers(env, () => mainWindow);
  registerDesktopInteropHandlers();

  // Step 3: Create window immediately so user sees UI
  createWindow();

  // Step 4: Try silent token resolution (env → persisted)
  let token = env.NIMI_ACCESS_TOKEN || null;
  if (!token) {
    try {
      token = loadToken() || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthState('failed', message);
      token = null;
    }
  }

  if (token) {
    // Token available — validate via runtime.health() (main process, no IPC serialization)
    env.NIMI_ACCESS_TOKEN = token;
    ({ runtime, realm } = await createPlatformClient({
      appId: 'nimi.relay',
      realmBaseUrl: env.NIMI_REALM_URL,
      accessToken: token,
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: env.NIMI_RUNTIME_GRPC_ADDR,
      },
    }));

    try {
      await runtime.health();
    } catch (healthError) {
      const reason = (healthError as { reasonCode?: string }).reasonCode;
      if (reason === ReasonCode.AUTH_TOKEN_INVALID || reason === ReasonCode.AUTH_DENIED) {
        clearToken();
        env.NIMI_ACCESS_TOKEN = undefined;
        setAuthState('pending');
        return;
      }
    }

    try {
      routeState = await initializeRouteStateOrThrow(runtime);
      initRealtimeRelay(env.NIMI_REALM_URL, token, getWebContents, {
        allowInsecureHttp: !app.isPackaged,
      });
      registerIpcHandlers(runtime, realm, getWebContents, env, routeState);
      registerModelIpcHandlers(runtime);
      setAuthState('authenticated');
    } catch (bootstrapError) {
      const message = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError);
      setAuthState('failed', message);
    }
  } else {
    // No token — show login page, wait for Social OAuth
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
