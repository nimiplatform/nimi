import {
  IconButton,
  StatusBadge,
  Surface,
  Timeline,
  TimelineGroup,
  cn,
  type StatusTone,
} from '@nimiplatform/nimi-kit/ui';
import { formatAge } from '../../app-shell/app-store.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import {
  EVENT_TYPE_ICONS,
  EVENT_TYPE_LABELS,
  formatMonthLabel,
  groupByMonth,
  LAB_ITEMS,
  labRangeFor,
  parseLabReport,
  RESULT_LABELS,
  SEVERITY_LABELS,
} from './medical-events-page-shared.js';

const EVENT_TYPE_TONE_CLASS_DEFAULT = 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_14%,transparent)] text-[var(--nimi-status-neutral)]';
const EVENT_TYPE_TONE_CLASS: Record<string, string> = {
  visit: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  emergency: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]',
  hospitalization: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  checkup: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)] text-[var(--nimi-status-info)]',
  medication: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  'lab-report': 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]',
  other: EVENT_TYPE_TONE_CLASS_DEFAULT,
};

const EVENT_TYPE_BADGE_TONE: Record<string, StatusTone> = {
  visit: 'info',
  emergency: 'danger',
  hospitalization: 'warning',
  checkup: 'info',
  medication: 'success',
  'lab-report': 'info',
  other: 'neutral',
};

function severityTone(severity: string): StatusTone {
  if (severity === 'severe') return 'danger';
  if (severity === 'moderate') return 'warning';
  return 'neutral';
}

function resultTone(result: string): StatusTone {
  if (result === 'pass') return 'success';
  if (result === 'fail') return 'danger';
  return 'warning';
}

function labRangeTone(label: string): StatusTone {
  if (label.includes('严重') || label.includes('耗竭') || label.includes('贫血') || label.includes('偏低')) {
    return 'danger';
  }
  if (label.includes('正常') || label.includes('充足')) return 'success';
  return 'warning';
}

