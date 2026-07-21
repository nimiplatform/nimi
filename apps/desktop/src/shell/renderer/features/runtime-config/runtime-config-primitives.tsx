import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { i18n } from '../../i18n';

import {
  AppCardSurface,
  Button as KitButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  TextField,
  SelectField as KitSelectField,
  cn,
} from '@nimiplatform/kit/ui';
import {
  statusTextV11,
  type ProviderStatusV11,
} from './runtime-config-state-types';
import {
  useDesktopCardMotion,
  useDesktopInteractiveMotion,
} from '../../ui/motion/desktop-motion';

export function Card({
  children,
  className = '',
  hoverMotion = true,
}: {
  children: ReactNode;
  className?: string;
  hoverMotion?: boolean;
}) {
  const cardMotion = useDesktopCardMotion();
  return (
    <motion.div
      layout
      whileHover={hoverMotion ? cardMotion.whileHover : undefined}
      whileTap={hoverMotion ? cardMotion.whileTap : undefined}
      transition={cardMotion.transition}
      className={cn(className)}
    >
      <AppCardSurface kind="operational-solid">
        {children}
      </AppCardSurface>
    </motion.div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const interactiveMotion = useDesktopInteractiveMotion();
  return (
    <motion.span
      className="inline-flex"
      whileHover={disabled ? undefined : interactiveMotion.whileHover}
      whileTap={disabled ? undefined : interactiveMotion.whileTap}
      transition={interactiveMotion.transition}
    >
      <KitButton
        tone={variant}
        size={size}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </KitButton>
    </motion.span>
  );
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      {label ? <label className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">{label}</label> : null}
      <TextField
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

export type RuntimeSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function RuntimeSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  size = 'md',
  className = '',
  contentClassName,
  searchable = false,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: RuntimeSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  contentClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const triggerClass = size === 'sm'
    ? 'min-h-8 rounded-md px-2 text-xs'
    : 'min-h-10 rounded-xl px-3 text-sm';

  if (searchable) {
    return (
      <SearchableRuntimeSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        disabled={disabled}
        className={className}
        triggerClass={triggerClass}
        contentClassName={contentClassName}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
      />
    );
  }

  return (
    <KitSelectField
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
      selectClassName={triggerClass}
      contentClassName={contentClassName}
    />
  );
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SelectCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function SearchableRuntimeSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  className,
  triggerClass,
  contentClassName,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: RuntimeSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className: string;
  triggerClass: string;
  contentClassName?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const interactiveMotion = useDesktopInteractiveMotion();
  const safeOptions = useMemo(() => options.filter((option) => option.value !== ''), [options]);
  const selectedOption = safeOptions.find((option) => option.value === value) || null;
  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return safeOptions;
    return safeOptions.filter((option) => (
      option.label.toLowerCase().includes(query)
      || option.value.toLowerCase().includes(query)
    ));
  }, [safeOptions, searchQuery]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
    }
  };

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    handleOpenChange(false);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleOpenChange(false);
      return;
    }
    if (event.key === 'Enter') {
      const firstEnabled = filteredOptions.find((option) => !option.disabled);
      if (!firstEnabled) return;
      event.preventDefault();
      selectOption(firstEnabled.value);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          whileHover={disabled ? undefined : interactiveMotion.whileHover}
          whileTap={disabled ? undefined : interactiveMotion.whileTap}
          transition={interactiveMotion.transition}
          className={cn(
            'flex w-full items-center justify-between gap-2 border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-left text-[var(--nimi-field-text)] transition-colors duration-[var(--nimi-motion-fast)] outline-none enabled:hover:border-[var(--nimi-field-focus)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
            triggerClass,
            className,
          )}
        >
          <span className={cn(
            'min-w-0 flex-1 truncate text-sm',
            selectedOption ? 'text-[var(--nimi-field-text)]' : 'text-[var(--nimi-text-muted)]',
          )}>
            {selectedOption?.label || placeholder || ''}
          </span>
          <span className="shrink-0 text-[var(--nimi-text-muted)]">
            <ChevronIcon />
          </span>
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          'w-[var(--radix-popover-trigger-width)] overflow-hidden p-0',
          contentClassName,
        )}
      >
        <div className="border-b border-[var(--nimi-border-subtle)] p-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nimi-text-muted)]">
              <SearchGlyph />
            </span>
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={searchPlaceholder || i18n.t('runtimeConfig.common.searchOptions', { defaultValue: 'Search options...' })}
              aria-label={searchPlaceholder || i18n.t('runtimeConfig.common.searchOptions', { defaultValue: 'Search options...' })}
              className="h-9 w-full rounded-md border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] pl-9 pr-3 text-sm text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
            />
          </div>
        </div>
        <ScrollArea className="h-72 max-h-[var(--radix-popover-content-available-height)]" contentClassName="p-1 pr-3">
          <div role="listbox" className="space-y-0.5">
            {filteredOptions.length > 0 ? filteredOptions.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => selectOption(option.value)}
                  className={cn(
                    'relative flex min-h-9 w-full items-center rounded-md py-2 pl-3 pr-8 text-left text-sm text-[var(--nimi-text-primary)] outline-none transition-colors',
                    'hover:bg-[var(--nimi-action-ghost-hover)] focus:bg-[var(--nimi-action-ghost-hover)]',
                    selected ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]' : '',
                    option.disabled ? 'pointer-events-none opacity-[var(--nimi-opacity-disabled)]' : '',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selected ? (
                    <span className="absolute right-3 inline-flex items-center justify-center text-[var(--nimi-action-primary-bg)]">
                      <SelectCheckIcon />
                    </span>
                  ) : null}
                </button>
              );
            }) : (
              <p className="px-3 py-3 text-sm text-[var(--nimi-text-muted)]">
                {emptyLabel || i18n.t('runtimeConfig.common.noOptionsMatchingSearch', { defaultValue: 'No matching options.' })}
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// Status indicator with dot - using semi-transparent backgrounds
function StatusIndicator({
  status,
  text,
  variant: _variant,
}: {
  status: 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded' | 'running' | 'stopped';
  text: string;
  variant?: 'daemon' | 'provider';
}) {
  const styles = {
    // Daemon states
    running: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]',
      text: 'text-[var(--nimi-status-success)]',
      dot: 'bg-[var(--nimi-status-success)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
    },
    stopped: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]',
      text: 'text-[var(--nimi-status-danger)]',
      dot: 'bg-[var(--nimi-status-danger)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]',
    },
    // Provider states
    healthy: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)]',
      text: 'text-[var(--nimi-status-success)]',
      dot: 'bg-[var(--nimi-status-success)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]',
    },
    idle: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_12%,transparent)]',
      text: 'text-[var(--nimi-status-neutral)]',
      dot: 'bg-[var(--nimi-status-neutral)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-neutral)_24%,transparent)]',
    },
    unreachable: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]',
      text: 'text-[var(--nimi-status-danger)]',
      dot: 'bg-[var(--nimi-status-danger)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]',
    },
    unsupported: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]',
      text: 'text-[var(--nimi-status-warning)]',
      dot: 'bg-[var(--nimi-status-warning)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
    },
    degraded: {
      bg: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)]',
      text: 'text-[var(--nimi-status-warning)]',
      dot: 'bg-[var(--nimi-status-warning)]',
      ring: 'ring-[color-mix(in_srgb,var(--nimi-status-warning)_24%,transparent)]',
    },
  };

  const style = styles[status];

  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1',
      style.bg,
      style.text,
      style.ring,
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {text}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProviderStatusV11 }) {
  const statusMap: Record<ProviderStatusV11, 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded'> = {
    healthy: 'healthy',
    idle: 'idle',
    unreachable: 'unreachable',
    unsupported: 'unsupported',
    degraded: 'degraded',
  };

  return (
    <StatusIndicator
      status={statusMap[status]}
      text={statusTextV11(status)}
      variant="provider"
    />
  );
}

