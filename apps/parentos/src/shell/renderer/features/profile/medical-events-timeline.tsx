import { formatAge } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import {
  EVENT_TYPE_COLORS,
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
      <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
        <span className="text-[28px]">🏥</span>
        <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>
          {events.length === 0 ? '还没有就医记录' : '未找到匹配的记录'}
        </p>
        <p className="text-[11px] mt-1" style={{ color: S.sub }}>
          {events.length === 0 ? '记录门诊、体检、用药等信息' : '尝试调整筛选条件'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {searchQuery ? (
        <p className="text-[11px] mb-3" style={{ color: S.sub }}>
          找到 {filteredEvents.length} 条匹配记录
        </p>
      ) : null}

      <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

      {timelineGroups.map(([yearMonth, monthEvents]) => (
        <div key={yearMonth} className="relative pl-10 pb-6">
          <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center" style={{ background: S.card, borderColor: S.accent }}>
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />
          </div>

          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-bold" style={{ color: S.text }}>{formatMonthLabel(yearMonth)}</span>
            <span className="text-[10px]" style={{ color: S.sub }}>{monthEvents.length} 条记录</span>
          </div>

          <div className="space-y-1.5">
            {monthEvents.map((event) => {
              const typeColor = EVENT_TYPE_COLORS[event.eventType] ?? '#6b7280';
              const dateStr = event.eventDate.split('T')[0] ?? event.eventDate;
              const day = parseInt(dateStr.split('-')[2] ?? '1', 10);
              const isSevere = event.severity === 'severe';

              return (
                <div key={event.eventId}>
                  <div className={`flex items-start gap-2.5 p-2.5 ${S.radiusSm} transition-all duration-150`} style={{ background: isSevere ? '#fef2f2' : S.card, border: `1px solid ${isSevere ? '#fca5a5' : S.border}` }}>
                    <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[12px] shrink-0 font-medium" style={{ background: typeColor + '18', color: typeColor }}>
                      {EVENT_TYPE_ICONS[event.eventType] ?? '📋'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12px] font-medium" style={{ color: S.text }}>{event.title}</p>
                        {event.severity ? (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full ${event.severity === 'severe'
                              ? 'bg-red-100 text-red-700'
                              : event.severity === 'moderate'
                                ? 'bg-amber-100 text-amber-700'
                                : ''}`}
                            style={event.severity === 'mild' ? { background: '#f0f0ec', color: S.sub } : undefined}
                          >
                            {SEVERITY_LABELS[event.severity] ?? event.severity}
                          </span>
                        ) : null}
                        {event.result ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${event.result === 'pass' ? 'bg-green-100 text-green-700' : event.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {RESULT_LABELS[event.result] ?? event.result}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] truncate" style={{ color: S.sub }}>
                        {day}日
                        {event.endDate ? ` - ${event.endDate.split('T')[0]}` : ''}
                        {event.hospital ? ` · ${event.hospital}` : ''}
                        {` · ${formatAge(event.ageMonths)}`}
                      </p>
                      {event.medication || event.dosage ? (
                        <p className="text-[10px] mt-0.5" style={{ color: S.accent }}>
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
                                  <div key={item.key} className="flex items-center gap-2 text-[10px]">
                                    <span className="w-14 shrink-0" style={{ color: S.sub }}>{item.label}</span>
                                    <span className="font-medium" style={{ color: S.text }}>{value} {item.unit}</span>
                                    <span className="px-1 py-0.5 rounded text-[9px]" style={{ background: `${range.color}20`, color: range.color }}>{range.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return <p className="text-[10px] mt-0.5 truncate" style={{ color: S.sub }}>{event.notes}</p>;
                      })() : null}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: typeColor + '18', color: typeColor }}>
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => onEdit(event)} className="text-[10px] px-1.5 py-0.5 rounded-full transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }} title="编辑">✏️</button>
                        <button onClick={() => onAnalyze(event)} disabled={eventAiLoading === event.eventId} className="text-[10px] px-1.5 py-0.5 rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-40" style={{ color: S.sub }} title="AI 分析">
                          {eventAiLoading === event.eventId ? '⏳' : '✨'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {eventAiResult[event.eventId] ? (
                    <div className={`ml-[38px] mt-1 p-2.5 ${S.radiusSm}`} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">✨</span>
                          <span className="text-[10px] font-semibold" style={{ color: S.text }}>AI 分析</span>
                        </div>
                        <button onClick={() => onCloseAI(event.eventId)} className="text-[10px] hover:bg-[#f0f0ec] px-1 rounded" style={{ color: S.sub }}>
                          收起
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed" style={{ color: S.text }}>
                        {eventAiResult[event.eventId]}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
