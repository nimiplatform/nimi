import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

const ZHIYU_RESOURCE_PACK_PLACEMENT_EVENT_CHANNEL = 'nimi:zhiyu:resource-pack-placement:event';
const ZHIYU_RESOURCE_PACK_PLACEMENT_ACK_CHANNEL = 'nimi:zhiyu:resource-pack-placement:ack';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

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
