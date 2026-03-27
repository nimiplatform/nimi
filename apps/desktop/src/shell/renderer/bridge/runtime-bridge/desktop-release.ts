import { listenTauri } from '@runtime/tauri-api';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseDesktopReleaseInfo,
  parseDesktopUpdateCheckResult,
  parseDesktopUpdateState,
  type DesktopReleaseInfo,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
} from './types';

type TauriEventUnsubscribe = () => void;
type TauriListenResult = Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

const DESKTOP_UPDATE_STATE_EVENT = 'desktop-update://state';

function resolveTauriEventListen(): ((eventName: string, handler: (event: { payload: unknown }) => void) => TauriListenResult) | null {
  if (!hasTauriInvoke()) {
    return null;
  }
  return listenTauri;
}

export async function getDesktopReleaseInfo(): Promise<DesktopReleaseInfo> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_release_info_get requires Tauri runtime');
  }
  return invokeChecked('desktop_release_info_get', {}, parseDesktopReleaseInfo);
}

export async function getDesktopUpdateState(): Promise<DesktopUpdateState> {
  if (!hasTauriInvoke()) {
    return {
      status: 'idle',
      currentVersion: '',
      downloadedBytes: 0,
      readyToRestart: false,
    };
  }
  return invokeChecked('desktop_update_state_get', {}, parseDesktopUpdateState);
}

export async function desktopUpdateCheck(): Promise<DesktopUpdateCheckResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_update_check requires Tauri runtime');
  }
  return invokeChecked('desktop_update_check', {}, parseDesktopUpdateCheckResult);
}

export async function desktopUpdateDownload(): Promise<DesktopUpdateCheckResult> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_update_download requires Tauri runtime');
  }
  return invokeChecked('desktop_update_download', {}, parseDesktopUpdateCheckResult);
}

export async function desktopUpdateInstall(): Promise<DesktopUpdateState> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_update_install requires Tauri runtime');
  }
  return invokeChecked('desktop_update_install', {}, parseDesktopUpdateState);
}

export async function desktopUpdateRestart(): Promise<void> {
  if (!hasTauriInvoke()) {
    throw new Error('desktop_update_restart requires Tauri runtime');
  }
  await invokeChecked('desktop_update_restart', {}, () => undefined);
}

export async function subscribeDesktopUpdateState(
  onEvent: (event: DesktopUpdateState) => void,
): Promise<() => void> {
  const listen = resolveTauriEventListen();
  if (!listen) {
    return () => {};
  }
  const unsubscribe = await Promise.resolve(listen(DESKTOP_UPDATE_STATE_EVENT, (event) => {
    onEvent(parseDesktopUpdateState(event.payload));
  }));
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
