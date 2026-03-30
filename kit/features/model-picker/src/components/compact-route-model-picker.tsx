import { useState, type ReactNode } from 'react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  SearchField,
  SelectField,
  type SelectFieldOption,
  cn,
} from '@nimiplatform/nimi-kit/ui';
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

export type CompactRouteModelPickerProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  sourceValue: CompactRouteModelPickerSource;
  sourceOptions: readonly CompactRouteModelPickerSourceOption[];
  onSourceChange?: (value: CompactRouteModelPickerSource) => void;
  showConnector?: boolean;
  connectorValue?: string;
  connectorOptions?: readonly SelectFieldOption[];
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

  const selectedTitle = state.selectedModel
    ? state.adapter.getTitle(state.selectedModel)
    : null;

  const displayLabel = triggerLabel ?? selectedTitle ?? 'Select model';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          tone="ghost"
          size="sm"
          trailingIcon={CHEVRON_DOWN}
          className={cn(
            'max-w-[200px] gap-1 px-2 text-[12px] font-medium text-[color:var(--nimi-text-secondary)] hover:text-[color:var(--nimi-text-primary)]',
            triggerClassName,
          )}
        >
          <span className="truncate">{displayLabel}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        side={side}
        sideOffset={8}
        className={cn('w-[320px] p-0', className)}
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
            <SelectField
              value={connectorValue}
              onValueChange={onConnectorChange}
              options={connectorOptions.slice()}
              placeholder="Select connector"
              selectClassName="text-[13px] font-normal"
            />
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
            <ScrollArea className="max-h-[260px]" viewportClassName="py-1.5">
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
            </ScrollArea>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
