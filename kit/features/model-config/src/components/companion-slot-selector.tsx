import { useMemo } from 'react';
import type { CompanionSlotDef, LocalAssetEntry } from '../types.js';
import { filterAssetsByKind } from '../constants.js';
import { FieldRow } from './field-primitives.js';

const FIELD_BASE = 'w-full rounded-xl border border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_18%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_8%,var(--nimi-surface-card,#fff))] px-3 text-[13px] text-[var(--nimi-text-primary,#1e293b)] outline-none transition-all hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg,#10b981)_32%,transparent)] focus:border-[var(--nimi-field-focus,#10b981)] focus:bg-white focus:ring-2 focus:ring-emerald-100';
const FIELD_HEIGHT = 'h-10';

export function CompanionSlotSelector(props: {
  slot: CompanionSlotDef;
  value: string;
  onChange: (value: string) => void;
  assets: LocalAssetEntry[];
  noneLabel?: string;
}) {
  const filtered = useMemo(
    () => filterAssetsByKind(props.assets, props.slot.kind) as LocalAssetEntry[],
    [props.assets, props.slot.kind],
  );
  return (
    <FieldRow label={props.slot.label}>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`${FIELD_BASE} ${FIELD_HEIGHT}`}
      >
        <option value="">{props.noneLabel || 'None'}</option>
        {filtered.map((asset) => (
          <option key={asset.localAssetId} value={asset.localAssetId}>
            {asset.assetId || asset.localAssetId}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
