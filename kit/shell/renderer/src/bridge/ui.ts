import {
  parseOpenExternalUrlResult,
  type OpenExternalUrlResult,
} from '@nimiplatform/kit/core/oauth';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invoke, invokeChecked } from './invoke.js';
import {
  parseConfirmDialogResult,
  type ConfirmDialogPayload,
  type ConfirmDialogResult,
} from './types.js';

export function normalizeShellExternalUrl(url: string): string {
  const normalized = String(url || '').trim();
  if (!normalized) {
    throw new Error('URL is required');
  }

  const baseUrl = typeof window !== 'undefined' ? window.location?.href || 'https://nimi.invalid' : 'https://nimi.invalid';
  const parsed = new URL(normalized, baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export async function openExternalUrl(url: string): Promise<OpenExternalUrlResult> {
  const normalized = normalizeShellExternalUrl(url);
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'], {
    payload: { url: normalized },
  }, parseOpenExternalUrlResult);
}

export async function confirmDialog(payload: ConfirmDialogPayload): Promise<ConfirmDialogResult> {
  return invokeChecked('confirm_dialog', { payload }, parseConfirmDialogResult);
}

export async function startWindowDrag(): Promise<void> {
  await invokeChecked('start_window_drag', {}, () => undefined);
}

export async function focusMainWindow(): Promise<void> {
  await invoke('focus_main_window', {});
}
