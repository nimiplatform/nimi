import { Surface } from '@nimiplatform/kit/ui';
import type { AttachmentRow, DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import type { AlignerContext } from './orthodontic-derive.js';
import { DentalHistoryRecordList } from './dental-history-record-list.js';

type FilterTab = { key: string | null; label: string };

export function DentalHistoryTimelineSection({
  sortedRecords,
  filteredSortedRecords,
  recordGroups,
  attachmentMap,
  alignerContextMap,
  filterTabs,
  typeFilter,
  setTypeFilter,
  showForm,
  fmtAge,
  historyLabel,
  recordsCountLabel,
  emptyLabel,
  emptyHint,
  emptyFilteredLabel,
  onAskAi,
  onEdit,
  onDelete,
}: {
  sortedRecords: DentalRecordRow[];
  filteredSortedRecords: DentalRecordRow[];
  recordGroups: Array<[string, DentalRecordRow[]]>;
  attachmentMap: Map<string, AttachmentRow[]>;
  alignerContextMap: Map<string, AlignerContext>;
  filterTabs: FilterTab[];
  typeFilter: string | null;
  setTypeFilter: (next: string | null) => void;
  showForm: boolean;
  fmtAge: (ageMonths: number) => string;
  historyLabel: string;
  recordsCountLabel: string;
  emptyLabel: string;
  emptyHint: string;
  emptyFilteredLabel: string;
  onAskAi: (record: DentalRecordRow) => void;
  onEdit: (record: DentalRecordRow) => void;
  onDelete: (record: DentalRecordRow) => void;
}) {
  return (
    <>
      {/* ── Records timeline ─────────────────────────────── */}
      <div className="mt-2 mb-4 flex items-center justify-between gap-3 flex-wrap px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="m-0 text-[15px] font-semibold text-[var(--nimi-text-primary)]">{historyLabel}</h3>
          <span className="font-mono text-[12px] text-[var(--nimi-text-muted)]">
            {recordsCountLabel}
          </span>
        </div>
        {filterTabs.length > 1 && (
          <div className="flex gap-0.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-border-subtle)_45%,transparent)] p-[3px]">
            {filterTabs.map((tab) => {
              const active = typeFilter === tab.key;
              return (
                <button key={tab.key ?? 'all'} type="button" onClick={() => setTypeFilter(tab.key)}
                  className={`cursor-pointer rounded-full border-0 px-3 py-1.5 text-[12px] transition-all ${active ? 'bg-[var(--nimi-surface-card)] font-semibold text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'bg-transparent font-normal text-[var(--nimi-text-muted)]'}`}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sortedRecords.length === 0 && !showForm && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-8 text-center">
          <span className="text-[24px]">🦷</span>
          <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">{emptyLabel}</p>
          <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">{emptyHint}</p>
        </Surface>
      )}

      {sortedRecords.length > 0 && filteredSortedRecords.length === 0 && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-6 text-center">
          <p className="text-[14px] text-[var(--nimi-text-muted)]">{emptyFilteredLabel}</p>
        </Surface>
      )}

      {filteredSortedRecords.length > 0 && (
        <DentalHistoryRecordList
          recordGroups={recordGroups}
          attachmentMap={attachmentMap}
          alignerContextMap={alignerContextMap}
          fmtAge={fmtAge}
          onAskAi={onAskAi}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </>
  );
}
