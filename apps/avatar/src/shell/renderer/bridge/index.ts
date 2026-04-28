export {
  hasTauriInvoke,
  getRuntimeDefaults,
  getDaemonStatus,
  startDaemon,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';
export {
  getAvatarLaunchContext,
  parseAvatarLaunchContext,
} from './launch-context.js';

export type {
  RuntimeDefaults,
  RuntimeBridgeDaemonStatus,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';
export type {
  AvatarLaunchContext,
  AvatarScopedBindingProjection,
} from './launch-context.js';
