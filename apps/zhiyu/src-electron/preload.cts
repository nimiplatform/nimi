import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';
import { DEV_KERNEL_RESTART_PROBE } from './dev-kernel-restart-probe.js';
import { resolveZhiyuLocalDevelopmentAgentId } from './local-development-contract.js';

const LOCAL_DEVELOPMENT_PRELOAD_MARKER = '--nimi-local-development=1';

installNimiElectronRuntimeBridge({
  contextBridge,
  ipcRenderer,
});

const localDevelopment = process.argv.includes(LOCAL_DEVELOPMENT_PRELOAD_MARKER);
const localDevelopmentAgentId = resolveZhiyuLocalDevelopmentAgentId({
  localDevelopment,
  selector: readOptionalArgument('--nimi-dev-agent-id'),
});
if (localDevelopment) {
  contextBridge.exposeInMainWorld('__nimiZhiyuLocalDevelopment', Object.freeze({
    profile: 'isolated-local-development',
    ...(localDevelopmentAgentId ? { agentId: localDevelopmentAgentId } : {}),
    buildMarker: DEV_KERNEL_RESTART_PROBE,
  }));
}
contextBridge.exposeInMainWorld('__nimiZhiyuRuntimeAgentBinding', {
  localAppCarrier: {
    evidenceRef: 'runtime-sdk-authority:kit-electron-local-app-host',
    authority: 'local-app-carrier',
    failureSemantics: 'fail-closed',
  },
});

function readOptionalArgument(name: string): string | undefined {
  const prefix = `${name}=`;
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix));
  return argument === undefined ? undefined : argument.slice(prefix.length).trim();
}
