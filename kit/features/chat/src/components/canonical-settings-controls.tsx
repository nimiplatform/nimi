import React, { type ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

export function CanonicalSettingsSegmentButton(props: {
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'rounded-full px-4 py-2 text-[length:var(--nimi-type-body-sm-size)] font-semibold transition-[background-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)]',
        FOCUS_RING_CLASS_NAME,
        props.active
          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[0_10px_24px_color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,transparent)]'
          : 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-panel)]',
        props.disabled ? 'cursor-not-allowed opacity-55 active:scale-100 hover:bg-[var(--nimi-surface-card)]' : '',
      )}
    >
      {props.children}
    </button>
  );
}

export function CanonicalSettingsToggleRow(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange?.(!props.checked)}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-left transition-[background-color,border-color] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
        FOCUS_RING_CLASS_NAME,
        props.disabled
          ? 'cursor-not-allowed opacity-65'
          : 'hover:border-[var(--nimi-action-primary-bg)]/30 hover:bg-[var(--nimi-action-ghost-hover)] active:bg-[var(--nimi-surface-active)]',
      )}
    >
      <div>
        <p className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">{props.label}</p>
        <p className="mt-0.5 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{props.hint}</p>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
          props.checked ? 'bg-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-toggle-off-bg)]',
        )}
      >
        <span
          className={cn(
            'h-5 w-5 rounded-full bg-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] transition-transform duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)]',
            props.checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}

const CHEVRON_ICON = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 7.5L10 12.5L15 7.5" />
  </svg>
);

export function CanonicalSettingsCollapsibleSection(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-2 rounded-xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_70%,transparent)]">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-xl px-3 text-left text-xs font-semibold text-[var(--nimi-text-secondary)] transition-colors duration-[var(--nimi-motion-fast)] hover:text-[var(--nimi-text-primary)] active:bg-[var(--nimi-surface-active)]',
          FOCUS_RING_CLASS_NAME,
        )}
      >
        <span>{props.title}</span>
        <span className={cn('text-[var(--nimi-text-muted)] transition-transform duration-[var(--nimi-motion-base)]', props.open ? 'rotate-180' : '')}>
          {CHEVRON_ICON}
        </span>
      </button>
      {props.open ? (
        <div className="px-3 pb-3">{props.children}</div>
      ) : null}
    </div>
  );
}
