import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  SearchField,
  cn,
} from '@nimiplatform/kit/ui';
import type { UseModelPickerResult } from '../hooks/use-model-picker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactRouteModelPickerSource = 'local' | 'cloud';

export type CompactRouteModelPickerSourceOption = {
  value: CompactRouteModelPickerSource;
  label: ReactNode;
  disabled?: boolean;
};

export type CompactRouteModelPickerSelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type CompactRouteModelPickerProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  sourceValue: CompactRouteModelPickerSource;
  sourceOptions: readonly CompactRouteModelPickerSourceOption[];
  onSourceChange?: (value: CompactRouteModelPickerSource) => void;
  showConnector?: boolean;
  connectorValue?: string;
  connectorOptions?: readonly CompactRouteModelPickerSelectOption[];
  onConnectorChange?: (value: string) => void;
  triggerLabel?: ReactNode;
  triggerClassName?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  loading?: boolean;
  loadingMessage?: ReactNode;
  emptyMessage?: ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const CHEVRON_DOWN = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function optionLabelText(label: ReactNode): string {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  return '';
}

// ---------------------------------------------------------------------------
// CompactRouteModelPicker
// ---------------------------------------------------------------------------

export function CompactRouteModelPicker<TModel>({
  state,
  sourceValue,
  sourceOptions,
  onSourceChange,
  showConnector = false,
  connectorValue,
  connectorOptions = [],
  onConnectorChange,
  triggerLabel,
  triggerClassName,
  align = 'start',
  side = 'top',
  loading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'No models available.',
  className,
}: CompactRouteModelPickerProps<TModel>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedTitle = state.selectedModel
    ? state.adapter.getTitle(state.selectedModel)
    : null;

  const displayLabel = triggerLabel ?? selectedTitle ?? 'Select model';

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
        <Button
          tone="ghost"
          size="sm"
          trailingIcon={CHEVRON_DOWN}
          className={cn(
            'max-w-[200px] gap-1 px-2 text-[12px] font-medium text-[color:var(--nimi-text-secondary)] hover:text-[color:var(--nimi-text-primary)]',
            triggerClassName,
          )}
          onClick={() => setOpen((next) => !next)}
        >
          <span className="truncate">{displayLabel}</span>
        </Button>

      {open ? (
        <div
          className={cn(
            'absolute z-[var(--nimi-z-popover)] w-[320px] overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-0 shadow-[var(--nimi-elevation-floating)]',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
            className,
          )}
        >
        <div className="space-y-3 p-3">
          {/* Source toggle */}
          <div className="flex gap-1.5">
            {sourceOptions.map((option) => (
              <Button
                key={option.value}
                tone={option.value === sourceValue ? 'primary' : 'secondary'}
                size="sm"
                fullWidth
                disabled={option.disabled}
                className="text-[12px]"
                onClick={() => onSourceChange?.(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {/* Connector (cloud only) */}
          {showConnector && connectorOptions.length > 0 ? (
            <select
              value={connectorValue}
              onChange={(event) => onConnectorChange?.(event.currentTarget.value)}
              className="min-h-[var(--nimi-sizing-field-md-height)] w-full rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-[13px] font-normal text-[var(--nimi-field-text)] outline-none transition-colors duration-[var(--nimi-motion-fast)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
              aria-label="Select connector"
            >
              {connectorOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {optionLabelText(option.label)}
                </option>
              ))}
            </select>
          ) : null}

          {/* Search (when > 3 models) */}
          {state.models.length > 3 ? (
            <SearchField
              value={state.searchQuery}
              onChange={(e) => state.setSearchQuery(e.target.value)}
              placeholder="Search models"
              className="text-[13px]"
            />
          ) : null}
        </div>

        {/* Model list */}
        <div className="border-t border-[color:var(--nimi-border-subtle)]">
          {loading ? (
            <p className="px-3 py-6 text-center text-[13px] text-[color:var(--nimi-text-muted)]">
              {loadingMessage}
            </p>
          ) : state.filteredModels.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-[color:var(--nimi-text-muted)]">
              {emptyMessage}
            </p>
          ) : (
            <div className="max-h-[260px] overflow-y-auto overscroll-contain py-1.5">
              {state.filteredModels.map((model) => {
                const id = state.adapter.getId(model);
                const title = state.adapter.getTitle(model);
                const description = state.adapter.getDescription?.(model);
                const selected = state.selectedId === id;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      state.selectModel(id);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[var(--nimi-motion-fast)]',
                      selected
                        ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)]',
                    )}
                  >
                    {/* Check indicator */}
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors',
                        selected
                          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                          : 'border border-[color:var(--nimi-border-subtle)] text-transparent',
                      )}
                    >
                      {selected ? CHECK_ICON : null}
                    </span>

                    {/* Model info */}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate text-[13px]',
                          selected
                            ? 'font-semibold text-[color:var(--nimi-text-primary)]'
                            : 'font-medium text-[color:var(--nimi-text-primary)]',
                        )}
                      >
                        {title}
                      </p>
                      {description ? (
                        <p className="mt-0.5 truncate text-[11px] text-[color:var(--nimi-text-muted)]">
                          {description}
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        </div>
      ) : null}
    </div>
  );
}
