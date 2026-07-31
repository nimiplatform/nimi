/**
 * `primitive.toast` store (P-DESIGN-010 / content-feedback.yaml).
 *
 * Framework-agnostic imperative queue behind `NimiToaster`. The store is
 * a module-level singleton so toasts raised before the toaster mounts
 * render as soon as it does. `NimiToaster` subscribes through
 * `useSyncExternalStore`; `getNimiToastSnapshot` therefore keeps a stable
 * array reference whenever the visible set has not changed.
 *
 * At most `NIMI_TOAST_MAX_VISIBLE` toasts are visible; the rest wait in a
 * FIFO queue and are promoted as visible toasts are dismissed.
 */

import type { FeedbackTone } from '../design-tokens.js';

export type NimiToastTone = FeedbackTone;

export type NimiToastAction = {
  label: string;
  onClick: () => void;
};

export type NimiToastInput = {
  tone?: NimiToastTone;
  title?: string;
  message: string;
  action?: NimiToastAction;
  /** Auto-dismiss delay. `Infinity` keeps the toast until dismissed. */
  durationMs?: number;
  /** Sticky toasts never auto-dismiss (equivalent to `durationMs: Infinity`). */
  sticky?: boolean;
};

export type NimiToastRecord = {
  id: string;
  tone: NimiToastTone;
  title?: string;
  message: string;
  action?: NimiToastAction;
  /** Resolved auto-dismiss delay; `Infinity` means the toast stays. */
  durationMs: number;
  createdAt: number;
};

export const NIMI_TOAST_MAX_VISIBLE = 4;

/** Tone-default auto-dismiss delays (P-DESIGN-010 feedback grammar). */
const NIMI_TOAST_DEFAULT_DURATION_MS: Record<NimiToastTone, number> = {
  neutral: 4000,
  success: 4000,
  info: 4000,
  warning: 6000,
  danger: 8000,
};

let idCounter = 0;
let visible: readonly NimiToastRecord[] = [];
let queued: readonly NimiToastRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Store subscription for `useSyncExternalStore`; returns an unsubscribe. */
export function subscribeNimiToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Visible toasts only. The returned array reference is stable until the
 * visible set actually changes (required by `useSyncExternalStore`).
 */
export function getNimiToastSnapshot(): readonly NimiToastRecord[] {
  return visible;
}

function show(input: NimiToastInput): string {
  const tone = input.tone ?? 'neutral';
  const sticky = input.sticky === true || input.durationMs === Infinity;
  const durationMs = sticky
    ? Infinity
    : input.durationMs ?? NIMI_TOAST_DEFAULT_DURATION_MS[tone];
  const record: NimiToastRecord = {
    id: `nimi-toast-${++idCounter}`,
    tone,
    title: input.title,
    message: input.message,
    action: input.action,
    durationMs,
    createdAt: Date.now(),
  };
  if (visible.length < NIMI_TOAST_MAX_VISIBLE) {
    visible = [...visible, record];
  } else {
    queued = [...queued, record];
  }
  emit();
  return record.id;
}

function dismiss(id: string): void {
  const wasVisible = visible.some((toast) => toast.id === id);
  const wasQueued = queued.some((toast) => toast.id === id);
  if (!wasVisible && !wasQueued) {
    return;
  }
  if (wasQueued) {
    queued = queued.filter((toast) => toast.id !== id);
  }
  if (wasVisible) {
    visible = visible.filter((toast) => toast.id !== id);
    // Promote queued toasts FIFO into the freed slots.
    while (visible.length < NIMI_TOAST_MAX_VISIBLE && queued.length > 0) {
      const [next, ...rest] = queued;
      if (!next) {
        break;
      }
      visible = [...visible, next];
      queued = rest;
    }
  }
  emit();
}

function clear(): void {
  if (visible.length === 0 && queued.length === 0) {
    return;
  }
  visible = [];
  queued = [];
  emit();
}

type NimiToastToneOptions = Omit<NimiToastInput, 'tone' | 'message'>;

/** Imperative toast entry points; safe to call outside React. */
export const nimiToast = {
  show,
  success: (message: string, options?: NimiToastToneOptions): string =>
    show({ ...options, tone: 'success', message }),
  info: (message: string, options?: NimiToastToneOptions): string =>
    show({ ...options, tone: 'info', message }),
  warning: (message: string, options?: NimiToastToneOptions): string =>
    show({ ...options, tone: 'warning', message }),
  danger: (message: string, options?: NimiToastToneOptions): string =>
    show({ ...options, tone: 'danger', message }),
  neutral: (message: string, options?: NimiToastToneOptions): string =>
    show({ ...options, tone: 'neutral', message }),
  dismiss,
  clear,
} as const;
