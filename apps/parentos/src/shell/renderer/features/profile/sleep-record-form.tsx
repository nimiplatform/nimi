import { useState } from 'react';
import { Clock, Moon, Plus, Sun, X } from 'lucide-react';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { upsertSleepRecord } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { DatePickerInput, TimePickerInput } from './sleep-page-pickers.js';
import {
  calcDuration,
  clampDateToToday,
  fmtDuration,
  formatDateValue,
  inputCls,
  inputSty,
  packNotes,
  parseDateValue,
  QUALITY_LABELS,
  QUALITY_OPTIONS,
  sleepAgeTier,
  TIER_DEFAULTS,
  unpackNotes,
} from './sleep-page-shared.js';

type NapRow = { start: string; end: string };

type SleepFormContentProps = {
  child: { childId: string; birthDate: string };
  initialRecord?: SleepRecordRow | null;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function SleepFormContent({ child, initialRecord, onSaved, onClose }: SleepFormContentProps) {
  const ageMonths = computeAgeMonths(child.birthDate);
  const tier = sleepAgeTier(ageMonths);
  const showNightWakings = tier === 'infant' || tier === 'toddler';
  const defaults = TIER_DEFAULTS[tier];

  const initialNotes = unpackNotes(initialRecord?.notes ?? null);
  const [formSleepDate, setFormSleepDate] = useState(
    initialRecord?.sleepDate?.split('T')[0] ?? new Date().toISOString().slice(0, 10),
  );
  const [formBedtime, setFormBedtime] = useState(initialRecord?.bedtime ?? defaults.bed);
  const [formWakeTime, setFormWakeTime] = useState(initialRecord?.wakeTime ?? defaults.wake);
  const [formQuality, setFormQuality] = useState(initialRecord?.quality ?? 'good');
  const [formNotes, setFormNotes] = useState(initialNotes.freeNotes);
  const [formNightWakings, setFormNightWakings] = useState(
    initialNotes.nightWakings != null && initialNotes.nightWakings > 0 ? String(initialNotes.nightWakings) : '',
  );
  const [napRows, setNapRows] = useState<NapRow[]>([]);
  const [napAddHover, setNapAddHover] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isEditing = initialRecord != null;
  const napDurations = napRows.map((row) => calcDuration(row.start, row.end) ?? 0);
  const totalNapMinutes = napDurations.reduce((sum, value) => sum + value, 0);
  const napCount = napRows.length;
  const autoDuration = calcDuration(formBedtime, formWakeTime);

  const addNapRow = () => setNapRows((prev) => [...prev, { start: '13:00', end: '14:30' }]);
  const removeNapRow = (index: number) => setNapRows((prev) => prev.filter((_, i) => i !== index));
  const updateNapRow = (index: number, field: 'start' | 'end', value: string) =>
    setNapRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const handleSave = async () => {
    if (!formSleepDate) return;
    setSaveError(null);
    const safeSleepDate = formatDateValue(clampDateToToday(parseDateValue(formSleepDate)));
    const now = isoNow();
    const napNotes = napRows.length > 0
      ? napRows.map((row, i) => `${row.start}-${row.end}(${fmtDuration(napDurations[i] ?? 0)})`).join(', ')
      : '';
    const notes = packNotes(formNightWakings, napNotes, formNotes);
    try {
      await upsertSleepRecord({
        recordId: initialRecord?.recordId ?? ulid(),
        childId: child.childId,
        sleepDate: safeSleepDate,
        bedtime: formBedtime || null,
        wakeTime: formWakeTime || null,
        durationMinutes: autoDuration,
        napCount: napCount > 0 ? napCount : null,
        napMinutes: totalNapMinutes > 0 ? totalNapMinutes : null,
        quality: formQuality || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, safeSleepDate),
        notes,
        now,
      });
      await onSaved();
      onClose();
    } catch (err) {
      catchLog('sleep', 'action:upsert-sleep-record-failed')(err);
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : '未知错误';
      setSaveError(`保存失败: ${msg}`);
    }
  };

  return (
    <div className="flex flex-col w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#f1f5f9' }}>
            <Moon size={18} strokeWidth={1.5} style={{ color: S.accent }} />
          </span>
          <h2 className="text-[16px] font-bold" style={{ color: S.text }}>{isEditing ? '编辑睡眠记录' : '新增睡眠记录'}</h2>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-[13px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
            日期
            <DatePickerInput value={formSleepDate} onChange={setFormSleepDate} />
          </label>
          <label className="text-[13px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
            入睡时间
            <TimePickerInput value={formBedtime} onChange={setFormBedtime} icon={Moon} />
          </label>
          <label className="text-[13px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
            起床时间
            <TimePickerInput value={formWakeTime} onChange={setFormWakeTime} icon={Sun} />
          </label>
        </div>

        {autoDuration !== null ? (
          <p className="text-[13px] -mt-2 font-medium" style={{ color: S.accent }}>
            夜间 {fmtDuration(autoDuration)}
          </p>
        ) : null}

        {showNightWakings ? (
          <label className="text-[13px] flex flex-col gap-1 font-medium" style={{ color: S.sub }}>
            夜醒次数
            <div className="group/field relative flex items-center w-32">
              <input type="number" min="0" max="20" placeholder="0" value={formNightWakings} onChange={(event) => setFormNightWakings(event.target.value)} className={inputCls()} style={inputSty} />
              <Moon size={16} strokeWidth={1.5} className="absolute right-2.5 pointer-events-none text-gray-400 transition-colors group-focus-within/field:text-[#1e293b]" />
            </div>
          </label>
        ) : null}

        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium" style={{ color: S.text }}>
              {tier === 'infant' || tier === 'toddler' ? '日间小睡' : '午睡'}
            </span>
            {napCount > 0 ? (
              <span className="text-[13px] font-medium" style={{ color: S.accent }}>
                {napCount} 次 · {fmtDuration(totalNapMinutes)}
              </span>
            ) : null}
          </div>

          <div className="space-y-2">
            {napRows.map((row, index) => (
              <div key={index} className={`flex items-center gap-2 ${S.radiusSm} px-3 py-2`} style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
                <div className="flex-1">
                  <TimePickerInput value={row.start} onChange={(value) => updateNapRow(index, 'start', value)} icon={Clock} size="small" />
                </div>
                <span className="text-[13px] shrink-0" style={{ color: S.sub }}>至</span>
                <div className="flex-1">
                  <TimePickerInput value={row.end} onChange={(value) => updateNapRow(index, 'end', value)} icon={Clock} size="small" />
                </div>
                {(napDurations[index] ?? 0) > 0 ? (
                  <span className="text-[13px] font-medium shrink-0 w-10 text-right" style={{ color: S.accent }}>
                    {fmtDuration(napDurations[index] ?? 0)}
                  </span>
                ) : null}
                <button onClick={() => removeNapRow(index)} className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors" style={{ color: S.sub }}>
                  <X size={14} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addNapRow}
            onMouseEnter={() => setNapAddHover(true)}
            onMouseLeave={() => setNapAddHover(false)}
            className={`flex flex-col items-center justify-center gap-1 w-full mt-2 py-3 ${S.radiusSm} cursor-pointer`}
            style={{
              border: `2px dashed ${napAddHover ? '#4ECCA3' : '#d0d0cc'}`,
              background: '#fafaf8',
              transition: 'border-color 0.25s ease',
            }}
          >
            <Plus size={18} strokeWidth={1.5} style={{ color: napAddHover ? '#1e293b' : '#b0b0aa', transform: napAddHover ? 'scale(1.15)' : 'scale(1)', transition: 'color 0.25s ease, transform 0.25s ease' }} />
            <span className="text-[13px] font-medium" style={{ color: napAddHover ? '#1e293b' : '#a0a0a0', transition: 'color 0.25s ease' }}>
              添加{tier === 'infant' || tier === 'toddler' ? '小睡' : '午睡'}
            </span>
          </button>
        </div>

        <div className="pt-1 space-y-3">
          <label className="text-[13px] flex flex-col gap-1 font-medium w-32" style={{ color: S.sub }}>
            睡眠质量
            <AppSelect
              value={formQuality}
              onChange={setFormQuality}
              options={QUALITY_OPTIONS.map((value) => ({ value, label: QUALITY_LABELS[value] ?? value }))}
            />
          </label>
          <div>
            <label className="text-[13px] mb-1 font-medium block" style={{ color: S.sub }}>备注</label>
            <input
              placeholder="补充今天的睡眠细节..."
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
              className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
              style={inputSty}
            />
          </div>
        </div>
      </div>

      <div className="px-6 pt-3 pb-5 mt-1">
        {saveError ? (
          <p className="text-[14px] mb-2 text-center font-medium" style={{ color: '#dc2626' }}>{saveError}</p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          <button onClick={() => void handleSave()} className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存</button>
        </div>
      </div>
    </div>
  );
}

export function SleepRecordForm(props: SleepFormContentProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={props.onClose}>
      <section className={`w-[480px] ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(event) => event.stopPropagation()}>
        <SleepFormContent {...props} />
      </section>
    </div>
  );
}
