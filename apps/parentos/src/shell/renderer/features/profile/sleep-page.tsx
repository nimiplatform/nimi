import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { upsertSleepRecord, deleteSleepRecord, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { SleepRecordForm } from './sleep-record-form.js';
import { SleepRecordCard } from './sleep-record-card.js';
import {
  calcDuration,
  clampDateToToday,
  fmtDuration,
  formatDateValue,
  packNotes,
  parseDateValue,
  referenceSleepRange,
  sleepAgeTier,
  sortSleepRecordsDesc,
  unpackNotes,
  TIER_DEFAULTS,
  TIER_LABELS,
} from './sleep-page-shared.js';
import { SleepTrendChart } from './sleep-trend-chart.js';

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Main Page
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

export default function SleepPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<SleepRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const tier = sleepAgeTier(ageMonths);
  const showNightWakings = tier === 'infant' || tier === 'toddler';
  const defaults = TIER_DEFAULTS[tier];

  // Form state
  const [formSleepDate, setFormSleepDate] = useState(new Date().toISOString().slice(0, 10));
  const [formBedtime, setFormBedtime] = useState(defaults.bed);
  const [formWakeTime, setFormWakeTime] = useState(defaults.wake);
  const [formQuality, setFormQuality] = useState('good');
  const [formNotes, setFormNotes] = useState('');
  const [formNightWakings, setFormNightWakings] = useState('');
  // Dynamic nap rows: each has start/end time
  const [napRows, setNapRows] = useState<Array<{ start: string; end: string }>>([]);
  const [napAddHover, setNapAddHover] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (activeChildId) getSleepRecords(activeChildId).then(setRecords).catch(catchLog('sleep', 'action:load-sleep-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const sortedRecords = sortSleepRecordsDesc(records);
  const [refLo, refHi] = referenceSleepRange(ageMonths);

  // Nap helpers
  const addNapRow = () => setNapRows((prev) => [...prev, { start: '13:00', end: '14:30' }]);
  const removeNapRow = (i: number) => setNapRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateNapRow = (i: number, field: 'start' | 'end', val: string) =>
    setNapRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const napDurations = napRows.map((r) => calcDuration(r.start, r.end) ?? 0);
  const totalNapMinutes = napDurations.reduce((s, d) => s + d, 0);
  const napCount = napRows.length;

  const resetForm = () => {
    setFormSleepDate(new Date().toISOString().slice(0, 10));
    setFormBedtime(defaults.bed);
    setFormWakeTime(defaults.wake);
    setFormQuality('good');
    setFormNotes('');
    setFormNightWakings('');
    setNapRows([]);
    setShowForm(false);
    setEditingRecordId(null);
    setSaveError(null);
  };

  const autoDuration = calcDuration(formBedtime, formWakeTime);

  const handleSubmit = async () => {
    if (!formSleepDate) return;
    setSaveError(null);
    const safeSleepDate = formatDateValue(clampDateToToday(parseDateValue(formSleepDate)));
    const now = isoNow();
    // Pack nap details into notes
    const napNotes = napRows.length > 0
      ? napRows.map((r, i) => `${r.start}-${r.end}(${fmtDuration(napDurations[i]!)})`).join(', ')
      : '';
    const notes = packNotes(formNightWakings, napNotes, formNotes);
    try {
      await upsertSleepRecord({
        recordId: ulid(),
        childId: child.childId,
        sleepDate: safeSleepDate,
        bedtime: formBedtime || null,
        wakeTime: formWakeTime || null,
        durationMinutes: autoDuration,
        napCount: napCount > 0 ? napCount : null,
        napMinutes: totalNapMinutes > 0 ? totalNapMinutes : null,
        quality: formQuality || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formSleepDate),
        notes,
        now,
      });
      const updated = await getSleepRecords(child.childId);
      setRecords(updated);
      resetForm();
    } catch (err) {
      catchLog('sleep', 'action:upsert-sleep-record-failed')(err);
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : '未知错误';
      setSaveError(`保存失败: ${msg}`);
    }
  };

  const startEdit = (record: SleepRecordRow) => {
    const { nightWakings, freeNotes } = unpackNotes(record.notes);
    setEditingRecordId(record.recordId);
    setFormSleepDate(record.sleepDate.split('T')[0]!);
    setFormBedtime(record.bedtime ?? defaults.bed);
    setFormWakeTime(record.wakeTime ?? defaults.wake);
    setFormQuality(record.quality ?? 'good');
    setFormNightWakings(nightWakings != null && nightWakings > 0 ? String(nightWakings) : '');
    setFormNotes(freeNotes);
    // Nap rows can't be fully reconstructed from packed notes, reset them
    setNapRows([]);
    setSaveError(null);
    setShowForm(true);
  };

  const handleDelete = async (recordId: string) => {
    try {
      await deleteSleepRecord(recordId);
      const updated = await getSleepRecords(child.childId);
      setRecords(updated);
    } catch (err) {
      catchLog('sleep', 'action:delete-sleep-record-failed')(err);
    }
    setDeletingRecordId(null);
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>睡眠记录</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加记录
          </button>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>
      <AISummaryCard domain="sleep" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={records.length > 0 ? `近期 ${records.length} 条睡眠记录，最近一次: ${records[0]?.sleepDate ?? ''}` : ''}
      />
      <p className="text-sm mb-4" style={{ color: S.sub }}>
        参考睡眠时长: {refLo}-{refHi} 小时/天（{formatAge(ageMonths)} · {TIER_LABELS[tier]}）</p>

      {showForm ? (
        <SleepRecordForm
          tier={tier}
          isEditing={editingRecordId !== null}
          showNightWakings={showNightWakings}
          formSleepDate={formSleepDate}
          setFormSleepDate={setFormSleepDate}
          formBedtime={formBedtime}
          setFormBedtime={setFormBedtime}
          formWakeTime={formWakeTime}
          setFormWakeTime={setFormWakeTime}
          autoDuration={autoDuration}
          formNightWakings={formNightWakings}
          setFormNightWakings={setFormNightWakings}
          napRows={napRows}
          napDurations={napDurations}
          totalNapMinutes={totalNapMinutes}
          formQuality={formQuality}
          setFormQuality={setFormQuality}
          formNotes={formNotes}
          setFormNotes={setFormNotes}
          napAddHover={napAddHover}
          setNapAddHover={setNapAddHover}
          addNapRow={addNapRow}
          removeNapRow={removeNapRow}
          updateNapRow={updateNapRow}
          saveError={saveError}
          onClose={resetForm}
          onSave={() => void handleSubmit()}
        />
      ) : null}

      {/* 鈹€鈹€ Trend Chart 鈹€鈹€ */}
      {records.length >= 2 && <SleepTrendChart records={records} ageMonths={ageMonths} />}

      {/* 鈹€鈹€ Records List 鈹€鈹€ */}
      <section>
        {sortedRecords.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[28px]">😴</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有睡眠记录</p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>点击上方按钮添加第一条记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map((record) => (
              <SleepRecordCard key={record.recordId} record={record} onEdit={startEdit} onDelete={setDeletingRecordId} />
            ))}
          </div>
        )}
      </section>

      {/* Delete confirmation dialog */}
      {deletingRecordId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => setDeletingRecordId(null)}>
          <div className={`${S.radius} p-6 w-[340px] shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
            <p className="text-[14px] font-semibold mb-2" style={{ color: S.text }}>确认删除</p>
            <p className="text-[12px] mb-5" style={{ color: S.sub }}>删除后无法恢复，确定要删除这条睡眠记录吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingRecordId(null)} className={`px-4 py-2 text-[13px] ${S.radiusSm}`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleDelete(deletingRecordId)} className={`px-4 py-2 text-[13px] font-medium text-white ${S.radiusSm}`} style={{ background: '#dc2626' }}>确认删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
