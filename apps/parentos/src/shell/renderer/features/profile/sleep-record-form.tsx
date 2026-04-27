import { Clock, Moon, Plus, Sun, X } from 'lucide-react';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { DatePickerInput, TimePickerInput } from './sleep-page-pickers.js';
import {
  fmtDuration,
  inputCls,
  inputSty,
  QUALITY_LABELS,
  QUALITY_OPTIONS,
  type SleepAgeTier,
} from './sleep-page-shared.js';

type NapRow = { start: string; end: string };

type SleepRecordFormProps = {
  tier: SleepAgeTier;
  isEditing: boolean;
  showNightWakings: boolean;
  formSleepDate: string;
  setFormSleepDate: (value: string) => void;
  formBedtime: string;
  setFormBedtime: (value: string) => void;
  formWakeTime: string;
  setFormWakeTime: (value: string) => void;
  autoDuration: number | null;
  formNightWakings: string;
  setFormNightWakings: (value: string) => void;
  napRows: NapRow[];
  napDurations: number[];
  totalNapMinutes: number;
  formQuality: string;
  setFormQuality: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
  napAddHover: boolean;
  setNapAddHover: (value: boolean) => void;
  addNapRow: () => void;
  removeNapRow: (index: number) => void;
  updateNapRow: (index: number, field: 'start' | 'end', value: string) => void;
  saveError: string | null;
  onClose: () => void;
  onSave: () => void;
};

export function SleepRecordForm({
  tier,
  isEditing,
  showNightWakings,
  formSleepDate,
  setFormSleepDate,
  formBedtime,
  setFormBedtime,
  formWakeTime,
  setFormWakeTime,
  autoDuration,
  formNightWakings,
  setFormNightWakings,
  napRows,
  napDurations,
  totalNapMinutes,
  formQuality,
  setFormQuality,
  formNotes,
  setFormNotes,
  napAddHover,
  setNapAddHover,
  addNapRow,
  removeNapRow,
  updateNapRow,
  saveError,
  onClose,
  onSave,
}: SleepRecordFormProps) {
  const napCount = napRows.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <section className={`w-[480px] max-h-[85vh] overflow-y-auto ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(event) => event.stopPropagation()}>
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
            <button onClick={onSave} className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存</button>
          </div>
        </div>
      </section>
    </div>
  );
}
