import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentAccess', {
  localAppCarrier: {
    kind: 'protected-local-app-carrier',
  },
});
