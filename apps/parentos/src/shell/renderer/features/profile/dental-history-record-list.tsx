import { IconButton, StatusBadge, Surface, Timeline, TimelineGroup } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AttachmentRow, DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { DentalRecordActionMenu } from './dental-record-action-menu.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';
import { dentalEventLabelAndEmoji, SEVERITY_LABELS, formatDentalToothLabel } from './dental-page-domain.js';
import { DentalPhotoLightbox } from './dental-photo-lightbox.js';
import { formatAlignerContext, type AlignerContext } from './orthodontic-derive.js';

const DENTAL_TYPE_TONE_DEFAULT = 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_14%,transparent)] text-[var(--nimi-status-neutral)]';
const DENTAL_TYPE_TONE: Record<string, string> = {
  eruption: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  loss: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  caries: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]',
  filling: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]',
  cleaning: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]',
  fluoride: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]',
  sealant: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]',
  'ortho-assessment': 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]',
  'ortho-start': 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]',
  'ortho-review': 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]',
  'ortho-adjustment': 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]',
  'ortho-issue': 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]',
  'ortho-end': 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  checkup: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]',
};

interface Props {
  recordGroups: Array<[string, DentalRecordRow[]]>;
  attachmentMap: Map<string, AttachmentRow[]>;
  /** Per-record PO-ORTHO-006a aligner-context decoration; absent for non-ortho rows. */
  alignerContextMap: Map<string, AlignerContext>;
  fmtAge: (months: number) => string;
  onAskAi: (record: DentalRecordRow) => void;
  onEdit: (record: DentalRecordRow) => void;
  onDelete: (record: DentalRecordRow) => void;
}

export function DentalHistoryRecordList({
  recordGroups,
  attachmentMap,
  alignerContextMap,
  fmtAge,
  onAskAi,
  onEdit,
  onDelete,
}: Props) {
  return (
    <Timeline>
      {recordGroups.map(([date, dayRecords], gi) => (
        <TimelineGroup
          key={date}
          variant="past"
          date={formatDateLabel(date)}
          secondaryLabel={`${dayRecords.length} 条`}
          isLast={gi === recordGroups.length - 1}
        >
          {dayRecords.map((r) => (
            <DentalHistoryRecordCard
              key={r.recordId}
              record={r}
              attachments={attachmentMap.get(r.recordId) ?? []}
              alignerContext={alignerContextMap.get(r.recordId)}
              fmtAge={fmtAge}
              onAskAi={onAskAi}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </TimelineGroup>
      ))}
    </Timeline>
  );
}

function DentalHistoryRecordCard({
  record,
  attachments,
  alignerContext,
  fmtAge,
  onAskAi,
  onEdit,
  onDelete,
}: {
  record: DentalRecordRow;
  attachments: AttachmentRow[];
  alignerContext: AlignerContext | undefined;
  fmtAge: (months: number) => string;
  onAskAi: (record: DentalRecordRow) => void;
  onEdit: (record: DentalRecordRow) => void;
  onDelete: (record: DentalRecordRow) => void;
}) {
  const evtInfo = dentalEventLabelAndEmoji(record.eventType);
  const toothLabel = formatDentalToothLabel(record.toothId);
  const toneClassName = DENTAL_TYPE_TONE[record.eventType] ?? DENTAL_TYPE_TONE_DEFAULT;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <Surface
      as="article"
      tone="card"
      material="solid"
      elevation="raised"
      padding="none"
      className="group rounded-lg p-5"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-sm text-[16px] ${toneClassName}`}>
            <span className="leading-none">{evtInfo.emoji}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--nimi-text-primary)]">
              <span>{evtInfo.label}</span>
              {toothLabel && (
                <StatusBadge tone="neutral" className="px-2 py-0.5 font-mono text-[10px]">
                  {toothLabel}
                </StatusBadge>
              )}
              {record.severity && (
                <StatusBadge
                  tone={record.severity === 'severe' ? 'danger' : record.severity === 'moderate' ? 'warning' : 'neutral'}
                  className="px-2 py-0.5 text-[10px]"
                >
                  {SEVERITY_LABELS[record.severity] ?? record.severity}
                </StatusBadge>
              )}
              {alignerContext && (
                <StatusBadge tone="info" className="px-2 py-0.5 text-[10px]">
                  {formatAlignerContext(alignerContext)}
                </StatusBadge>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--nimi-text-muted)]">
              {fmtAge(record.ageMonths)}{record.hospital ? ` · ${record.hospital}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <IconButton
            onClick={(event) => { event.stopPropagation(); onAskAi(record); }}
            tone="ghost"
            size="sm"
            className="h-7 min-h-7 w-7 text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] hover:text-[var(--nimi-action-primary-bg)]"
            aria-label="和 AI 聊这条记录"
            title="和 AI 聊这条记录"
            icon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
              </svg>
            )}
          />
          <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <DentalRecordActionMenu onEdit={() => onEdit(record)} onDelete={() => onDelete(record)} />
          </div>
        </div>
      </div>
      {record.notes && (
        <p className="mt-3.5 text-[13.5px] leading-[1.75] tracking-normal text-[var(--nimi-text-primary)]">
          {record.notes}
        </p>
      )}
      {attachments.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 14 }}>
          {attachments.map((a, idx) => (
            <button
              key={a.attachmentId}
              type="button"
              onClick={() => setLightboxIndex(idx)}
              aria-label={`查看照片 ${idx + 1} / ${attachments.length}`}
              className="w-full cursor-zoom-in overflow-hidden rounded-md border-0 bg-transparent p-0 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--nimi-surface-card)_40%,transparent),0_0_0_1px_var(--nimi-border-subtle)] transition-[opacity,transform] duration-[var(--nimi-motion-fast)] hover:opacity-85"
              style={{
                aspectRatio: '1 / 1', width: '100%',
              }}
            >
              <img
                src={convertFileSrc(a.filePath)}
                alt={a.fileName}
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
      {lightboxIndex !== null && (
        <DentalPhotoLightbox
          photos={attachments}
          index={lightboxIndex}
          onChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </Surface>
  );
}
