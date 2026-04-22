export {
  hasTauriInvoke,
  getRuntimeDefaults,
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
  watchAuthSessionChanges,
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
  SharedDesktopAuthSessionWatchOptions,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';
export type {
  AvatarLaunchAnchorMode,
  AvatarLaunchContext,
} from './launch-context.js';
