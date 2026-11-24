import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

const ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL = 'nimi:zhiyu:resource-pack-placement:event';
const ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL = 'nimi:zhiyu:resource-pack-placement:ack';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
  invokeChannel: readPreloadArg('--nimi-electron-runtime-invoke-channel'),
  listenChannelPrefix: readPreloadArg('--nimi-electron-runtime-event-channel-prefix'),
});

function readPreloadArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentAccess', {
  localAppCarrier: {
    kind: 'protected-local-app-carrier',
  },
});

let activeResourcePackPlacementRequestId = '';
contextBridge.exposeInMainWorld('__nimiZhiyuResourcePackPlacement', {
  subscribe(listener: (payload: unknown) => void) {
    const handler = (_event: unknown, payload: unknown) => {
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      activeResourcePackPlacementRequestId = typeof record.requestId === 'string' ? record.requestId : '';
      listener({
        schemaVersion: record.schemaVersion,
        agentHandle: record.agentHandle,
      });
    };
    ipcRenderer.on(ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL, handler);
    return () => {
      activeResourcePackPlacementRequestId = '';
      ipcRenderer.removeListener(ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL, handler);
    };
  },
  acknowledge(payload: unknown) {
    const record = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const requestId = activeResourcePackPlacementRequestId;
    activeResourcePackPlacementRequestId = '';
    ipcRenderer.send(ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL, {
      ...record,
      requestId,
    });
  },
});

// Only the supervised Host may offer an open target; the renderer cannot issue one here.
contextBridge.exposeInMainWorld('__nimiZhiyuConversationOpen', {
  subscribe(listener: (value: unknown) => void) {
    let active = true;
    const read = () => { void ipcRenderer.invoke('nimi:zhiyu:conversation-open:read').then(value => {
      if (active) listener(value);
    }).catch(() => undefined); };
    ipcRenderer.on('nimi:zhiyu:conversation-open:event', read);
    read();
    return () => { active = false; ipcRenderer.removeListener('nimi:zhiyu:conversation-open:event', read); };
  },
  acknowledge(value: unknown) { ipcRenderer.send('nimi:zhiyu:conversation-open:ack', value); },
});

// Controlled brief-only handoff from Zhiyu to Harness via Runtime AgentSessionService.
contextBridge.exposeInMainWorld('__nimiZhiyuHarnessHandoff', {
  submit(payload: unknown) {
    return ipcRenderer.invoke('nimi:zhiyu:harness-handoff:submit', payload);
  },
});
