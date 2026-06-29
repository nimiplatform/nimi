import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});
