import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { AttachmentRow, DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { DentalRecordActionMenu } from './dental-record-action-menu.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';
import { EVENT_TYPES, SEVERITY_LABELS, formatDentalToothLabel } from './dental-page-domain.js';
import { DentalPhotoLightbox } from './dental-photo-lightbox.js';

const DENTAL_TYPE_TONE_DEFAULT = { bg: 'rgba(100,116,139,0.12)', fg: '#475569' };
const DENTAL_TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  eruption:            { bg: 'rgba(16,185,129,0.14)',  fg: '#047857' },
  loss:                { bg: 'rgba(245,158,11,0.14)',  fg: '#b45309' },
  caries:              { bg: 'rgba(236,72,153,0.12)',  fg: '#be185d' },
  filling:             { bg: 'rgba(20,184,166,0.14)',  fg: '#0f766e' },
  cleaning:            { bg: 'rgba(14,165,233,0.12)',  fg: '#0369a1' },
  fluoride:            { bg: 'rgba(59,130,246,0.12)',  fg: '#1d4ed8' },
  sealant:             { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca' },
  'ortho-assessment':  { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca' },
  'ortho-start':       { bg: 'rgba(168,85,247,0.12)',  fg: '#7e22ce' },
  'ortho-review':      { bg: 'rgba(168,85,247,0.12)',  fg: '#7e22ce' },
  'ortho-adjustment':  { bg: 'rgba(168,85,247,0.12)',  fg: '#7e22ce' },
  'ortho-issue':       { bg: 'rgba(239,68,68,0.12)',   fg: '#b91c1c' },
  'ortho-end':         { bg: 'rgba(16,185,129,0.14)',  fg: '#047857' },
  checkup:             { bg: 'rgba(14,165,233,0.12)',  fg: '#0369a1' },
};

interface Props {
  recordGroups: Array<[string, DentalRecordRow[]]>;
  attachmentMap: Map<string, AttachmentRow[]>;
  fmtAge: (months: number) => string;
  onAskAi: (record: DentalRecordRow) => void;
  onEdit: (record: DentalRecordRow) => void;
  onDelete: (record: DentalRecordRow) => void;
}

export function DentalHistoryRecordList({
  recordGroups,
  attachmentMap,
  fmtAge,
  onAskAi,
  onEdit,
  onDelete,
}: Props) {
  return (
    <div style={{ position: 'relative', paddingLeft: 22 }}>
      <div
        style={{
          position: 'absolute',
          left: 6,
          top: 6,
          bottom: 6,
          width: 1,
          background: 'linear-gradient(to bottom, rgba(226,232,240,0.9), rgba(226,232,240,0.9) 80%, transparent)',
        }}
      />
      {recordGroups.map(([date, dayRecords], gi) => (
        <div key={date} style={{ marginBottom: gi === recordGroups.length - 1 ? 0 : 24, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: -22,
              top: 4,
              width: 13,
              height: 13,
              borderRadius: 999,
              background: '#ffffff',
              border: `2px solid ${S.accent}`,
              boxShadow: '0 0 0 3px rgba(255,255,255,0.9)',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: S.text }}>{formatDateLabel(date)}</span>
            <span style={{ fontSize: 11, color: '#64748b', fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace' }}>
              {dayRecords.length} 条
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dayRecords.map((r) => (
              <DentalHistoryRecordCard
                key={r.recordId}
                record={r}
                attachments={attachmentMap.get(r.recordId) ?? []}
                fmtAge={fmtAge}
                onAskAi={onAskAi}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DentalHistoryRecordCard({
  record,
  attachments,
  fmtAge,
  onAskAi,
  onEdit,
  onDelete,
}: {
  record: DentalRecordRow;
  attachments: AttachmentRow[];
  fmtAge: (months: number) => string;
  onAskAi: (record: DentalRecordRow) => void;
  onEdit: (record: DentalRecordRow) => void;
  onDelete: (record: DentalRecordRow) => void;
}) {
  const evtInfo = EVENT_TYPES.find((e) => e.key === record.eventType);
  const toothLabel = formatDentalToothLabel(record.toothId);
  const tone = DENTAL_TYPE_TONE[record.eventType] ?? DENTAL_TYPE_TONE_DEFAULT;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <article
      className="group"
      style={{
        background: S.card,
        padding: 20,
        borderRadius: 20,
        boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
        transition: 'box-shadow 160ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center',
            background: tone.bg, color: tone.fg, fontSize: 16, flexShrink: 0,
          }}>
            <span style={{ lineHeight: 1 }}>{evtInfo?.emoji ?? '🦷'}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: S.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{evtInfo?.label ?? record.eventType}</span>
              {toothLabel && (
                <span style={{
                  background: 'rgba(241,245,249,0.8)', color: '#475569',
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 500,
                  fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace',
                }}>
                  {toothLabel}
                </span>
              )}
              {record.severity && (
                <span style={{
                  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 500,
                  background:
                    record.severity === 'severe' ? 'rgba(239,68,68,0.12)'
                    : record.severity === 'moderate' ? 'rgba(245,158,11,0.14)'
                    : 'rgba(148,163,184,0.16)',
                  color:
                    record.severity === 'severe' ? '#b91c1c'
                    : record.severity === 'moderate' ? '#b45309'
                    : '#64748b',
                }}>
                  {SEVERITY_LABELS[record.severity] ?? record.severity}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {fmtAge(record.ageMonths)}{record.hospital ? ` · ${record.hospital}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onAskAi(record); }}
            style={{
              width: 28, height: 28, display: 'grid', placeItems: 'center',
              borderRadius: 8, border: 0, background: 'transparent', color: '#64748b',
              cursor: 'pointer', transition: 'all 160ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(78,204,163,0.12)'; e.currentTarget.style.color = '#053D2C'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}
            aria-label="和 AI 聊这条记录"
            title="和 AI 聊这条记录"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
              <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
            </svg>
          </button>
          <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <DentalRecordActionMenu onEdit={() => onEdit(record)} onDelete={() => onDelete(record)} />
          </div>
        </div>
      </div>
      {record.notes && (
        <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.75, color: S.text, letterSpacing: '0.005em' }}>
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
              style={{
                padding: 0, border: 0, background: 'transparent',
                borderRadius: 12, cursor: 'zoom-in', overflow: 'hidden',
                aspectRatio: '1 / 1', width: '100%',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(226,232,240,0.8)',
                transition: 'transform 160ms, opacity 160ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
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
    </article>
  );
}
