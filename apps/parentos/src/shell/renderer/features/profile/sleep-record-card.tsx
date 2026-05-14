import { Surface } from '@nimiplatform/nimi-kit/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { formatAge } from '../../app-shell/app-store.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import {
  fmtDuration,
  QUALITY_LABELS,
  sleepAgeTier,
  unpackNotes,
} from './sleep-page-shared.js';

export function SleepRecordCard({
  record,
  onEdit,
  onDelete,
}: {
  record: SleepRecordRow;
  onEdit: (record: SleepRecordRow) => void;
  onDelete: (recordId: string) => void;
}) {
  const tier = sleepAgeTier(record.ageMonths);
  const totalMin = (record.durationMinutes ?? 0) + (record.napMinutes ?? 0);
  const { nightWakings, napNotes, freeNotes } = unpackNotes(record.notes);
  const qualityClassName = record.quality ? qualityToneClassName(record.quality) : null;

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="group/card rounded-3xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">{record.sleepDate.split('T')[0]}</span>
          {record.quality && qualityClassName ? (
            <span className={`rounded-full px-1.5 py-0.5 text-[12px] font-medium ${qualityClassName}`}>
              {QUALITY_LABELS[record.quality] ?? record.quality}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
            <button onClick={() => onEdit(record)} className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--nimi-action-ghost-hover)]" title="编辑">
              <Pencil size={13} strokeWidth={1.5} className="text-[var(--nimi-text-muted)]" />
            </button>
            <button onClick={() => onDelete(record.recordId)} className="flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]" title="删除">
              <Trash2 size={13} strokeWidth={1.5} className="text-[var(--nimi-status-danger)]" />
            </button>
          </div>
          <span className="text-[12px] ml-1 text-[var(--nimi-text-muted)]">{formatAge(record.ageMonths)}</span>
        </div>
      </div>

      {tier === 'infant' || tier === 'toddler' ? (
        <div className="flex items-baseline gap-4">
          {totalMin > 0 ? (
            <div>
              <span className="text-[24px] font-bold text-[var(--nimi-text-primary)]">{(totalMin / 60).toFixed(1)}</span>
              <span className="text-[13px] ml-0.5 text-[var(--nimi-text-muted)]">小时</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-[var(--nimi-text-muted)]">
            {record.bedtime && record.wakeTime ? <span>{record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}</span> : null}
            {record.durationMinutes != null ? <span>夜间 {fmtDuration(record.durationMinutes)}</span> : null}
            {record.napCount != null ? <span>小睡 {record.napCount} 次</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>小睡 {record.napMinutes}分钟</span> : null}
            {nightWakings != null && nightWakings > 0 ? <span className="text-[var(--nimi-status-warning)]">夜醒 {nightWakings} 次</span> : null}
          </div>
        </div>
      ) : tier === 'preschool' ? (
        <div className="flex items-baseline gap-4">
          {record.durationMinutes != null ? (
            <div>
              <span className="text-[18px] font-bold text-[var(--nimi-text-primary)]">{fmtDuration(record.durationMinutes)}</span>
              <span className="text-[13px] ml-1 text-[var(--nimi-text-muted)]">夜间</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-3 text-[13px] text-[var(--nimi-text-muted)]">
            {record.bedtime && record.wakeTime ? <span>{record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>午睡 {record.napMinutes}分钟</span> : null}
            {totalMin > 0 ? <span>总计 {(totalMin / 60).toFixed(1)}h</span> : null}
          </div>
        </div>
      ) : (
        <div className="flex items-baseline gap-4">
          {record.bedtime && record.wakeTime ? (
            <span className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
              {record.bedtime.slice(0, 5)} - {record.wakeTime.slice(0, 5)}
            </span>
          ) : null}
          <div className="flex gap-x-3 text-[13px] text-[var(--nimi-text-muted)]">
            {record.durationMinutes != null ? <span>{fmtDuration(record.durationMinutes)}</span> : null}
            {record.napCount != null && record.napCount > 0 ? <span>小睡 {record.napCount} 次</span> : null}
            {record.napMinutes != null && record.napMinutes > 0 ? <span>小睡 {record.napMinutes}分钟</span> : null}
            {totalMin > 0 && record.napMinutes != null && record.napMinutes > 0 ? <span>总计 {(totalMin / 60).toFixed(1)}h</span> : null}
          </div>
        </div>
      )}

      {napNotes ? <p className="text-[13px] mt-1.5 text-[var(--nimi-text-muted)]">小睡: {napNotes}</p> : null}
      {freeNotes ? <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">{freeNotes}</p> : null}
    </Surface>
  );
}

function qualityToneClassName(quality: string): string | null {
  if (quality === 'good') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]';
  if (quality === 'fair') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]';
  if (quality === 'poor') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]';
  return null;
}
