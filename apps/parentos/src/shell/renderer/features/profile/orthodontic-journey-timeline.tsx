import {
  IconButton,
  StatusBadge,
  Surface,
  Timeline,
  TimelineDivider,
  TimelineGroup,
  cn,
} from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type {
  AttachmentRow,
  DentalRecordRow,
  OrthodonticJourney,
  OrthodonticJourneyEntry,
} from '../../bridge/sqlite-bridge.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';
import { formatHours } from './orthodontic-derive.js';
import {
  DentalPhotoLightbox,
  type DentalPhotoLightboxItem,
} from './dental-photo-lightbox.js';
import { DentalRecordActionMenu } from './dental-record-action-menu.js';
import { dentalEventLabelAndEmoji } from './dental-page-domain.js';

interface Props {
  journey: OrthodonticJourney | null;
  loading: boolean;
  /**
   * Ortho-* dental records for the child, surfaced into the journey for
   * clinical-event entries — provides `ageMonths`, `hospital`, and the
   * row-level `recordId` used to look up attachments. Both this timeline
   * and the dental history list render these same rows; the merge happens
   * via `recordId` matching between the journey's clinical-event entry and
   * this list.
   */
  orthoDentalRecords: DentalRecordRow[];
  attachmentMap: Map<string, AttachmentRow[]>;
  /**
   * Per-card actions for clinical-event entries (the only kind backed by a
   * mutable dental_records row). Non-clinical-event entries don't surface
   * actions in v1 — case-started / appliance-* / aligner-change /
   * unwear-interval / futures all have their own edit/delete paths
   * elsewhere on the page (gear, ⋯ menu, switch modal, backfill form),
   * routing them here would create surface-level duplication.
   */
  onAskAiAboutRecord: (record: DentalRecordRow) => void;
  onEditRecord: (record: DentalRecordRow) => void;
  onDeleteRecord: (record: DentalRecordRow) => void;
}

/**
 * Journey timeline shaped like the dental history list: per-date groups
 * with a green dot marker on a vertical line, rich card per entry, future
 * events grouped above the "今天" divider with dashed dot markers.
 *
 * All orthodontic journey entry kinds (case-started, aligner-change,
 * unwear-interval, clinical-event, futures, ...) project to one uniform
 * `JourneyCardData` shape so the visual stays consistent. Clinical-event
 * entries are enriched with the matching `DentalRecordRow` + attachments
 * so they render with photos like in the dental history list.
 */
