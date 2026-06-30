import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
  invokeChannel: readPreloadArg('--nimi-electron-runtime-invoke-channel'),
  listenChannelPrefix: readPreloadArg('--nimi-electron-runtime-event-channel-prefix'),
});

function readPreloadArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}
