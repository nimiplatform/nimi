import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useId, useMemo, useState, type FocusEventHandler, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';


import {
  AppCardSurface,
  Button as KitButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchField,
  SelectField as KitSelectField,
  SettingsSectionTitle as KitSettingsSectionTitle,
  StatusBadge as KitStatusBadge,
  TextField,
  Tooltip,
  cn,
} from '@nimiplatform/kit/ui';
import {
  localizedStatusTextV11,
  type RuntimeConfigStatusV11,
} from './runtime-config-state-types';
import {
  useDesktopCardMotion,
} from '../../ui/motion/desktop-motion';

export function Card({
  children,
  className = '',
  hoverMotion = false,
}: {
  children: ReactNode;
  className?: string;
  hoverMotion?: boolean;
}) {
  const cardMotion = useDesktopCardMotion();
  if (!hoverMotion) {
    return (
      <AppCardSurface kind="operational-solid" className={cn(className)}>
        {children}
      </AppCardSurface>
    );
  }
  return (
    <motion.div
      whileHover={cardMotion.whileHover}
      whileTap={cardMotion.whileTap}
      transition={cardMotion.transition}
      className={cn(className)}
    >
      <AppCardSurface kind="operational-solid">
        {children}
      </AppCardSurface>
    </motion.div>
  );
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: string }) {
  return <KitSettingsSectionTitle description={description}>{children}</KitSettingsSectionTitle>;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  loading,
  type = 'button',
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  return (
    <KitButton
      type={type}
      tone={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      className={className}
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      {children}
    </KitButton>
  );
}

export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  required,
  error,
  onBlur,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onBlur?: FocusEventHandler<HTMLInputElement>;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return (
    <div>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-[var(--nimi-text-secondary)]">
          {label}
          {required ? <span aria-hidden="true" className="ml-1 after:content-['*']" /> : null}
        </label>
      ) : null}
      <TextField
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onBlur={onBlur}
      />
      {error ? <p id={errorId} className="mt-1.5 text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}
    </div>
  );
}

