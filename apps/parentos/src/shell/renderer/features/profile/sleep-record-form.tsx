import { useState } from 'react';
import { Clock, Moon, Plus, Sun, X } from 'lucide-react';
import { computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { upsertSleepRecord } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { TimePickerInput } from './sleep-page-pickers.js';
import {
  calcDuration,
  clampDateToToday,
  fmtDuration,
  formatDateValue,
  packNotes,
  parseDateValue,
  QUALITY_LABELS,
  QUALITY_OPTIONS,
  sleepAgeTier,
  TIER_DEFAULTS,
  unpackNotes,
} from './sleep-page-shared.js';
import { Button, TextField } from '@nimiplatform/nimi-kit/ui';
import { AppSelect } from '../../app-shell/app-select.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  FormField,
  FormGrid,
  HEALTH_MODAL_TOKENS,
  HealthRecordModalShell,
  InlineError,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

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
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const napLabel = tier === 'infant' || tier === 'toddler' ? '日间小睡' : '午睡';

  return (
    <>
      <ModalHeader
        title={isEditing ? '编辑睡眠记录' : '新增睡眠记录'}
        icon={<Moon size={18} strokeWidth={1.5} style={{ color: 'var(--nimi-action-primary-bg)' }} />}
        onClose={onClose}
      />
      <ModalContent>
        <div className="space-y-5">
          <FormGrid cols={3}>
            <FormField label="日期">
              <ProfileDatePicker value={formSleepDate} onChange={setFormSleepDate} className="h-12" />
            </FormField>
            <FormField label="入睡时间">
              <TimePickerInput value={formBedtime} onChange={setFormBedtime} icon={Moon} />
            </FormField>
            <FormField label="起床时间">
              <TimePickerInput value={formWakeTime} onChange={setFormWakeTime} icon={Sun} />
            </FormField>
          </FormGrid>

          {autoDuration !== null ? (
            <p className="-mt-2 text-[13px] font-medium" style={{ color: 'var(--nimi-action-primary-bg)' }}>
              夜间 {fmtDuration(autoDuration)}
            </p>
          ) : null}

          {showNightWakings ? (
            <FormField label="夜醒次数">
              <div className="w-32">
                <TextField
                  type="number"
                  min="0"
                  max="20"
                  placeholder="0"
                  value={formNightWakings}
                  onChange={(event) => setFormNightWakings(event.target.value)}
                  className="w-full min-h-12"
                  inputClassName={NUMBER_INPUT_CLASS}
                />
              </div>
            </FormField>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium" style={{ color: 'var(--nimi-text-primary)' }}>
                {napLabel}
              </span>
              {napCount > 0 ? (
                <span className="text-[13px] font-medium" style={{ color: 'var(--nimi-action-primary-bg)' }}>
                  {napCount} 次 · {fmtDuration(totalNapMinutes)}
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {napRows.map((row, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 px-3 py-2"
                  style={{
                    borderRadius: HEALTH_MODAL_TOKENS.fieldRadius,
                    background: 'var(--nimi-field-bg)',
                    border: `1px solid ${'var(--nimi-field-border)'}`,
                  }}
                >
                  <div className="flex-1">
                    <TimePickerInput value={row.start} onChange={(value) => updateNapRow(index, 'start', value)} icon={Clock} size="small" />
                  </div>
                  <span className="shrink-0 text-[13px]" style={{ color: 'var(--nimi-text-muted)' }}>
                    至
                  </span>
                  <div className="flex-1">
                    <TimePickerInput value={row.end} onChange={(value) => updateNapRow(index, 'end', value)} icon={Clock} size="small" />
                  </div>
                  {(napDurations[index] ?? 0) > 0 ? (
                    <span
                      className="w-10 shrink-0 text-right text-[13px] font-medium"
                      style={{ color: 'var(--nimi-action-primary-bg)' }}
                    >
                      {fmtDuration(napDurations[index] ?? 0)}
                    </span>
                  ) : null}
                  <button
                    onClick={() => removeNapRow(index)}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-red-50"
                    style={{ color: 'var(--nimi-text-muted)' }}
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={addNapRow}
              onMouseEnter={() => setNapAddHover(true)}
              onMouseLeave={() => setNapAddHover(false)}
              className="mt-2 flex w-full cursor-pointer flex-col items-center justify-center gap-1 py-3"
              style={{
                borderRadius: HEALTH_MODAL_TOKENS.fieldRadius,
                border: `2px dashed ${napAddHover ? 'var(--nimi-action-primary-bg)' : '#d0d0cc'}`,
                background: 'var(--nimi-field-bg)',
                transition: 'border-color 0.25s ease',
              }}
            >
              <Plus
                size={18}
                strokeWidth={1.5}
                style={{
                  color: napAddHover ? 'var(--nimi-text-primary)' : '#b0b0aa',
                  transform: napAddHover ? 'scale(1.15)' : 'scale(1)',
                  transition: 'color 0.25s ease, transform 0.25s ease',
                }}
              />
              <span
                className="text-[13px] font-medium"
                style={{ color: napAddHover ? 'var(--nimi-text-primary)' : '#a0a0a0', transition: 'color 0.25s ease' }}
              >
                添加{napLabel === '日间小睡' ? '小睡' : '午睡'}
              </span>
            </button>
          </div>

          <FormGrid cols={2}>
            <FormField label="睡眠质量">
              <AppSelect
                value={formQuality}
                onChange={setFormQuality}
                options={QUALITY_OPTIONS.map((value) => ({ value, label: QUALITY_LABELS[value] ?? value }))}
                className="min-h-12"
                contentClassName="z-[120]"
              />
            </FormField>
            <FormField label="备注">
              <TextField
                placeholder="补充今天的睡眠细节..."
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                className="w-full min-h-12"
              />
            </FormField>
          </FormGrid>

          {saveError ? <InlineError>{saveError}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void handleSave()} disabled={saving} tone="primary" size="md">
          {saving ? '保存中...' : '保存'}
        </Button>
      </ModalFooter>
    </>
  );
}

export function SleepRecordForm(props: SleepFormContentProps) {
  return (
    <HealthRecordModalShell open size="M" onClose={props.onClose}>
      <SleepFormContent {...props} />
    </HealthRecordModalShell>
  );
}