export function OrthodonticJourneyTimeline({
  journey,
  loading,
  orthoDentalRecords,
  attachmentMap,
  onAskAiAboutRecord,
  onEditRecord,
  onDeleteRecord,
}: Props) {
  const recordById = useMemo(() => {
    const m = new Map<string, DentalRecordRow>();
    for (const r of orthoDentalRecords) m.set(r.recordId, r);
    return m;
  }, [orthoDentalRecords]);

  const { pastByDate, futureByDate, pastDates, futureDates } = useMemo(() => {
    if (!journey) {
      return {
        pastByDate: new Map<string, JourneyCardData[]>(),
        futureByDate: new Map<string, JourneyCardData[]>(),
        pastDates: [] as string[],
        futureDates: [] as string[],
      };
    }
    const pastCards: JourneyCardData[] = journey.past
      .map((e) => projectEntry(e, false, recordById, attachmentMap))
      .filter((c): c is JourneyCardData => c !== null);
    // Collapse repeatable future projections. Multiple active appliances each
    // emit their own `next-clinical-review` row (one per appliance ×
    // nextReviewDate); the parent only cares about the SINGLE nearest follow-
    // up. Same shape concern for other "next-*" kinds — keep only the
    // earliest occurrence per kind so the future column reads as a clean
    // forward roadmap, not a per-appliance audit log.
    const futureCards: JourneyCardData[] = collapseRepeatableFutures(journey.future)
      .map((e) => projectEntry(e, true, recordById, attachmentMap))
      .filter((c): c is JourneyCardData => c !== null);
    return {
      pastByDate: groupByDate(pastCards),
      futureByDate: groupByDate(futureCards),
      // Past: descending (most recent past just below the divider, oldest
      // at the bottom). Future: ALSO descending — farthest future at the
      // top, nearest future just above the divider. The two halves fan out
      // from "今天": reading top→bottom is always going backward in time.
      pastDates: sortedDates(pastCards, 'desc'),
      futureDates: sortedDates(futureCards, 'desc'),
    };
  }, [journey, recordById, attachmentMap]);

  const [lightboxState, setLightboxState] = useState<
    { photos: DentalPhotoLightboxItem[]; index: number } | null
  >(null);

  if (loading) {
    return (
      <p className="text-[14px] text-[var(--nimi-text-muted)]">
        时间轴加载中…
      </p>
    );
  }

  const isEmpty = pastDates.length === 0 && futureDates.length === 0;
  if (isEmpty) {
    return (
      <p className="text-[14px] text-[var(--nimi-text-muted)]">
        还没有事件。开始记录后会按时间顺序呈现在此。
      </p>
    );
  }

  return (
    <Timeline>
      {/* Future groups (descending: farthest future first, nearest above today) */}
      {futureDates.map((date) => {
        const cards = futureByDate.get(date) ?? [];
        if (cards.length === 0) return null;
        return (
          <TimelineGroup
            key={`future-${date}`}
            variant="future"
            date={formatDateLabel(date)}
            secondaryLabel={`${cards.length} 条`}
          >
            {cards.map((card) => (
              <JourneyCard
                key={card.id}
                card={card}
                onOpenLightbox={(photos, index) => setLightboxState({ photos, index })}
                onAskAiAboutRecord={onAskAiAboutRecord}
                onEditRecord={onEditRecord}
                onDeleteRecord={onDeleteRecord}
              />
            ))}
          </TimelineGroup>
        );
      })}

      {/* "今天" divider only when there's at least one past entry; otherwise
          the future groups stand alone. */}
      {pastDates.length > 0 && futureDates.length > 0 && <TimelineDivider label="今天" />}

      {/* Past groups (descending: most recent first) */}
      {pastDates.map((date, gi) => {
        const cards = pastByDate.get(date) ?? [];
        if (cards.length === 0) return null;
        return (
          <TimelineGroup
            key={`past-${date}`}
            variant="past"
            date={formatDateLabel(date)}
            secondaryLabel={`${cards.length} 条`}
            isLast={gi === pastDates.length - 1}
          >
            {cards.map((card) => (
              <JourneyCard
                key={card.id}
                card={card}
                onOpenLightbox={(photos, index) => setLightboxState({ photos, index })}
                onAskAiAboutRecord={onAskAiAboutRecord}
                onEditRecord={onEditRecord}
                onDeleteRecord={onDeleteRecord}
              />
            ))}
          </TimelineGroup>
        );
      })}

      {lightboxState && (
        <DentalPhotoLightbox
          photos={lightboxState.photos}
          index={lightboxState.index}
          onChange={(idx) => setLightboxState({ ...lightboxState, index: idx })}
          onClose={() => setLightboxState(null)}
        />
      )}
    </Timeline>
  );
}

// ── Card ───────────────────────────────────────────────────

