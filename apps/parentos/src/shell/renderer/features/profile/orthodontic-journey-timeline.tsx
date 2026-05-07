import { useMemo } from 'react';
import { Surface, ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type {
  OrthodonticJourney,
  OrthodonticJourneyEntry,
} from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { formatHours } from './orthodontic-derive.js';

interface Props {
  journey: OrthodonticJourney | null;
  loading: boolean;
}

/**
 * Journey timeline: past events (实线圆点, time descending — most recent on
 * top) + a "今天" divider + future events (虚线圆点, time ascending). Entries
 * are tagged-union typed so each kind renders with its own icon and copy.
 */
export function OrthodonticJourneyTimeline({ journey, loading }: Props) {
  const items = useMemo(() => {
    if (!journey) return [] as RenderItem[];
    const past: RenderItem[] = [...journey.past]
      .sort((a, b) => entryTime(b).localeCompare(entryTime(a))) // most recent on top
      .map((entry) => ({ kind: 'past' as const, entry }));
    const future: RenderItem[] = [...journey.future]
      .sort((a, b) => entryTime(a).localeCompare(entryTime(b)))
      .map((entry) => ({ kind: 'future' as const, entry }));
    // Render order: future (top, "marching toward") → divider → past (bottom).
    // Reverse: parents read "what's next" first; the "今天" divider sits between them.
    return [
      ...future,
      { kind: 'divider' as const, key: 'today' },
      ...past,
    ];
  }, [journey]);

  if (loading) {
    return (
      <Surface
        as="section"
        material="solid"
        padding="none"
        tone="card"
        className="rounded-[20px] p-6"
        style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
      >
        <p className="text-[14px]" style={{ color: S.sub }}>
          时间轴加载中…
        </p>
      </Surface>
    );
  }

  return (
    <Surface
      as="section"
      material="solid"
      padding="none"
      tone="card"
      className="rounded-[20px] p-6"
      style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
    >
      <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub }}>
        旅程时间轴
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-[14px]" style={{ color: S.sub }}>
          还没有事件。开始记录后会按时间顺序呈现在此。
        </p>
      ) : (
        <ScrollArea className="mt-3 max-h-[420px] pr-1">
          <ul className="flex flex-col gap-3" role="list">
            {items.map((item, idx) => {
              if (item.kind === 'divider') {
                return (
                  <li
                    key={item.key}
                    className="text-[12px] uppercase tracking-[0.08em] flex items-center gap-2"
                    style={{ color: S.sub }}
                  >
                    <span style={{ flex: 1, height: 1, background: 'rgba(226,232,240,0.9)' }} />
                    今天
                    <span style={{ flex: 1, height: 1, background: 'rgba(226,232,240,0.9)' }} />
                  </li>
                );
              }
              return (
                <TimelineRow
                  key={`${item.kind}-${idx}-${entryTime(item.entry)}`}
                  item={item}
                />
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </Surface>
  );
}

type RenderItem =
  | { kind: 'past'; entry: OrthodonticJourneyEntry }
  | { kind: 'future'; entry: OrthodonticJourneyEntry }
  | { kind: 'divider'; key: string };

function TimelineRow({ item }: { item: { kind: 'past' | 'future'; entry: OrthodonticJourneyEntry } }) {
  const entry = item.entry;
  const dotStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: item.kind === 'past' ? '#4ECCA3' : '#ffffff',
    border: item.kind === 'future' ? '1.5px dashed #94a3b8' : 'none',
    flexShrink: 0,
    marginTop: 6,
  };
  const dateLabel = entryDateLabel(entry);
  return (
    <li className="flex items-start gap-3" role="listitem">
      <span style={dotStyle} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px]" style={{ color: S.text, fontWeight: 500 }}>
          {entryHeadline(entry)}
        </p>
        <p className="mt-0.5 text-[12px]" style={{ color: S.sub }}>
          {dateLabel}
          {entryDetail(entry) ? ` · ${entryDetail(entry)}` : ''}
        </p>
      </div>
    </li>
  );
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

function entryDateLabel(entry: OrthodonticJourneyEntry): string {
  return entryTime(entry).slice(0, 10);
}

function entryHeadline(entry: OrthodonticJourneyEntry): string {
  switch (entry.kind) {
    case 'case-started':
      return '疗程开始';
    case 'appliance-started':
      return '装置启用';
    case 'appliance-paused':
      return '装置暂停';
    case 'appliance-completed':
      return '装置结束';
    case 'aligner-change':
      return `换牙套 · 第 ${entry.alignerIndex} 副`;
    case 'expander-activation':
      return `扩弓加力 · 第 ${entry.activationIndex} 次`;
    case 'clinical-event':
      return clinicalEventLabel(entry.eventType);
    case 'unwear-interval':
      return entry.endAt ? '一段未戴时段' : '正在未戴中';
    case 'next-clinical-review':
      return '下次复诊';
    case 'next-aligner-change':
      return `预计换套 · 第 ${entry.alignerIndex} 副`;
    case 'cycle-planned-switch':
      return '本副计划换套';
    case 'case-planned-end':
      return '疗程预计结束';
  }
}

function entryDetail(entry: OrthodonticJourneyEntry): string | null {
  switch (entry.kind) {
    case 'case-started':
      return `${entry.caseType} · ${entry.stage}`;
    case 'appliance-paused':
      return entry.reason ?? null;
    case 'unwear-interval':
      return entry.durationHours !== null
        ? formatHours(entry.durationHours)
        : '未关闭';
    case 'clinical-event':
      return entry.hospital ?? entry.notes ?? null;
    default:
      return null;
  }
}

function clinicalEventLabel(eventType: string): string {
  switch (eventType) {
    case 'ortho-review':
      return '复诊';
    case 'ortho-adjustment':
      return '装置调整';
    case 'ortho-issue':
      return '异常事件';
    case 'ortho-end':
      return '治疗结束';
    case 'ortho-assessment':
      return '初评';
    case 'ortho-start':
      return '正畸开始（历史）';
    default:
      return eventType;
  }
}
