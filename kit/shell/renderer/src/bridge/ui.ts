import {
  parseOpenExternalUrlResult,
  type OpenExternalUrlResult,
} from '@nimiplatform/kit/core/oauth';
import { hasShellHostInvoke } from './env.js';
import { invoke, invokeChecked } from './invoke.js';
import {
  parseConfirmDialogResult,
  type ConfirmDialogPayload,
  type ConfirmDialogResult,
} from './types.js';

function windowLike(): (Window & typeof globalThis) | undefined {
  return typeof window !== 'undefined' ? window : undefined;
}

export function normalizeShellExternalUrl(url: string): string {
  const normalized = String(url || '').trim();
  if (!normalized) {
    throw new Error('URL is required');
  }

  const baseUrl = windowLike()?.location?.href || 'https://nimi.invalid';
  const parsed = new URL(normalized, baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported: ${parsed.protocol}`);
  }
  return parsed.toString();
}

export async function openExternalUrl(url: string): Promise<OpenExternalUrlResult> {
  const normalized = normalizeShellExternalUrl(url);
  if (!hasShellHostInvoke()) {
    const openedWindow = windowLike()?.open?.(normalized, '_blank', 'noopener,noreferrer');
    return { opened: Boolean(openedWindow) };
  }
  return invokeChecked('open_external_url', {
    payload: { url: normalized },
  }, parseOpenExternalUrlResult);
}

export async function confirmDialog(payload: ConfirmDialogPayload): Promise<ConfirmDialogResult> {
  if (!hasShellHostInvoke()) {
    return {
      confirmed: Boolean(windowLike()?.confirm?.(payload.description)),
    };
  }
  return invokeChecked('confirm_dialog', { payload }, parseConfirmDialogResult);
}

export async function startWindowDrag(): Promise<void> {
  if (!hasShellHostInvoke()) {
    return;
  }
  await invokeChecked('start_window_drag', {}, () => undefined);
}

export async function focusMainWindow(): Promise<void> {
  if (!hasShellHostInvoke()) {
    windowLike()?.focus?.();
    return;
  }
  try {
    await invoke('focus_main_window', {});
  } catch {
    // Some scaffold shells do not expose focus_main_window; focusing is advisory.
  }
}
