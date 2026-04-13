import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseConfirmDialogResult,
  parseConfirmPrivateSyncResult,
  parseOpenExternalUrlResult,
  type ConfirmDialogPayload,
  type ConfirmDialogResult,
  type ConfirmPrivateSyncPayload,
  type ConfirmPrivateSyncResult,
  type OpenExternalUrlResult,
} from './types';

function normalizeExternalUrl(url: string): string {
  const normalized = String(url || '').trim();
  if (!normalized) {
    throw new Error('URL is required');
  }

  const baseUrl =
    typeof window !== 'undefined' && window.location
      ? window.location.href
      : 'https://nimi.invalid';
  const parsed = new URL(normalized, baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export async function openExternalUrl(url: string): Promise<OpenExternalUrlResult> {
  const normalized = normalizeExternalUrl(url);

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
        'LOCAL route will upload local content to the platform governance chain. Continue?',
      ),
    };
  }

  return invokeChecked('confirm_private_sync', { payload }, parseConfirmPrivateSyncResult);
}

export async function confirmDialog(payload: ConfirmDialogPayload): Promise<ConfirmDialogResult> {
  if (!hasTauriInvoke()) {
    return {
      confirmed: window.confirm(payload.description),
    };
  }

  return invokeChecked('confirm_dialog', { payload }, parseConfirmDialogResult);
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
