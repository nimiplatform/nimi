import { useCallback, useMemo } from 'react';
import type { CompanionSlotDef, LocalAssetEntry } from '../types.js';
import { filterAssetsByKind } from '../constants.js';
import { FieldRow, FieldSelect } from './field-primitives.js';

const NONE_SENTINEL = '__none__';

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

  const options = useMemo(() => {
    const items = [{ value: NONE_SENTINEL, label: props.noneLabel || 'None' }];
    for (const asset of filtered) {
      items.push({
        value: asset.localAssetId,
        label: asset.assetId || asset.localAssetId,
      });
    }
    return items;
  }, [filtered, props.noneLabel]);

  const selectValue = props.value || NONE_SENTINEL;

  const handleChange = useCallback(
    (v: string) => props.onChange(v === NONE_SENTINEL ? '' : v),
    [props.onChange],
  );

  return (
    <FieldRow label={props.slot.label}>
      <FieldSelect
        value={selectValue}
        onChange={handleChange}
        options={options}
      />
    </FieldRow>
  );
}
