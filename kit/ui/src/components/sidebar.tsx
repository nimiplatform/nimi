import React, { createElement, type CSSProperties, type ComponentPropsWithoutRef, type ElementType, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './button.js';
import { cn, type SidebarItemKind } from '../design-tokens.js';

const SEARCH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CLEAR_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

type SidebarShellProps = {
  as?: 'aside' | 'div';
  width?: number | string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
} & Omit<ComponentPropsWithoutRef<'aside'>, 'children' | 'className' | 'style'>;

export function SidebarShell({
  as,
  width,
  children,
  className,
  style,
  ...rest
}: SidebarShellProps) {
  const Tag = (as || 'aside') as ElementType;
  const mergedStyle = width === undefined
    ? style
    : { ...style, width: typeof width === 'number' ? `${width}px` : width };

  return createElement(
    Tag,
    {
      className: cn(
        'relative flex shrink-0 flex-col rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-sidebar-canvas)] border border-[var(--nimi-border-subtle)] border-l-0 border-r-[var(--nimi-sidebar-border)]',
        className,
      ),
      style: mergedStyle,
      ...rest,
    },
    children,
  );
}

export function SidebarHeader(props: { title: ReactNode; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center min-h-[var(--nimi-sidebar-header-height)] px-4', props.className)}>
      {props.title}
    </div>
  );
}

type SidebarSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  onClear?: () => void;
  clearLabel?: string;
  primaryAction?: ReactNode;
  className?: string;
};

export function SidebarSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  onClear,
  clearLabel = 'Clear',
  primaryAction,
  className,
}: SidebarSearchProps) {
  return (
    <div className={cn('px-2 pb-1', className)}>
      <div className="flex min-h-10 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center px-2">
          <span className="shrink-0 text-[var(--nimi-text-muted)]">{SEARCH_ICON}</span>
          <input
            className="ml-1 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--nimi-field-placeholder)]"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel || placeholder}
          />
          {value && onClear ? (
            <IconButton
              icon={CLEAR_ICON}
              size="sm"
              tone="ghost"
              onClick={onClear}
              className="ml-1 h-6 w-6 text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]"
              aria-label={clearLabel}
              title={clearLabel}
            />
          ) : null}
        </div>
        {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
      </div>
    </div>
  );
}

export function SidebarSection(props: { label?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={cn('px-2 py-1', props.className)}>
      {props.label ? (
        <div className="nimi-type-sidebar-label px-2 py-1 text-[var(--nimi-sidebar-section-label)] uppercase">
          {props.label}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

type SidebarItemProps = {
  kind: SidebarItemKind;
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<'button'>, 'children'>;

export function SidebarItem({
  kind,
  active = false,
  icon,
  label,
  description,
  trailing,
  className,
  type = 'button',
  ...rest
}: SidebarItemProps) {
  if (kind === 'divider') {
    return <div className="my-1 h-px bg-[var(--nimi-sidebar-border)]" />;
  }
  if (kind === 'spacer') {
    return <div className="flex-1" />;
  }

  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--nimi-radius-sidebar-item)] px-2 min-h-[var(--nimi-sizing-sidebar-item-height)] text-left text-sm transition-colors duration-[var(--nimi-motion-fast)] cursor-pointer',
        active
          ? 'bg-[var(--nimi-sidebar-item-active)] text-[var(--nimi-text-primary)] font-medium'
          : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-sidebar-item-hover)] hover:text-[var(--nimi-text-primary)]',
        className,
      )}
      {...rest}
    >
      {icon ? <span className="inline-flex shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description ? <span className="block truncate text-xs text-[var(--nimi-text-muted)]">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </button>
  );
}

type SidebarResizeHandleProps = {
  ariaLabel: string;
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
};

export function SidebarResizeHandle({
  ariaLabel,
  onMouseDown,
  className,
}: SidebarResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={cn(
        'absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize hover:bg-[var(--nimi-sidebar-resize-handle)]',
        className,
      )}
    />
  );
}

export function SidebarAffordanceBadge(props: { children: ReactNode; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs leading-none font-medium',
      'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]',
      props.className,
    )}>
      {props.children}
    </span>
  );
}

const CHEVRON_RIGHT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function SidebarAffordanceChevron(props: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center text-[var(--nimi-text-muted)]', props.className)}>
      {CHEVRON_RIGHT_ICON}
    </span>
  );
}

export function SidebarAffordanceStatusDot(props: { color?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center', props.className)}>
      <span className="inline-flex h-2 w-2 rounded-full bg-current" style={props.color ? { color: props.color } : undefined} />
    </span>
  );
}
