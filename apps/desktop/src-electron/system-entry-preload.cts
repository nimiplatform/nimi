import { contextBridge, ipcRenderer } from 'electron';
import {
  SYSTEM_ENTRY_CHANNELS,
  parseSystemEntryActionRequest,
  type SystemEntryBridge,
  type SystemEntrySnapshot,
} from '../src/shell/shared/system-entry-types.js';

// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
// Never install the Home runtime bridge in this renderer.
const bridge: SystemEntryBridge = Object.freeze({
  getSnapshot: () => ipcRenderer.invoke(SYSTEM_ENTRY_CHANNELS.snapshot) as Promise<SystemEntrySnapshot>,
  onSnapshot(listener: (snapshot: SystemEntrySnapshot) => void): () => void {
    if (typeof listener !== 'function') throw new Error('system-entry-listener-invalid');
    const receive = (_event: Electron.IpcRendererEvent, snapshot: SystemEntrySnapshot): void => listener(snapshot);
    ipcRenderer.on(SYSTEM_ENTRY_CHANNELS.changed, receive);
    return () => { ipcRenderer.removeListener(SYSTEM_ENTRY_CHANNELS.changed, receive); };
  },
  act: (request) => ipcRenderer.invoke(SYSTEM_ENTRY_CHANNELS.action, parseSystemEntryActionRequest(request)) as Promise<void>,
  close: () => ipcRenderer.invoke(SYSTEM_ENTRY_CHANNELS.close) as Promise<void>,
  openMenu: () => ipcRenderer.invoke(SYSTEM_ENTRY_CHANNELS.menu) as Promise<void>,
});
contextBridge.exposeInMainWorld('nimiSystemEntry', bridge);