function JourneyCard({
  card,
  onOpenLightbox,
  onAskAiAboutRecord,
  onEditRecord,
  onDeleteRecord,
}: {
  card: JourneyCardData;
  onOpenLightbox: (photos: DentalPhotoLightboxItem[], index: number) => void;
  onAskAiAboutRecord: (record: DentalRecordRow) => void;
  onEditRecord: (record: DentalRecordRow) => void;
  onDeleteRecord: (record: DentalRecordRow) => void;
}) {
  return (
    <Surface
      as="article"
      tone="card"
      elevation="raised"
      padding="none"
      className="group border-transparent p-5"
      style={{
        opacity: card.isFuture ? 0.92 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          minWidth: 0,
        }}
      >
        <div
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[16px]',
            card.toneClassName,
          )}
          style={{
            width: 32,
            height: 32,
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          <span style={{ lineHeight: 1 }}>{card.emoji}</span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="text-[var(--nimi-text-primary)]"
            style={{
              fontSize: 14,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span>{card.title}</span>
            {card.isFuture && <FutureBadge />}
          </div>
          {card.subtitle && (
            <div className="text-[var(--nimi-text-muted)]" style={{ fontSize: 11, marginTop: 2 }}>
              {card.subtitle}
            </div>
          )}
        </div>
        {card.record && (
          <CardActionButtons
            record={card.record}
            onAskAiAboutRecord={onAskAiAboutRecord}
            onEditRecord={onEditRecord}
            onDeleteRecord={onDeleteRecord}
          />
        )}
      </div>

      {card.content && (
        <p
          className="text-[var(--nimi-text-secondary)]"
          style={{
            margin: '10px 0 0',
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {card.content}
        </p>
      )}

      {card.photos && card.photos.length > 0 && (
        <PhotoStrip photos={card.photos} onOpen={onOpenLightbox} />
      )}
    </Surface>
  );
}

/**
 * AI ✨ + edit/delete ⋮ cluster for clinical-event cards. Mirrors the
 * `DentalHistoryRecordList` action layout so the orthodontic timeline and
 * the dental history list feel like the same surface for ortho-* events.
 * The ⋮ menu fades in on group-hover to keep the resting card calm —
 * `group` class lives on the parent `<article>`.
 */
function CardActionButtons({
  record,
  onAskAiAboutRecord,
  onEditRecord,
  onDeleteRecord,
}: {
  record: DentalRecordRow;
  onAskAiAboutRecord: (record: DentalRecordRow) => void;
  onEditRecord: (record: DentalRecordRow) => void;
  onDeleteRecord: (record: DentalRecordRow) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <IconButton
        size="sm"
        tone="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onAskAiAboutRecord(record);
        }}
        aria-label="和 AI 聊这条记录"
        title="和 AI 聊这条记录"
        icon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
            <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
          </svg>
        }
      />
      <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <DentalRecordActionMenu
          onEdit={() => onEditRecord(record)}
          onDelete={() => onDeleteRecord(record)}
        />
      </div>
    </div>
  );
}

function FutureBadge() {
  return (
    <StatusBadge tone="info" className="px-2 py-0.5 text-[10px] font-medium">
      预计
    </StatusBadge>
  );
}

function PhotoStrip({
  photos,
  onOpen,
}: {
  photos: DentalPhotoLightboxItem[];
  onOpen: (photos: DentalPhotoLightboxItem[], index: number) => void;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 6,
      }}
    >
      {photos.map((p, idx) => (
        <button
          key={p.attachmentId}
          type="button"
          onClick={() => onOpen(photos, idx)}
          className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border-0 bg-transparent p-0"
          style={{
            aspectRatio: '1 / 1',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <img
            src={convertFileSrc(p.filePath)}
            alt={p.fileName}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </button>
      ))}
    </div>
  );
}

// ── Projection: journey entry → uniform card shape ─────────

interface JourneyCardData {
  id: string;
  date: string;       // yyyy-mm-dd for grouping
  occurredAt: string; // full ISO for sub-sorting within a group
  isFuture: boolean;
  emoji: string;
  toneClassName: string;
  title: string;
  subtitle: string | null;
  content: string | null;
  photos: DentalPhotoLightboxItem[] | null;
  /** Backing record for clinical-event cards — enables AI/edit/delete actions. */
  record: DentalRecordRow | null;
}

function projectEntry(
  entry: OrthodonticJourneyEntry,
  isFuture: boolean,
  recordById: Map<string, DentalRecordRow>,
  attachmentMap: Map<string, AttachmentRow[]>,
): JourneyCardData | null {
  const occurredAt = entryTime(entry);
  const date = occurredAt.slice(0, 10);
  const base = {
    date,
    occurredAt,
    isFuture,
    photos: null,
    content: null,
    subtitle: null,
    record: null,
  } satisfies Partial<JourneyCardData>;
  switch (entry.kind) {
    case 'case-started':
      return {
        ...base,
        id: `case-started-${entry.occurredAt}`,
        ...TONE.brand,
        emoji: '🦷',
        title: '疗程开始',
        subtitle: `${entry.caseType} · ${entry.stage}`,
      };
    case 'appliance-started':
      return {
        ...base,
        id: `appliance-started-${entry.applianceId}-${entry.occurredAt}`,
        ...TONE.brand,
        emoji: '🔧',
        title: '装置启用',
        subtitle: entry.applianceType,
      };
    case 'appliance-paused':
      return {
        ...base,
        id: `appliance-paused-${entry.applianceId}-${entry.occurredAt}`,
        ...TONE.warning,
        emoji: '⏸️',
        title: '装置暂停',
        content: entry.reason ?? null,
      };
    case 'appliance-completed':
      return {
        ...base,
        id: `appliance-completed-${entry.applianceId}-${entry.occurredAt}`,
        ...TONE.success,
        emoji: '✅',
        title: '装置结束',
      };
    case 'aligner-change':
      return {
        ...base,
        id: `aligner-change-${entry.applianceId}-${entry.alignerIndex}-${entry.occurredAt}`,
        ...TONE.brand,
        emoji: '🔄',
        title: `换牙套 · 第 ${entry.alignerIndex} 副`,
      };
    case 'expander-activation':
      return {
        ...base,
        id: `expander-activation-${entry.applianceId}-${entry.activationIndex}-${entry.occurredAt}`,
        ...TONE.brand,
        emoji: '🔧',
        title: `扩弓加力 · 第 ${entry.activationIndex} 次`,
      };
    case 'clinical-event': {
      const meta = dentalEventLabelAndEmoji(entry.eventType);
      const record = recordById.get(entry.recordId);
      const attachments = attachmentMap.get(entry.recordId) ?? [];
      const photos: DentalPhotoLightboxItem[] = attachments
        .filter((a) => a.mimeType?.startsWith('image/'))
        .map((a) => ({
          attachmentId: a.attachmentId,
          filePath: a.filePath,
          fileName: a.fileName,
        }));
      return {
        ...base,
        id: `clinical-event-${entry.recordId}`,
        ...TONE.brand,
        emoji: meta.emoji,
        title: meta.label,
        subtitle: entry.hospital ?? record?.hospital ?? null,
        content: entry.notes ?? record?.notes ?? null,
        photos: photos.length > 0 ? photos : null,
        record: record ?? null,
      };
    }
    case 'unwear-interval':
      return {
        ...base,
        id: `unwear-interval-${entry.startAt}`,
        ...TONE.warning,
        emoji: '⏱️',
        title: entry.endAt ? '一段未戴时段' : '正在未戴中',
        subtitle:
          entry.durationHours !== null
            ? formatHours(entry.durationHours)
            : '未关闭',
      };
    case 'next-clinical-review':
      return {
        ...base,
        id: `next-clinical-review-${entry.applianceId}-${entry.predictedAt}`,
        ...TONE.brand,
        emoji: '📋',
        title: '下次复诊',
      };
    case 'next-aligner-change':
      return {
        ...base,
        id: `next-aligner-change-${entry.applianceId}-${entry.alignerIndex}-${entry.predictedAt}`,
        ...TONE.brand,
        emoji: '🔄',
        title: `预计换套 · 第 ${entry.alignerIndex} 副`,
      };
    case 'cycle-planned-switch':
      return {
        ...base,
        id: `cycle-planned-switch-${entry.applianceId}-${entry.predictedAt}`,
        ...TONE.brand,
        emoji: '📅',
        title: '本副计划换套',
      };
    case 'case-planned-end':
      return {
        ...base,
        id: `case-planned-end-${entry.predictedAt}`,
        ...TONE.success,
        emoji: '🏁',
        title: '疗程预计结束',
      };
  }
}

const TONE = {
  brand: {
    toneClassName:
      'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]',
  },
  success: {
    toneClassName:
      'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  },
  warning: {
    toneClassName:
      'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  },
} as const;

/**
 * Per-kind dedup of future-projection rows. The Rust journey emits one
 * `next-clinical-review` / `next-aligner-change` / `cycle-planned-switch`
 * per active appliance. The parent's mental model is "what happens next" —
 * showing both the 6/3 and the 6/24 next-review (one per appliance) doubles
 * up. Keep only the earliest occurrence per kind. Non-collapsible kinds
 * (case-planned-end is single-shot already, but defensively whitelist it)
 * pass through unchanged.
 */
const COLLAPSIBLE_FUTURE_KINDS: ReadonlySet<OrthodonticJourneyEntry['kind']> = new Set([
  'next-clinical-review',
  'next-aligner-change',
  'cycle-planned-switch',
]);

function collapseRepeatableFutures(
  future: OrthodonticJourneyEntry[],
): OrthodonticJourneyEntry[] {
  const earliestByKind = new Map<OrthodonticJourneyEntry['kind'], OrthodonticJourneyEntry>();
  const passthrough: OrthodonticJourneyEntry[] = [];
  for (const entry of future) {
    if (!COLLAPSIBLE_FUTURE_KINDS.has(entry.kind)) {
      passthrough.push(entry);
      continue;
    }
    const existing = earliestByKind.get(entry.kind);
    if (!existing || entryTime(entry).localeCompare(entryTime(existing)) < 0) {
      earliestByKind.set(entry.kind, entry);
    }
  }
  return [...passthrough, ...earliestByKind.values()];
}

function entryTime(entry: OrthodonticJourneyEntry): string {
  switch (entry.kind) {
    case 'unwear-interval':
      return entry.startAt;
    case 'next-clinical-review':
    case 'next-aligner-change':
    case 'cycle-planned-switch':
    case 'case-planned-end':
      return entry.predictedAt;
    default:
      return entry.occurredAt;
  }
}

function groupByDate(cards: JourneyCardData[]): Map<string, JourneyCardData[]> {
  const map = new Map<string, JourneyCardData[]>();
  for (const c of cards) {
    const list = map.get(c.date);
    if (list) list.push(c);
    else map.set(c.date, [c]);
  }
  // Sort within each group by full occurredAt (descending — most recent first
  // within the day; reads like the dental history list).
  for (const list of map.values()) {
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  return map;
}

function sortedDates(cards: JourneyCardData[], order: 'asc' | 'desc'): string[] {
  const set = new Set<string>();
  for (const c of cards) set.add(c.date);
  const arr = [...set];
  return order === 'asc'
    ? arr.sort((a, b) => a.localeCompare(b))
    : arr.sort((a, b) => b.localeCompare(a));
}
