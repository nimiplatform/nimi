// How a reminder reaches the user while NimiDay runs: always inside the App,
// and as a system notification when the user allowed it. Quiet hours are
// decided by the caller; this module only delivers.

import { nimiToast } from '@nimiplatform/kit/ui';

export type SystemPermission = 'granted' | 'denied' | 'default' | 'unsupported';
export type SystemDeliveryStatus = 'submitted' | 'shown' | 'failed' | 'unavailable' | 'unconfirmed';

export function systemPermission(): SystemPermission {
  const api = globalThis.Notification;
  if (typeof api !== 'function') return 'unsupported';
  return api.permission as SystemPermission;
}

export async function requestSystemPermission(): Promise<SystemPermission> {
  const api = globalThis.Notification;
  if (typeof api !== 'function') return 'unsupported';
  try {
    return (await api.requestPermission()) as SystemPermission;
  } catch {
    return systemPermission();
  }
}

export type Delivery = {
  readonly title: string;
  readonly body: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  readonly tag: string;
  readonly tone?: 'info' | 'warning' | 'success';
  readonly system: boolean;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly onOpen?: () => void;
  readonly onSystemStatus?: (status: SystemDeliveryStatus) => void;
};

const shown = new Map<string, Notification>();

export function deliver(delivery: Delivery): { readonly system: boolean } {
  nimiToast.show({
    tone: delivery.tone ?? 'info',
    title: delivery.title,
    message: delivery.body,
    durationMs: 12_000,
    ...(delivery.action ? { action: delivery.action } : {}),
  });
  if (!delivery.system || systemPermission() !== 'granted') {
    delivery.onSystemStatus?.('unavailable');
    return { system: false };
  }
  try {
    shown.get(delivery.tag)?.close();
    const notification = new Notification(delivery.title, { body: delivery.body, tag: delivery.tag });
    // Windows can suppress a notification without changing the browser's
    // permission or emitting show/error. Do not leave a test waiting forever.
    const feedbackTimer = delivery.onSystemStatus
      ? setTimeout(() => delivery.onSystemStatus?.('unconfirmed'), 8_000) : undefined;
    notification.onshow = () => {
      clearTimeout(feedbackTimer);
      delivery.onSystemStatus?.('shown');
    };
    notification.onerror = () => {
      clearTimeout(feedbackTimer);
      if (shown.get(delivery.tag) === notification) shown.delete(delivery.tag);
      delivery.onSystemStatus?.('failed');
    };
    notification.onclick = () => {
      globalThis.focus?.();
      delivery.onOpen?.();
      notification.close();
    };
    notification.onclose = () => {
      clearTimeout(feedbackTimer);
      if (shown.get(delivery.tag) === notification) shown.delete(delivery.tag);
    };
    shown.set(delivery.tag, notification);
    delivery.onSystemStatus?.('submitted');
    return { system: true };
  } catch {
    delivery.onSystemStatus?.('failed');
    return { system: false };
  }
}

export function dismissDelivery(tag: string): void {
  shown.get(tag)?.close();
  shown.delete(tag);
}
