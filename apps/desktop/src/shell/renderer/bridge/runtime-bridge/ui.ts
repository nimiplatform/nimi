import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseConfirmPrivateSyncResult,
  parseOpenExternalUrlResult,
  type ConfirmPrivateSyncPayload,
  type ConfirmPrivateSyncResult,
  type OpenExternalUrlResult,
} from './types';

export async function openExternalUrl(url: string): Promise<OpenExternalUrlResult> {
  const normalized = String(url || '').trim();
  if (!normalized) {
    throw new Error('URL 不能为空');
  }

  if (!hasTauriInvoke()) {
    const openedWindow = window.open(normalized, '_blank', 'noopener,noreferrer');
    return { opened: Boolean(openedWindow) };
  }

  return invokeChecked('open_external_url', {
    payload: {
      url: normalized,
    },
  }, parseOpenExternalUrlResult);
}

export async function confirmPrivateSync(payload: ConfirmPrivateSyncPayload): Promise<ConfirmPrivateSyncResult> {
  if (!hasTauriInvoke()) {
    return {
      confirmed: window.confirm(
        'LOCAL 路由会将本地内容上传到平台治理链。是否确认上传？',
      ),
    };
  }

  return invokeChecked('confirm_private_sync', { payload }, parseConfirmPrivateSyncResult);
}

export async function startWindowDrag(): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeChecked('start_window_drag', {}, () => undefined);
}

export async function focusMainWindow(): Promise<void> {
  if (!hasTauriInvoke()) {
    window.focus();
    return;
  }
  await invokeChecked('focus_main_window', {}, () => undefined);
}