export function MedicalEventsTimeline({
  events,
  filteredEvents,
  searchQuery,
  eventAiLoading,
  eventAiResult,
  onEdit,
  onAnalyze,
  onCloseAI,
}: {
  events: MedicalEventRow[];
  filteredEvents: MedicalEventRow[];
  searchQuery: string;
  eventAiLoading: string | null;
  eventAiResult: Record<string, string>;
  onEdit: (event: MedicalEventRow) => void;
  onAnalyze: (event: MedicalEventRow) => void;
  onCloseAI: (eventId: string) => void;
}) {
  const timelineGroups = groupByMonth(filteredEvents);

  if (filteredEvents.length === 0) {
    return (
      <Surface tone="card" elevation="raised" padding="none" className="rounded-lg p-8 text-center">
        <span className="text-[24px]">🏥</span>
        <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">
          {events.length === 0 ? '还没有就医记录' : '未找到匹配的记录'}
        </p>
        <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">
          {events.length === 0 ? '记录门诊、体检、用药等信息' : '尝试调整筛选条件'}
        </p>
      </Surface>
    );
  }

  return (
    <>
      {searchQuery ? (
        <p className="text-[13px] mb-3 text-[var(--nimi-text-muted)]">
          找到 {filteredEvents.length} 条匹配记录
        </p>
      ) : null}

      <Timeline>
        {timelineGroups.map(([yearMonth, monthEvents], gi) => (
          <TimelineGroup
            key={yearMonth}
            variant="past"
            dotVariant="ring"
            date={formatMonthLabel(yearMonth)}
            secondaryLabel={`${monthEvents.length} 条记录`}
            isLast={gi === timelineGroups.length - 1}
          >
            {monthEvents.map((event) => {
              const eventTypeToneClass = EVENT_TYPE_TONE_CLASS[event.eventType] ?? EVENT_TYPE_TONE_CLASS_DEFAULT;
              const eventTypeBadgeTone = EVENT_TYPE_BADGE_TONE[event.eventType] ?? 'neutral';
              const dateStr = event.eventDate.split('T')[0] ?? event.eventDate;
              const day = parseInt(dateStr.split('-')[2] ?? '1', 10);
              const isSevere = event.severity === 'severe';

              return (
                <div key={event.eventId}>
                  <Surface
                    as="article"
                    tone="card"
                    material="solid"
                    elevation="base"
                    padding="none"
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg p-2.5 transition-all duration-150',
                      isSevere && 'border-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]',
                    )}
                  >
                    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[14px] font-medium', eventTypeToneClass)}>
                      {EVENT_TYPE_ICONS[event.eventType] ?? '📋'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{event.title}</p>
                        {event.severity ? (
                          <StatusBadge tone={severityTone(event.severity)} className="px-1.5 py-0.5 text-[12px]">
                            {SEVERITY_LABELS[event.severity] ?? event.severity}
                          </StatusBadge>
                        ) : null}
                        {event.result ? (
                          <StatusBadge tone={resultTone(event.result)} className="px-1.5 py-0.5 text-[12px]">
                            {RESULT_LABELS[event.result] ?? event.result}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">
                        {day}日
                        {event.endDate ? ` - ${event.endDate.split('T')[0]}` : ''}
                        {event.hospital ? ` · ${event.hospital}` : ''}
                        {` · ${formatAge(event.ageMonths)}`}
                      </p>
                      {event.medication || event.dosage ? (
                        <p className="text-[12px] mt-0.5 text-[var(--nimi-action-primary-bg)]">
                          💊 {event.medication}{event.dosage ? ` · ${event.dosage}` : ''}
                        </p>
                      ) : null}
                      {event.notes ? (() => {
                        const labData = parseLabReport(event.notes);
                        if (labData) {
                          return (
                            <div className="mt-1.5 space-y-1">
                              {LAB_ITEMS.map((item) => {
                                const value = labData.values[item.key];
                                if (value == null) return null;
                                const range = labRangeFor(item, value);
                                return (
                                  <div key={item.key} className="flex items-center gap-2 text-[12px]">
                                    <span className="w-14 shrink-0 text-[var(--nimi-text-muted)]">{item.label}</span>
                                    <span className="font-medium text-[var(--nimi-text-primary)]">{value} {item.unit}</span>
                                    <StatusBadge tone={labRangeTone(range.label)} className="rounded px-1 py-0.5 text-[12px]">{range.label}</StatusBadge>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return <p className="text-[12px] mt-0.5 truncate text-[var(--nimi-text-muted)]">{event.notes}</p>;
                      })() : null}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <StatusBadge tone={eventTypeBadgeTone} className="px-1.5 py-0.5 text-[12px]">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                      </StatusBadge>
                      <div className="flex gap-1">
                        <IconButton
                          onClick={() => onEdit(event)}
                          tone="ghost"
                          size="sm"
                          className="h-6 min-h-6 w-6 text-[12px] text-[var(--nimi-text-muted)]"
                          title="编辑"
                          aria-label="编辑"
                          icon="✏️"
                        />
                        <IconButton
                          onClick={() => onAnalyze(event)}
                          disabled={eventAiLoading === event.eventId}
                          tone="ghost"
                          size="sm"
                          className="h-6 min-h-6 w-6 text-[12px] text-[var(--nimi-text-muted)]"
                          title="AI 分析"
                          aria-label="AI 分析"
                          icon={eventAiLoading === event.eventId ? '⏳' : '✨'}
                        />
                      </div>
                    </div>
                  </Surface>

                  {eventAiResult[event.eventId] ? (
                    <Surface tone="card" material="solid" elevation="base" padding="none" className="ml-[38px] mt-1 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[12px]">✨</span>
                          <span className="text-[12px] font-semibold text-[var(--nimi-text-primary)]">AI 分析</span>
                        </div>
                        <button onClick={() => onCloseAI(event.eventId)} className="rounded px-1 text-[12px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                          收起
                        </button>
                      </div>
                      <p className="text-[12px] leading-relaxed text-[var(--nimi-text-primary)]">
                        {eventAiResult[event.eventId]}
                      </p>
                    </Surface>
                  ) : null}
                </div>
              );
            })}
          </TimelineGroup>
        ))}
      </Timeline>
    </>
  );
}
