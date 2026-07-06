import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';

const ZHIYU_AGENT_CENTER_LOCAL_CONFIG_CHANNEL = 'zhiyu:agent-center-local-config';
const ZHIYU_AVATAR_LAUNCH_HANDOFF_CHANNEL = 'zhiyu:avatar-launch-handoff';
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
const ZHIYU_AVATAR_LAUNCH_HANDOFF_COMMANDS = new Set([
  'avatar.launch',
]);

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

let runtimeAgentScopedBinding: Record<string, unknown> | null = null;

contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentBinding', {
  hostEquivalence: {
    evidenceRef: 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
    authority: 'runtime-sdk',
    failureSemantics: 'fail-closed',
  },
  getScopedBinding() {
    return runtimeAgentScopedBinding;
  },
  setScopedBinding(scopedBinding: Record<string, unknown>) {
    runtimeAgentScopedBinding = { ...scopedBinding };
    return runtimeAgentScopedBinding;
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

contextBridge.exposeInMainWorld('__nimiZhiyuAvatarLaunchHandoff', {
  invoke(command: string, payload: Record<string, unknown>) {
    if (!ZHIYU_AVATAR_LAUNCH_HANDOFF_COMMANDS.has(command)) {
      throw new Error(`Unsupported Zhiyu Avatar launch handoff command: ${command}`);
    }
    return ipcRenderer.invoke(ZHIYU_AVATAR_LAUNCH_HANDOFF_CHANNEL, {
      command,
      payload,
    });
  },
});
