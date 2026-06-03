export {
  hasTauriInvoke,
  installNimiShellRuntimeBridge,
  getRuntimeDefaults,
  getDaemonStatus,
  startDaemon,
} from '@nimiplatform/kit/shell/renderer/bridge';
export {
  getAvatarLaunchContext,
  parseAvatarLaunchContext,
} from './launch-context.js';

export type {
  NimiShellRuntimeBridgeResult,
  RuntimeDefaults,
  RuntimeBridgeDaemonStatus,
} from '@nimiplatform/kit/shell/renderer/bridge';
export type {
  AvatarLaunchContext,
} from './launch-context.js';
