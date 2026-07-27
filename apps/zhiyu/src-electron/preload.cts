import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentBinding', {
  localAppCarrier: {
    kind: 'protected-local-app-carrier',
  },
});
