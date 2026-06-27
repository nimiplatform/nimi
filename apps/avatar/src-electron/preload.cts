import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

contextBridge.exposeInMainWorld('__NIMI_AVATAR_ELECTRON__', {
  invoke: (command: string, payload?: unknown) => ipcRenderer.invoke('nimi:avatar:invoke', {
    command,
    payload: payload ?? {},
  }),
});
