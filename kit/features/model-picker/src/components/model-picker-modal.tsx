import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SearchField,
  cn,
} from '@nimiplatform/kit/ui';
import {
  useRouteModelPickerData,
  type RouteModelPickerDataProvider,
  type RouteModelPickerSelection,
} from '../route-data.js';
import type { RouteModelPickerSource } from './route-model-picker-panel.js';

export type ModelPickerModalProps = {
  open: boolean;
  onClose: () => void;
  capability: string;
  capabilityLabel: string;
  provider: RouteModelPickerDataProvider;
  initialSelection?: Partial<RouteModelPickerSelection>;
  onSelect: (selection: RouteModelPickerSelection) => void;
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

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10l4 4 8-8" />
  </svg>
);

function SourceTab(props: {
  value: RouteModelPickerSource;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
        props.active
          ? 'bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
          : 'text-slate-500 hover:text-slate-700',
        props.disabled ? 'cursor-not-allowed opacity-50' : '',
      )}
    >
      {props.value === 'local' ? LOCAL_ICON : CLOUD_ICON}
      <span>{props.children}</span>
    </button>
  );
}

export function ModelPickerModal({
  open,
  onClose,
  capability,
  capabilityLabel,
  provider,
  initialSelection,
  onSelect,
}: ModelPickerModalProps) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const {
    selection,
    connectors,
    localModels,
    loading,
    pickerState,
    changeSource,
    changeConnector,
  } = useRouteModelPickerData({
    provider,
    capability,
    initialSelection,
  });

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pickerState.models;
    return pickerState.models.filter((model) => {
      const title = pickerState.adapter.getTitle(model).toLowerCase();
      const id = pickerState.adapter.getId(model).toLowerCase();
      return title.includes(q) || id.includes(q);
    });
  }, [search, pickerState.models, pickerState.adapter]);

  const handleSelect = useCallback((modelId: string) => {
    // Resolve display label from picker adapter
    const displayModel = pickerState.models.find((m) => pickerState.adapter.getId(m) === modelId);
    const modelLabel = displayModel ? pickerState.adapter.getTitle(displayModel) : undefined;

    const base: RouteModelPickerSelection = {
      source: selection.source,
      connectorId: selection.connectorId,
      model: modelId,
      provider: selection.provider,
      modelLabel,
    };
    if (selection.source === 'local') {
      const localModel = localModels.find((m) => m.localModelId === modelId);
      if (localModel) {
        base.localModelId = localModel.localModelId;
        base.goRuntimeLocalModelId = localModel.goRuntimeLocalModelId;
        base.engine = localModel.engine;
        base.modelId = localModel.modelId;
        base.modelLabel = modelLabel || localModel.label || localModel.modelId;
      }
    }
    onSelect(base);
    onClose();
  }, [onClose, onSelect, selection.connectorId, selection.source, localModels, pickerState.models, pickerState.adapter]);

  // Reset search when modal opens
  useEffect(() => {
    if (open) {
      setSearch('');
    }
  }, [open]);

  // Auto-focus search when modal opens
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const modal = (
    <div
      className="fixed inset-0 z-[var(--nimi-z-dialog)] grid place-items-center bg-[var(--nimi-overlay-backdrop)] px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-picker-modal-title"
        className="nimi-overlay-panel nimi-overlay-panel--dialog flex max-h-[520px] w-full max-w-[480px] flex-col overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-100 px-5 pt-5 pb-4">
          <div className="flex items-center justify-between">
            <h2 id="model-picker-modal-title" className="text-base font-semibold text-slate-800">Select Model</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              {capabilityLabel}
            </span>
          </div>

          {/* Source tabs */}
          <div className="mt-3 flex gap-1 rounded-full bg-slate-100/80 p-1">
            <SourceTab
              value="local"
              active={selection.source === 'local'}
              onClick={() => {
                changeSource('local');
                setSearch('');
              }}
            >
              Local
            </SourceTab>
            <SourceTab
              value="cloud"
              active={selection.source === 'cloud'}
              disabled={connectors.length === 0}
              onClick={() => {
                changeSource('cloud');
                setSearch('');
              }}
            >
              Cloud
            </SourceTab>
          </div>

          {/* Connector (cloud only) */}
          {selection.source === 'cloud' && connectors.length > 0 ? (
            <div className="mt-3">
              <select
                value={selection.connectorId}
                onChange={(event) => {
                  changeConnector(event.currentTarget.value);
                  setSearch('');
                }}
                className="min-h-[var(--nimi-sizing-field-md-height)] w-full rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm font-normal text-[var(--nimi-field-text)] outline-none transition-colors duration-[var(--nimi-motion-fast)] focus:border-[var(--nimi-field-focus)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
                aria-label="Select connector"
              >
                {connectors.map((connector) => (
                  <option key={connector.connectorId} value={connector.connectorId}>
                    {connector.label} ({connector.provider})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-slate-100 px-5 py-3">
          <SearchField
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search models"
          />
        </div>

        {/* Model list */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">Loading models...</p>
          ) : filteredModels.length > 0 ? (
            <div className="py-1">
              {filteredModels.map((model) => {
                const id = pickerState.adapter.getId(model);
                const title = pickerState.adapter.getTitle(model);
                const description = pickerState.adapter.getDescription?.(model);
                const selected = pickerState.selectedId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelect(id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
                      selected
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}>
                        {title}
                      </p>
                      {description ? (
                        <p className="truncate text-xs text-slate-400">{description}</p>
                      ) : null}
                    </div>
                    {selected ? (
                      <span className="shrink-0 text-emerald-500">{CHECK_ICON}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              {search ? 'No models match your search.' : 'No models available.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined'
    ? modal
    : createPortal(modal, document.body);
}