export function DaemonStatusBadge({ running }: { running: boolean }) {
  return (
    <StatusIndicator
      status={running ? 'running' : 'stopped'}
      text={i18n.t(`runtimeConfig.overview.${running ? 'running' : 'stopped'}`, {
        defaultValue: running ? 'daemon running' : 'daemon stopped',
      })}
      variant="daemon"
    />
  );
}

export function RuntimeHealthBadge({
  daemonRunning,
  providerStatus,
}: {
  daemonRunning: boolean;
  providerStatus: ProviderStatusV11;
}) {
  if (!daemonRunning) {
    return (
      <StatusIndicator
        status="stopped"
        text={i18n.t('runtimeConfig.overview.stopped', { defaultValue: 'daemon stopped' })}
        variant="daemon"
      />
    );
  }
  return (
    <StatusIndicator
      status={providerStatus}
      text={statusTextV11(providerStatus)}
      variant="provider"
    />
  );
}

export function renderModelChips(models: string[], prefix: string) {
  if (models.length === 0) {
    return (
      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
        {i18n.t('runtimeConfig.common.noModelsDiscovered', { defaultValue: 'No models discovered yet.' })}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <span
          key={`${prefix}-${model}`}
          className="rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-2 py-0.5 text-[11px] text-[var(--nimi-action-primary-bg)]"
        >
          {model}
        </span>
      ))}
    </div>
  );
}
