export {
  installNimiShellRuntimeBridge,
  getRuntimeDefaults,
  getDaemonStatus,
  startDaemon,
} from '@nimiplatform/kit/shell/renderer/bridge';
export {
  getAvatarLaunchContext,
  parseAvatarLaunchContext,
  refreshAvatarHostBinding,
} from './launch-context.js';

export type {
  NimiShellRuntimeBridgeResult,
  RuntimeDefaults,
  RuntimeBridgeDaemonStatus,
} from '@nimiplatform/kit/shell/renderer/bridge';
export type {
  AvatarLaunchContext,
} from './launch-context.js';
