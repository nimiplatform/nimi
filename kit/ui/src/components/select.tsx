import React, { forwardRef, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn, type FieldTone } from '../design-tokens.js';
import {
  AnimatePresence,
  motion,
  nimiOverlayPanelMotion,
  useNimiReducedMotion,
} from '../motion/index.js';

export type SelectFieldOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectFieldChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

export type SelectFieldProps = {
  tone?: FieldTone;
  /**
   * Options with an empty-string `value` are dropped before render: Radix
   * Select reserves `''` for clearing the selection and showing the
   * placeholder. Use a non-empty sentinel value instead. A `console.warn`
   * fires in non-production builds when such an option is supplied.
   */
  options: SelectFieldOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  open?: boolean;
  className?: string;
  selectClassName?: string;
  contentClassName?: string;
  /** Raises portalled options above a containing dialog without changing their popover semantics. */
  contentLayer?: 'popover' | 'dialog';
  onValueChange?: (value: string) => void;
  onChange?: (event: SelectFieldChangeEvent) => void;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
};

const CHEVRON_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function fieldToneClassName(tone: FieldTone) {
  if (tone === 'search') {
    return 'rounded-[var(--nimi-radius-full)]';
  }
  if (tone === 'quiet') {
    return 'border-transparent bg-transparent shadow-none';
  }
  return '';
}

function createChangeEvent(value: string): SelectFieldChangeEvent {
  return {
    target: { value },
    currentTarget: { value },
  };
}

export const SelectField = forwardRef<HTMLButtonElement, SelectFieldProps>(function SelectField(
  {
    tone = 'default',
    options,
    value,
    defaultValue,
    placeholder,
    disabled = false,
    required,
    name,
    open,
    className,
    selectClassName,
    contentClassName,
    contentLayer = 'popover',
    onValueChange,
    onChange,
    onOpenChange,
    id,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'data-testid': dataTestId,
  },
  ref,
) {
  // Radix reserves the empty string for clearing selection and showing the placeholder.
  const safeOptions = options.filter((option) => option.value !== '');

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && options.length !== safeOptions.length) {
      console.warn(
        'SelectField: options with an empty-string `value` were dropped — Radix Select reserves the empty string for clearing the selection. Use a non-empty sentinel value instead.',
      );
    }
  }, [options, safeOptions.length]);
  const controlledValueLabel = value === undefined
    ? undefined
    : safeOptions.find((option) => option.value === value)?.label;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const requestedOpen = open ?? internalOpen;
  const requestedOpenRef = React.useRef(requestedOpen);
  const [contentMounted, setContentMounted] = React.useState(requestedOpen);
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({ kind: 'popover', side: 'bottom', reducedMotion });

  requestedOpenRef.current = requestedOpen;

  React.useEffect(() => {
    if (requestedOpen) {
      setContentMounted(true);
    }
  }, [requestedOpen]);

  const handleValueChange = (nextValue: string) => {
    onValueChange?.(nextValue);
    onChange?.(createChangeEvent(nextValue));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    if (nextOpen) {
      setContentMounted(true);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      required={required}
      name={name}
      open={requestedOpen || contentMounted}
      onOpenChange={handleOpenChange}
      onValueChange={handleValueChange}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-testid={dataTestId}
        className={cn(
          'flex min-h-[var(--nimi-sizing-field-md-height)] w-full items-center justify-between gap-2 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-left text-[var(--nimi-field-text)] transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale)] outline-none enabled:hover:border-[var(--nimi-field-focus)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
          fieldToneClassName(tone),
          className,
          selectClassName,
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="min-w-0 flex-1 truncate text-[length:var(--nimi-type-body-size)]"
        >
          {controlledValueLabel ?? null}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <span className="shrink-0 text-[var(--nimi-text-muted)]">{CHEVRON_ICON}</span>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        {/* Radix Select Content has no forceMount. The root therefore stays
            mounted until AnimatePresence completes the symmetric exit;
            outer Content owns popper positioning while the inner element
            owns visual chrome and motion (P-DESIGN-027). */}
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          data-nimi-select-layer={contentLayer}
          className={contentLayer === 'dialog'
            ? 'z-[calc(var(--nimi-z-dialog)+1)]'
            : 'z-[var(--nimi-z-popover)]'}
        >
          <AnimatePresence
            onExitComplete={() => {
              if (!requestedOpenRef.current) {
                setContentMounted(false);
              }
            }}
          >
            {requestedOpen ? (
              <motion.div
                className={cn(
                  'nimi-overlay-panel nimi-overlay-panel--popover min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-floating)]',
                  contentClassName,
                )}
                {...panelMotion}
                style={panelMotion.style}
              >
                <SelectPrimitive.Viewport className="max-h-[min(var(--radix-select-content-available-height),24rem)] overflow-y-auto overscroll-contain p-1">
                  {safeOptions.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      className={cn(
                        'relative flex min-h-9 cursor-pointer select-none items-center rounded-[var(--nimi-radius-sm)] py-2 pr-8 pl-3 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-primary)] outline-none',
                        'data-[highlighted]:bg-[var(--nimi-action-ghost-hover)] data-[highlighted]:text-[var(--nimi-text-primary)]',
                        'data-[state=checked]:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]',
                        'data-[disabled]:pointer-events-none data-[disabled]:opacity-[var(--nimi-opacity-disabled)]',
                      )}
                    >
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                      <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex items-center justify-center text-[var(--nimi-action-primary-bg)]">
                        {CHECK_ICON}
                      </SelectPrimitive.ItemIndicator>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Viewport>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
