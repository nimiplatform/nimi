/**
 * `primitive.toast` renderer (P-DESIGN-010 / content-feedback.yaml).
 *
 * `NimiToaster` portals the admitted `nimi-toast-viewport` slot into
 * `document.body` and renders the visible slice of the module-level toast
 * store. Motion stays on the admitted feedback grammar (P-DESIGN-027):
 * spring slide-in/out along the horizontal axis with opacity, collapsing
 * to a pure `nimiReducedFade()` cross-fade under reduced motion. Timed
 * toasts auto-dismiss and pause while hovered.
 */

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cva } from 'class-variance-authority';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../design-tokens.js';
import {
  AnimatePresence,
  motion,
  nimiReducedFade,
  nimiSpring,
  useNimiReducedMotion,
} from '../motion/index.js';
import {
  getNimiToastSnapshot,
  nimiToast,
  subscribeNimiToasts,
  type NimiToastRecord,
  type NimiToastTone,
} from './toast-store.js';

const toastVariants = cva(
  'nimi-toast pointer-events-auto flex min-w-0 items-start gap-3 rounded-[var(--nimi-radius-md)] border px-3 py-2 shadow-lg text-[length:var(--nimi-type-body-sm-size)]',
  {
    variants: {
      tone: {
        neutral: 'nimi-toast--neutral border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-neutral-soft-text)]',
        success: 'nimi-toast--success border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-success-soft-text)]',
        warning: 'nimi-toast--warning border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-warning-soft-text)]',
        danger: 'nimi-toast--danger border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-danger-soft-text)]',
        info: 'nimi-toast--info border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-status-info-soft-text)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const TONE_ICONS: Record<NimiToastTone, LucideIcon> = {
  neutral: Bell,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

function NimiToastItem({ record, dismissLabel }: { record: NimiToastRecord; dismissLabel: string }) {
  const reducedMotion = useNimiReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const remainingMsRef = useRef(record.durationMs);

  useEffect(() => {
    if (record.durationMs === Infinity) {
      return;
    }
    startedAtRef.current = Date.now();
    const timer = setTimeout(() => {
      nimiToast.dismiss(record.id);
    }, remainingMsRef.current);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) {
        timerRef.current = null;
      }
    };
  }, [record.id, record.durationMs]);

  // Hover pauses auto-dismiss: entering freezes the countdown and banks
  // the elapsed slice; leaving resumes with the remaining time only.
  const handleMouseEnter = () => {
    if (record.durationMs === Infinity || timerRef.current === null) {
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingMsRef.current = Math.max(
      0,
      remainingMsRef.current - (Date.now() - startedAtRef.current),
    );
  };

  const handleMouseLeave = () => {
    if (record.durationMs === Infinity || timerRef.current !== null) {
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      nimiToast.dismiss(record.id);
    }, remainingMsRef.current);
  };

  const Icon = TONE_ICONS[record.tone];
  const transition = reducedMotion ? nimiReducedFade() : nimiSpring('default');

  return (
    <motion.div
      layout
      className={cn(toastVariants({ tone: record.tone }))}
      role={record.tone === 'danger' ? 'alert' : 'status'}
      data-nimi-toast-tone={record.tone}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 48 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 48 }}
      transition={transition}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="nimi-toast__icon inline-flex shrink-0 items-center justify-center pt-0.5">
        <Icon size={16} aria-hidden />
      </span>
      <div className="nimi-toast__body min-w-0 flex-1">
        {record.title ? (
          <p className="nimi-toast__title font-[var(--nimi-type-label-weight)] text-[var(--nimi-text-primary)]">
            {record.title}
          </p>
        ) : null}
        <p className="nimi-toast__message">{record.message}</p>
      </div>
      {record.action ? (
        <button
          type="button"
          className="nimi-toast__action shrink-0 self-center font-[var(--nimi-type-label-weight)] underline-offset-2 hover:underline"
          onClick={() => {
            record.action?.onClick();
            nimiToast.dismiss(record.id);
          }}
        >
          {record.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="nimi-toast__close inline-flex shrink-0 items-center justify-center opacity-70 hover:opacity-100"
        aria-label={dismissLabel}
        onClick={() => nimiToast.dismiss(record.id)}
      >
        <X size={14} aria-hidden />
      </button>
    </motion.div>
  );
}

export type NimiToastPosition = 'bottom-right';

const TOAST_POSITION_CLASSES: Record<NimiToastPosition, string> = {
  'bottom-right': 'bottom-4 right-4',
};

const SERVER_SNAPSHOT: readonly NimiToastRecord[] = [];

/**
 * Toast viewport host. Mount once near the app root; toasts raised through
 * `nimiToast` / `useNimiToast()` before mount render immediately after.
 */
export function NimiToaster({
  position = 'bottom-right',
  dismissLabel = 'Dismiss',
}: {
  position?: NimiToastPosition;
  /** Accessible label for each toast's close button. Defaults to `Dismiss`. */
  dismissLabel?: string;
}) {
  const toasts = useSyncExternalStore(
    subscribeNimiToasts,
    getNimiToastSnapshot,
    () => SERVER_SNAPSHOT,
  );
  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(
    <div
      className={cn(
        'nimi-toast-viewport pointer-events-none fixed z-[var(--nimi-z-toast)] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2',
        TOAST_POSITION_CLASSES[position],
      )}
      // No aria-live here: each toast item already carries role="status" /
      // role="alert" with implicit live regions, and a second live viewport
      // would announce every toast twice.
    >
      <AnimatePresence>
        {toasts.map((record) => (
          <NimiToastItem key={record.id} record={record} dismissLabel={dismissLabel} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/** Semantic hook entry point for raising toasts inside components. */
export function useNimiToast(): typeof nimiToast {
  return nimiToast;
}
