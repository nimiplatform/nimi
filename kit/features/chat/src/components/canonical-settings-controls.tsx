import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

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
        'rounded-full px-4 py-2 text-[13px] font-semibold transition-colors',
        props.active
          ? 'bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.22)]'
          : 'bg-white text-slate-600 hover:bg-slate-50',
        props.disabled ? 'cursor-not-allowed opacity-55 hover:bg-white' : '',
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
      disabled={props.disabled}
      onClick={() => props.onChange?.(!props.checked)}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors',
        props.disabled
          ? 'cursor-not-allowed opacity-65'
          : 'hover:border-emerald-200 hover:bg-emerald-50/40',
      )}
    >
      <div>
        <p className="text-[13px] font-semibold text-slate-900">{props.label}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{props.hint}</p>
      </div>
      <span className={cn(
        'inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors',
        props.checked ? 'justify-end bg-emerald-500' : 'justify-start bg-gray-200',
      )}>
        <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

const CHEVRON_ICON = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    <div className="mt-2 rounded-xl border border-slate-200/80 bg-slate-50/70">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex h-10 w-full items-center justify-between px-3 text-left text-xs font-semibold text-slate-500 transition-colors hover:text-slate-700"
      >
        <span>{props.title}</span>
        <span className={cn('text-slate-400 transition-transform duration-200', props.open ? 'rotate-180' : '')}>
          {CHEVRON_ICON}
        </span>
      </button>
      {props.open ? (
        <div className="px-3 pb-3">{props.children}</div>
      ) : null}
    </div>
  );
}
