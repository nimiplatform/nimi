import { type ReactNode, useState } from 'react';
import {
  ScrollArea,
  SearchField,
  SelectField,
  type SelectFieldOption,
  cn,
} from '@nimiplatform/nimi-kit/ui';
import type { UseModelPickerResult } from '../headless.js';

export type RouteModelPickerSource = 'local' | 'cloud';

export type RouteModelPickerSourceOption = {
  value: RouteModelPickerSource;
  label: ReactNode;
  disabled?: boolean;
};

export type RouteModelPickerBanner = {
  tone: 'warning' | 'danger' | 'info';
  message: ReactNode;
};

export type RouteModelPickerPanelProps<TModel> = {
  state: UseModelPickerResult<TModel>;
  sourceValue: RouteModelPickerSource;
  sourceOptions: readonly RouteModelPickerSourceOption[];
  onSourceChange?: (value: RouteModelPickerSource) => void;
  loading?: boolean;
  loadingMessage?: ReactNode;
  unavailable?: boolean;
  unavailableMessage?: ReactNode;
  sourceLabel?: ReactNode;
  connectorLabel?: ReactNode;
  connectorValue?: string;
  connectorOptions?: readonly SelectFieldOption[];
  onConnectorChange?: (value: string) => void;
  showConnector?: boolean;
  modelLabel?: ReactNode;
  selectedModelLabel?: ReactNode;
  selectedModelValue?: ReactNode;
  resolvedRouteLabel?: ReactNode;
  resolvedRouteValue?: ReactNode;
  resetLabel?: ReactNode;
  onReset?: () => void;
  banners?: readonly RouteModelPickerBanner[];
  emptyMessage?: ReactNode;
  className?: string;
  pickerClassName?: string;
};

const LOCAL_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const CLOUD_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
  </svg>
);

const CHEVRON_DOWN = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 7.5L10 12.5L15 7.5" />
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10l4 4 8-8" />
  </svg>
);

function sourceIcon(value: RouteModelPickerSource) {
  return value === 'local' ? LOCAL_ICON : CLOUD_ICON;
}

export function RouteModelPickerPanel<TModel>({
  state,
  sourceValue,
  sourceOptions,
  onSourceChange,
  loading = false,
  loadingMessage = 'Loading models...',
  unavailable = false,
  unavailableMessage = 'Route options unavailable.',
  connectorLabel = 'Connector',
  connectorValue,
  connectorOptions = [],
  onConnectorChange,
  showConnector = false,
  selectedModelValue,
  emptyMessage = 'No models available.',
  className,
}: RouteModelPickerPanelProps<TModel>) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const activeModelValue = selectedModelValue
    ?? (state.selectedModel ? state.adapter.getTitle(state.selectedModel) : undefined);

  const filteredModels = search.trim()
    ? state.models.filter((model) => {
      const title = state.adapter.getTitle(model).toLowerCase();
      const id = state.adapter.getId(model).toLowerCase();
      const q = search.trim().toLowerCase();
      return title.includes(q) || id.includes(q);
    })
    : state.models;

  if (loading) {
    return <p className={className ? className : 'text-[13px] text-slate-400'}>{loadingMessage}</p>;
  }

  if (unavailable) {
    return <p className={className ? className : 'text-[13px] text-slate-400'}>{unavailableMessage}</p>;
  }

  return (
    <div className={className}>
      <div className="min-w-0 space-y-3">
        {/* Source tabs */}
        <div className="flex gap-1 rounded-full bg-slate-100/80 p-1">
          {sourceOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              onClick={() => {
                onSourceChange?.(option.value);
                setExpanded(false);
                setSearch('');
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors',
                option.value === sourceValue
                  ? 'bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
                  : 'text-slate-500 hover:text-slate-700',
                option.disabled ? 'cursor-not-allowed opacity-50' : '',
              )}
            >
              {sourceIcon(option.value)}
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        {/* Connector (cloud only) */}
        {showConnector && connectorOptions.length > 0 ? (
          <SelectField
            value={connectorValue}
            onValueChange={(value) => {
              onConnectorChange?.(value);
              setExpanded(false);
              setSearch('');
            }}
            options={connectorOptions.slice()}
            placeholder={String(connectorLabel)}
            selectClassName="font-normal"
          />
        ) : null}

        {/* Model selector */}
        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded);
              if (!expanded) {
                setSearch('');
              }
            }}
            className={cn(
              'flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors',
              expanded
                ? 'border-emerald-300 bg-emerald-50/30'
                : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className={activeModelValue ? 'font-medium text-slate-800' : 'text-slate-400'}>
              {activeModelValue || 'Select a model'}
            </span>
            <span className={cn('text-slate-400 transition-transform duration-200', expanded ? 'rotate-180' : '')}>
              {CHEVRON_DOWN}
            </span>
          </button>

          {expanded ? (
            <div className="absolute inset-x-0 top-full z-40 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
              <div className="min-w-0 border-b border-slate-100 p-2">
                <SearchField
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models"
                  autoFocus
                />
              </div>
              <ScrollArea className="max-h-[240px]">
                {filteredModels.length > 0 ? (
                  <div className="py-1">
                    {filteredModels.map((model) => {
                      const id = state.adapter.getId(model);
                      const title = state.adapter.getTitle(model);
                      const selected = state.selectedId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            state.selectModel(id);
                            setExpanded(false);
                            setSearch('');
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                            selected
                              ? 'bg-emerald-50 font-medium text-emerald-700'
                              : 'text-slate-700 hover:bg-slate-50',
                          )}
                        >
                          <span className="min-w-0 truncate">{title}</span>
                          {selected ? (
                            <span className="shrink-0 text-emerald-500">{CHECK_ICON}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-3 py-4 text-center text-[13px] text-slate-400">{emptyMessage}</p>
                )}
              </ScrollArea>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
