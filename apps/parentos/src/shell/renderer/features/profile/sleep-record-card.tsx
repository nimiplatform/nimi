import { formatAge } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import {
  fmtDuration,
  QUALITY_COLOR,
  QUALITY_LABELS,
  sleepAgeTier,
  unpackNotes,
} from './sleep-page-shared.js';

export function SleepRecordCard({
  record,
}: {
  record: SleepRecordRow;
}) {
  const tier = sleepAgeTier(record.ageMonths);
  const totalMin = (record.durationMinutes ?? 0) + (record.napMinutes ?? 0);
  const { nightWakings, napNotes, freeNotes } = unpackNotes(record.notes);
  const qualityColor = record.quality ? QUALITY_COLOR[record.quality] : null;

  return (
    <div className={S.radius + ' p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: S.text }}>{record.sleepDate.split('T')[0]}</span>
          {record.quality && qualityColor ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: qualityColor.bg, color: qualityColor.text }}>
              {QUALITY_LABELS[record.quality] ?? record.quality}
            </span>
          ) : null}
        </div>
        <span className="text-[10px]" style={{ color: S.sub }}>{formatAge(record.ageMonths)}</span>
      </div>

      {tier === 'infant' || tier === 'toddler' ? (
        <div className="flex items-baseline gap-4">
          {totalMin > 0 ? (
            <div>
              <span className="text-[22px] font-bold" style={{ color: S.text }}>{(totalMin / 60).toFixed(1)}</span>
              <span className="text-[11px] ml-0.5" style={{ color: S.sub }}>小时</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]" style={{ color: S.sub }}>
            {record.bedtime && record.wakeTime ? <span>{record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}</span> : null}
            {record.durationMinutes != null ? <span>夜间 {fmtDuration(record.durationMinutes)}</span> : null}
            {record.napCount != null ? <span>小睡 {record.napCount} 次</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>小睡 {record.napMinutes}分钟</span> : null}
            {nightWakings != null && nightWakings > 0 ? <span style={{ color: '#d97706' }}>夜醒 {nightWakings} 次</span> : null}
          </div>
        </div>
      ) : tier === 'preschool' ? (
        <div className="flex items-baseline gap-4">
          {record.durationMinutes != null ? (
            <div>
              <span className="text-[18px] font-bold" style={{ color: S.text }}>{fmtDuration(record.durationMinutes)}</span>
              <span className="text-[11px] ml-1" style={{ color: S.sub }}>夜间</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3 text-[11px]" style={{ color: S.sub }}>
            {record.bedtime && record.wakeTime ? <span>{record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>午睡 {record.napMinutes}分钟</span> : null}
            {totalMin > 0 ? <span>总计 {(totalMin / 60).toFixed(1)}h</span> : null}
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-4">
          {record.bedtime && record.wakeTime ? (
            <span className="text-[16px] font-semibold" style={{ color: S.text }}>
              {record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}
            </span>
          ) : null}
          <div className="flex gap-x-3 text-[11px]" style={{ color: S.sub }}>
            {record.durationMinutes != null ? <span>{fmtDuration(record.durationMinutes)}</span> : null}
            {record.napCount != null && record.napCount > 0 ? <span>小睡 {record.napCount} 次</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>小睡 {record.napMinutes}分钟</span> : null}
            {totalMin > 0 && record.napMinutes != null && record.napMinutes > 0 ? <span>总计 {(totalMin / 60).toFixed(1)}h</span> : null}
          </div>
        </div>
      )}

      {napNotes ? <p className="text-[11px] mt-1.5" style={{ color: S.sub }}>小睡: {napNotes}</p> : null}
      {freeNotes ? <p className="text-[11px] mt-1" style={{ color: S.sub }}>{freeNotes}</p> : null}
    </div>
  );
}
