import { useMemo } from 'react';
import type { CompanionSlotDef, LocalAssetEntry } from '../types.js';
import { filterAssetsByKind } from '../constants.js';
import { FieldRow } from './field-primitives.js';

const FIELD_BASE = 'w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none transition-colors hover:border-slate-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';
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
