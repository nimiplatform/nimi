import React, { type ReactNode } from 'react';
import { cn } from '../design-tokens.js';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
import { Avatar } from './avatar.js';
import { Surface } from './surface.js';

export type AccountPanelUser = {
  displayName?: string | null;
  email?: string | null;
  avatarSrc?: string | null;
  fallback?: ReactNode;
};

export type AccountPanelItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onSelect?: () => void;
};

export type AccountPanelProps = {
  user: AccountPanelUser | null;
  items: readonly AccountPanelItem[];
  footerItems?: readonly AccountPanelItem[];
  ariaLabel?: string;
  className?: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  onAction?: () => void;
  statusMessage?: ReactNode;
};

function displayNameFor(user: AccountPanelUser | null): string {
  return user?.displayName?.trim() || 'Runtime account';
}

function fallbackFor(user: AccountPanelUser | null, displayName: string): ReactNode {
  return user?.fallback ?? (displayName.charAt(0).toUpperCase() || '?');
}

function AccountPanelItemButton({ item }: { item: AccountPanelItem }) {
  return (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-current={item.active ? 'page' : undefined}
      onClick={item.onSelect}
      className={cn(
        'nimi-account-panel__item flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[var(--nimi-radius-md)] px-3 text-left text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-secondary)] transition-colors duration-[var(--nimi-motion-fast)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
        FOCUS_RING_CLASS_NAME,
        item.active && 'nimi-account-panel__item--active bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]',
        item.tone === 'danger' && 'nimi-account-panel__item--danger text-[var(--nimi-status-danger)] hover:bg-[var(--nimi-status-danger-soft-bg)] hover:text-[var(--nimi-status-danger)]',
      )}
    >
      {item.icon ? (
        <span className="nimi-account-panel__item-icon inline-flex h-5 w-5 shrink-0 items-center justify-center text-current">
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <span className="nimi-account-panel__item-chevron shrink-0 text-[var(--nimi-text-muted)]" aria-hidden="true">
        &gt;
      </span>
    </button>
  );
}

export function AccountPanel({
  user,
  items,
  footerItems = [],
  ariaLabel = 'Account menu',
  className,
  actionLabel,
  actionIcon,
  onAction,
  statusMessage,
}: AccountPanelProps) {
  const displayName = displayNameFor(user);
  const fallback = fallbackFor(user, displayName);

  return (
    <Surface
      as="section"
      role="menu"
      aria-label={ariaLabel}
      material="glass-thick"
      tone="card"
      elevation="floating"
      padding="none"
      className={cn('nimi-account-panel w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-[var(--nimi-radius-lg)] p-3', className)}
    >
      <header className="nimi-account-panel__header flex min-w-0 items-center gap-3 px-2 py-3">
        <Avatar
          src={user?.avatarSrc ?? null}
          alt={displayName}
          size="lg"
          tone="neutral"
          fallback={fallback}
          className="nimi-account-panel__avatar bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]"
        />
        <div className="min-w-0 flex-1">
          <p className="nimi-account-panel__name m-0 truncate text-[length:var(--nimi-type-section-title-size)] font-bold leading-tight text-[var(--nimi-text-primary)]">
            {displayName}
          </p>
          {user?.email ? (
            <p className="nimi-account-panel__meta m-0 mt-1 truncate text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
              {user.email}
            </p>
          ) : null}
        </div>
        {actionLabel ? (
          <button
            type="button"
            className={cn(
              'nimi-account-panel__action inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-full)] text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]',
              FOCUS_RING_CLASS_NAME,
            )}
            aria-label={actionLabel}
            onClick={onAction}
          >
            {actionIcon ?? <span className="text-[length:var(--nimi-type-caption-size)] font-semibold">{actionLabel}</span>}
          </button>
        ) : null}
      </header>

      {statusMessage ? (
        <div className="nimi-account-panel__status mx-2 mb-2 rounded-[var(--nimi-radius-md)] border border-[color-mix(in_srgb,var(--nimi-status-warning)_32%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] px-3 py-2 text-[length:var(--nimi-type-body-sm-size)] leading-relaxed text-[var(--nimi-text-secondary)]">
          {statusMessage}
        </div>
      ) : null}

      <div className="nimi-account-panel__items grid gap-1 border-t border-[var(--nimi-border-subtle)] px-1 py-2">
        {items.map((item) => (
          <AccountPanelItemButton key={item.id} item={item} />
        ))}
      </div>

      {footerItems.length > 0 ? (
        <div className="nimi-account-panel__footer grid gap-1 border-t border-[var(--nimi-border-subtle)] px-1 pt-2">
          {footerItems.map((item) => (
            <AccountPanelItemButton key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </Surface>
  );
}