export type RuntimeSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function RuntimeSelect({
  id,
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
  id?: string;
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
        id={id}
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
      id={id}
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

function SearchableRuntimeSelect({
  id,
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
  id?: string;
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
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
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

  const enabledIndices = useMemo(
    () => filteredOptions.reduce<number[]>((acc, option, idx) => {
      if (!option.disabled) acc.push(idx);
      return acc;
    }, []),
    [filteredOptions],
  );

  const activeIndex = highlightedIndex >= 0
    && highlightedIndex < filteredOptions.length
    && !filteredOptions[highlightedIndex]?.disabled
    ? highlightedIndex
    : -1;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery('');
      setHighlightedIndex(-1);
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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      if (enabledIndices.length === 0) return;
      event.preventDefault();
      const pos = enabledIndices.indexOf(activeIndex);
      if (event.key === 'Home') {
        setHighlightedIndex(enabledIndices[0]!);
      } else if (event.key === 'End') {
        setHighlightedIndex(enabledIndices[enabledIndices.length - 1]!);
      } else if (event.key === 'ArrowDown') {
        const nextPos = pos < 0 ? 0 : (pos + 1) % enabledIndices.length;
        setHighlightedIndex(enabledIndices[nextPos]!);
      } else {
        const prevPos = pos <= 0 ? enabledIndices.length - 1 : pos - 1;
        setHighlightedIndex(enabledIndices[prevPos]!);
      }
      return;
    }
    if (event.key === 'Enter') {
      const targetOption = activeIndex >= 0
        ? filteredOptions[activeIndex]
        : filteredOptions.find((option) => !option.disabled);
      if (!targetOption || targetOption.disabled) return;
      event.preventDefault();
      selectOption(targetOption.value);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center justify-between gap-2 border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] text-left text-[var(--nimi-field-text)] transition-[transform,border-color,background-color] duration-[var(--nimi-motion-fast)] active:scale-[var(--nimi-motion-pressed-scale)] outline-none enabled:hover:border-[var(--nimi-field-focus)] focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
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
        </button>
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
          <SearchField
            autoFocus
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
              setHighlightedIndex(-1);
            }}
            onClear={() => {
              setSearchQuery('');
              setHighlightedIndex(-1);
            }}
            clearLabel={t('Common.clear')}
            onKeyDown={onSearchKeyDown}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
            placeholder={searchPlaceholder || t('runtimeConfig.common.searchOptions', { defaultValue: 'Search options...' })}
            aria-label={searchPlaceholder || t('runtimeConfig.common.searchOptions', { defaultValue: 'Search options...' })}
            className="min-h-9 w-full"
          />
        </div>
        <ScrollArea className="h-72 max-h-[var(--radix-popover-content-available-height)]" contentClassName="p-1 pr-3">
          <div id={listboxId} role="listbox" className="space-y-0.5">
            {filteredOptions.length > 0 ? filteredOptions.map((option, index) => {
              const selected = option.value === value;
              const highlighted = index === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option.value)}
                  className={cn(
                    'relative flex min-h-9 w-full items-center rounded-md py-2 pl-3 pr-8 text-left text-sm text-[var(--nimi-text-primary)] outline-none transition-[transform,background-color,color] duration-150 active:scale-[var(--nimi-motion-pressed-scale)] focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]',
                    'hover:bg-[var(--nimi-action-ghost-hover)] focus:bg-[var(--nimi-action-ghost-hover)]',
                    highlighted ? 'bg-[var(--nimi-action-ghost-hover)]' : '',
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
                {emptyLabel || t('runtimeConfig.common.noOptionsMatchingSearch', { defaultValue: 'No matching options.' })}
              </p>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// Status badges delegate to kit StatusBadge (dot shape); status → tone mapping.
type BadgeStatus = 'healthy' | 'idle' | 'unreachable' | 'unsupported' | 'degraded' | 'running' | 'stopped';

const BADGE_STATUS_TONES: Record<BadgeStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  running: 'success',
  healthy: 'success',
  stopped: 'danger',
  unreachable: 'danger',
  idle: 'neutral',
  unsupported: 'warning',
  degraded: 'warning',
};

export function StatusBadge({ status }: { status: RuntimeConfigStatusV11 }) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  return (
    <KitStatusBadge tone={BADGE_STATUS_TONES[status]} shape="dot">
      {localizedStatusTextV11(status, t)}
    </KitStatusBadge>
  );
}

export function DaemonStatusBadge({ running }: { running: boolean }) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  return (
    <KitStatusBadge tone={running ? 'success' : 'danger'} shape="dot">
      {t(`runtimeConfig.overview.${running ? 'running' : 'stopped'}`, {
        defaultValue: running ? 'daemon running' : 'daemon stopped',
      })}
    </KitStatusBadge>
  );
}

export function RuntimeHealthBadge({
  daemonRunning,
  status,
}: {
  daemonRunning: boolean;
  status: RuntimeConfigStatusV11;
}) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  // The badge names its subject: a bare "Healthy" in a page corner reads as
  // noise, "Runtime healthy" tells the user what is being reported.
  const hint = t('runtimeConfig.common.runtimeStatusHint', { defaultValue: 'Current state of the local AI runtime' });
  const statusText = daemonRunning
    ? localizedStatusTextV11(status, t)
    : t('runtimeConfig.overview.stopped', { defaultValue: 'stopped' });
  const badge = (
    <KitStatusBadge tone={daemonRunning ? BADGE_STATUS_TONES[status] : 'danger'} shape="dot">
      {t('runtimeConfig.common.runtimeStatusWithLabel', { defaultValue: 'Runtime {{status}}', status: statusText })}
    </KitStatusBadge>
  );
  return hint ? (
    <Tooltip content={hint} placement="top" contentClassName="max-w-xs text-left">
      {badge}
    </Tooltip>
  ) : badge;
}

export function ModelChips(props: { readonly models: string[]; readonly prefix: string }) {
  const i18n = useDesktopI18nResource().instance;
  const t = i18n.t.bind(i18n);
  const { models, prefix } = props;
  if (models.length === 0) {
    return (
      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
        {t('runtimeConfig.common.noModelsDiscovered', { defaultValue: 'No models discovered yet.' })}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.map((model) => (
        <span
          key={`${prefix}-${model}`}
          className="rounded-md border border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-info-soft-text)]"
        >
          {model}
        </span>
      ))}
    </div>
  );
}
