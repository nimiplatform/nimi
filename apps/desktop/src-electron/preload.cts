import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
  invokeChannel: readPreloadArg('--nimi-electron-runtime-invoke-channel'),
  listenChannelPrefix: readPreloadArg('--nimi-electron-runtime-event-channel-prefix'),
});

// Electron 45 removed File.path; expose a narrow frozen lookup via webUtils for read-only drag-and-drop.
contextBridge.exposeInMainWorld('__NIMI_DESKTOP_FILE_PATH__', (file: File): string => {
  try {
    return typeof webUtils?.getPathForFile === 'function' ? webUtils.getPathForFile(file) || '' : '';
  } catch {
    return '';
  }
});

function readPreloadArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}
