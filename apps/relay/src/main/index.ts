// RL-BOOT-001 — Main Process Initialization
// RL-BOOT-004 — Runtime Unavailable Degradation

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { parseEnv, type RelayEnv } from './env.js';
import { initPlatformClient } from './platform-client.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { initRealtimeRelay } from './realtime-relay.js';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { Realm } from '@nimiplatform/sdk/realm';

let mainWindow: BrowserWindow | null = null;
let env: RelayEnv;
let runtime: Runtime;
let realm: Realm;

function getWebContents() {
  return mainWindow?.webContents ?? null;
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

app.whenReady().then(() => {
  // Step 1: Parse environment variables (RL-BOOT-003)
  env = parseEnv();

  // Steps 2-3: Initialize Runtime (node-grpc) + Realm (openapi-fetch)
  // RL-BOOT-001 spec defines these as separate steps; combined here in initPlatformClient
  ({ runtime, realm } = initPlatformClient(env));

  // Step 4: Establish socket.io connection (RL-INTOP-003)
  initRealtimeRelay(env.NIMI_REALM_URL, env.NIMI_ACCESS_TOKEN, getWebContents);

  // Step 5: Register IPC handlers (RL-IPC-001 ~ 009)
  registerIpcHandlers(runtime, realm, getWebContents, env);

  // Step 6: Create BrowserWindow and load renderer
  createWindow();
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
