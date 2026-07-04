import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchField, cn } from '@nimiplatform/kit/ui';
import type { CompanionSlotDef, LocalAssetEntry } from '../types.js';
import { filterAssetsForCompanionSlot } from '../constants.js';
import { FieldRow } from './field-primitives.js';
import { ModelSelectorTrigger } from '@nimiplatform/kit/features/model-picker/ui';

export function CompanionSlotSelector(props: {
  slot: CompanionSlotDef;
  value: string;
  onChange: (value: string) => void;
  assets: LocalAssetEntry[];
  loading?: boolean;
  noneLabel?: string;
  required?: boolean;
  requiredLabel?: string;
  requiredSetupPlaceholder?: string;
  setupPendingLabel?: string;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(
    () => filterAssetsForCompanionSlot(props.assets, props.slot) as LocalAssetEntry[],
    [props.assets, props.slot],
  );

  const selectedAsset = useMemo(
    () => filtered.find((asset) => asset.localAssetId === props.value || asset.assetId === props.value) ?? null,
    [filtered, props.value],
  );
  const hasSelectedValue = props.value.trim().length > 0;
  const selectedValueUnresolved = Boolean(hasSelectedValue && !selectedAsset && !props.loading);
  const isRequiredMissing = Boolean(props.required && (!hasSelectedValue || selectedValueUnresolved));
  const selectedStatus = selectedAsset?.status.trim().toLowerCase() ?? '';
  const selectedNeedsSetup = Boolean(
    selectedAsset
    && props.required
    && selectedStatus
    && selectedStatus !== 'active'
    && selectedStatus !== 'installed',
  );

  const filteredForSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((asset) => {
      const text = [
        asset.assetId,
        asset.localAssetId,
        asset.engine,
        asset.kind,
        asset.status,
      ].join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [filtered, search]);

  useEffect(() => {
    if (modalOpen) {
      setSearch('');
      const timer = setTimeout(() => searchRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen]);

  const handleChange = useCallback(
    (value: string) => {
      props.onChange(value);
      setModalOpen(false);
    },
    [props.onChange],
  );

  const modal = modalOpen ? (
    <div
      className="fixed inset-0 z-[var(--nimi-z-dialog)] grid place-items-center bg-[var(--nimi-overlay-backdrop)] px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setModalOpen(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`companion-slot-picker-${props.slot.slot}`}
        className="nimi-overlay-panel nimi-overlay-panel--dialog flex max-h-[520px] w-full max-w-[480px] flex-col overflow-hidden rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-100 px-5 pt-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={`companion-slot-picker-${props.slot.slot}`} className="text-base font-semibold text-slate-800">
              Select companion model
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
              {props.slot.label}
            </span>
          </div>
        </div>

        <div className="shrink-0 border-b border-slate-100 px-5 py-3">
          <SearchField
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search local assets"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <button
            type="button"
            onClick={() => handleChange('')}
            className={cn(
              'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
              props.value ? 'text-slate-700 hover:bg-slate-50' : 'bg-emerald-50 text-emerald-700',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm', props.value ? 'font-medium' : 'font-semibold')}>
                {props.noneLabel || 'None'}
              </p>
            </div>
            {!props.value ? (
              <span className="shrink-0 text-emerald-500">Selected</span>
            ) : null}
          </button>

          {props.loading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">Loading companion models...</p>
          ) : filteredForSearch.length > 0 ? (
            <div className="py-1">
              {filteredForSearch.map((asset) => {
                const label = asset.assetId || asset.localAssetId;
                const selected = asset.localAssetId === props.value || asset.assetId === props.value;
                const detail = [
                  asset.engine,
                  asset.localAssetId && asset.localAssetId !== label ? asset.localAssetId : '',
                  asset.status,
                ].filter(Boolean).join(' / ');
                return (
                  <button
                    key={asset.localAssetId}
                    type="button"
                    onClick={() => handleChange(asset.localAssetId)}
                    className={cn(
                      'flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors',
                      selected ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}>
                        {label}
                      </p>
                      {detail ? (
                        <p className="truncate text-xs text-slate-400">{detail}</p>
                      ) : null}
                    </div>
                    {selected ? (
                      <span className="shrink-0 text-emerald-500">Selected</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              {search ? 'No companion models match your search.' : 'No companion models available.'}
            </p>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      data-nimi-model-config-companion-slot={props.slot.slot}
      data-nimi-model-config-companion-kind={props.slot.kind}
    >
      <FieldRow label={props.slot.label} requirementLabel={isRequiredMissing ? (props.requiredLabel || 'Required') : undefined}>
        <ModelSelectorTrigger
          source={selectedAsset ? 'local' : null}
          modelLabel={selectedAsset ? (selectedAsset.assetId || selectedAsset.localAssetId) : null}
          detail={selectedAsset ? [selectedAsset.engine, selectedAsset.status].filter(Boolean).join(' / ') : null}
          detailStatus={selectedNeedsSetup ? (props.setupPendingLabel || 'setup pending') : null}
          detailTone={selectedNeedsSetup ? 'warning' : 'neutral'}
          placeholder={isRequiredMissing ? (props.requiredSetupPlaceholder || 'Required setup') : (props.noneLabel || 'None')}
          onClick={() => setModalOpen(true)}
        />
        {modal ? (typeof document === 'undefined' ? modal : createPortal(modal, document.body)) : null}
      </FieldRow>
    </div>
  );
}
