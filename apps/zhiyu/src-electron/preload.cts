import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

const ZHIYU_AGENT_CENTER_LOCAL_CONFIG_CHANNEL = 'zhiyu:agent-center-local-config';
const ZHIYU_AGENT_CENTER_COMMANDS = new Set([
  'config.get',
  'config.put',
  'avatar.pickLive2dSource',
  'avatar.pickVrmSource',
  'avatar.import',
  'avatar.validate',
  'avatar.pickLive2dAdapterManifest',
  'avatar.importLive2dAdapterManifest',
  'background.pickSource',
  'background.import',
  'background.get',
  'background.remove',
]);

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentBinding', {
  hostEquivalence: {
    evidenceRef: 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
    authority: 'runtime-sdk',
    failureSemantics: 'fail-closed',
  },
});

contextBridge.exposeInMainWorld('__nimiZhiyuAgentCenterLocalConfig', {
  invoke(command: string, payload: Record<string, unknown>) {
    if (!ZHIYU_AGENT_CENTER_COMMANDS.has(command)) {
      throw new Error(`Unsupported Zhiyu Agent Center local config command: ${command}`);
    }
    return ipcRenderer.invoke(ZHIYU_AGENT_CENTER_LOCAL_CONFIG_CHANNEL, {
      command,
      payload,
    });
  },
});
