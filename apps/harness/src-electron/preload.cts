import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

function readPreloadArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
  invokeChannel: readPreloadArg('--nimi-electron-runtime-invoke-channel'),
  listenChannelPrefix: readPreloadArg('--nimi-electron-runtime-event-channel-prefix'),
});

contextBridge.exposeInMainWorld('nimiHarness', {
  importHome: (source: string) => ipcRenderer.invoke('harness:import-home', source),
  importMaterial: (id: string, name: string, data: Uint8Array) => ipcRenderer.invoke('harness:import-material', id, name, data),
  listFiles: (id: string, folder: string, offset: number) => ipcRenderer.invoke('harness:list-files', id, folder, offset),
  previewFile: (id: string, ref: string, page?: number) => ipcRenderer.invoke('harness:preview-file', id, ref, page),
  revealFile: (id: string, ref: string) => ipcRenderer.invoke('harness:reveal-file', id, ref),
  revealWorkspace: (id: string) => ipcRenderer.invoke('harness:reveal-workspace', id),
  chooseWorkspace: () => ipcRenderer.invoke('harness:choose-workspace'),
  setWorkspace: (id: string, dir: string | null) => ipcRenderer.invoke('harness:set-workspace', id, dir),
  snapshot: () => ipcRenderer.invoke('harness:snapshot'),
  onViewChanged: (notify: () => void) => {
    const changed = () => notify();
    ipcRenderer.on('harness:view-changed', changed);
    return () => { ipcRenderer.removeListener('harness:view-changed', changed); };
  },
  onFocusSession: (notify: (workSessionRef: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, workSessionRef: unknown) => {
      if (typeof workSessionRef === 'string' && workSessionRef.trim()) {
        notify(workSessionRef.trim());
      }
    };
    ipcRenderer.on('harness:focus-session', listener);
    return () => { ipcRenderer.removeListener('harness:focus-session', listener); };
  },
  create: (configRef?: string, workspaceDir?: string) => ipcRenderer.invoke('harness:create', configRef, workspaceDir),
  select: (id: string) => ipcRenderer.invoke('harness:select', id),
  rename: (id: string, title: string) => ipcRenderer.invoke('harness:rename', id, title),
  deleteSession: (id: string) => ipcRenderer.invoke('harness:delete-session', id),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke('harness:pin-session', id, pinned),
  setPermissionMode: (id: string, mode: string) => ipcRenderer.invoke('harness:set-permission-mode', id, mode),
  setReasoningEffort: (id: string, effort: string | null) => ipcRenderer.invoke('harness:set-reasoning-effort', id, effort),
  exportMarkdown: (id: string) => ipcRenderer.invoke('harness:export-markdown', id),
  listIntegrations: () => ipcRenderer.invoke('harness:list-integrations'),
  withdraw: (id: string, input: number) => ipcRenderer.invoke('harness:withdraw', id, input),
  setInstructions: (id: string, text: string) => ipcRenderer.invoke('harness:instructions', id, text),
  submit: (session: string, text: string, id: string, queue: boolean) => ipcRenderer.invoke('harness:submit', session, text, id, queue),
  decide: (session: string, id: number, allow: boolean, feedback?: string, allowForSession?: boolean, revision?: string) =>
    ipcRenderer.invoke('harness:decide', session, id, allow, feedback, allowForSession, revision),
  listSnapshots: (session: string) => ipcRenderer.invoke('harness:list-snapshots', session),
  restoreSnapshot: (session: string, snapshotId: string) => ipcRenderer.invoke('harness:restore-snapshot', session, snapshotId),
  reviewModel: (id: string, confirmation?: string, configRef?: string) => ipcRenderer.invoke('harness:review-model', id, confirmation, configRef),
  stop: (session: string) => ipcRenderer.invoke('harness:stop', session),
  resume: (session: string) => ipcRenderer.invoke('harness:resume', session),
});
