import type { BrowserWindowConstructorOptions } from 'electron';

export function createBundledAvatarWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 420,
    height: 680,
    minWidth: 390,
    minHeight: 520,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Nimi Avatar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
