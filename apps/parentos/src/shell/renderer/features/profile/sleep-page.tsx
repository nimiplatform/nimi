import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { upsertSleepRecord, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';

const QUALITY_OPTIONS = ['good', 'fair', 'poor'] as const;
const QUALITY_LABELS: Record<string, string> = { good: '好', fair: '一般', poor: '差' };

/** Age-appropriate total sleep duration reference (hours/day including naps) */
function referenceSleepHours(ageMonths: number): string {
  if (ageMonths < 4) return '14-17';
  if (ageMonths < 12) return '12-16';
  if (ageMonths < 24) return '11-14';
  if (ageMonths < 36) return '11-14';
  if (ageMonths < 72) return '10-13';
  if (ageMonths < 144) return '9-12';
  return '8-10';
}

/** Auto-calculate night sleep duration from bedtime and wake time */
function calcDuration(bedtime: string, wakeTime: string): number | null {
  if (!bedtime || !wakeTime) return null;
  const bParts = bedtime.split(':').map(Number);
  const wParts = wakeTime.split(':').map(Number);
  const bh = bParts[0] ?? 0, bm = bParts[1] ?? 0;
  const wh = wParts[0] ?? 0, wm = wParts[1] ?? 0;
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60; // crossed midnight
  return mins;
}

export default function SleepPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<SleepRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formSleepDate, setFormSleepDate] = useState(new Date().toISOString().slice(0, 10));
  const [formBedtime, setFormBedtime] = useState('21:00');
  const [formWakeTime, setFormWakeTime] = useState('07:00');
  const [formNapCount, setFormNapCount] = useState('');
  const [formNapMinutes, setFormNapMinutes] = useState('');
  const [formQuality, setFormQuality] = useState('good');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getSleepRecords(activeChildId).then(setRecords).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.sleepDate).getTime() - new Date(a.sleepDate).getTime(),
  );

  const resetForm = () => {
    setFormSleepDate(new Date().toISOString().slice(0, 10));
    setFormBedtime('21:00');
    setFormWakeTime('07:00');
    setFormNapCount('');
    setFormNapMinutes('');
    setFormQuality('good');
    setFormNotes('');
    setShowForm(false);
  };

  const autoDuration = calcDuration(formBedtime, formWakeTime);

  const handleSubmit = async () => {
    if (!formSleepDate) return;
    const now = isoNow();
    const napCount = formNapCount ? parseInt(formNapCount, 10) : null;
    const napMinutes = formNapMinutes ? parseInt(formNapMinutes, 10) : null;
    try {
      await upsertSleepRecord({
        recordId: ulid(),
        childId: child.childId,
        sleepDate: formSleepDate,
        bedtime: formBedtime || null,
        wakeTime: formWakeTime || null,
        durationMinutes: autoDuration,
        napCount: Number.isFinite(napCount) ? napCount : null,
        napMinutes: Number.isFinite(napMinutes) ? napMinutes : null,
        quality: formQuality || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formSleepDate),
        notes: formNotes || null,
        now,
      });
      const updated = await getSleepRecords(child.childId);
      setRecords(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold mb-6" style={{ color: S.text }}>睡眠记录</h1>
          <AISummaryCard domain="sleep" childName={child.displayName} childId={child.childId}
            ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
            dataContext={records.length > 0 ? `近期 ${records.length} 条睡眠记录，最近一次: ${records[0]?.sleepDate ?? ''}` : ''}
          />
          <p className="text-sm" style={{ color: S.sub }}>
            参考睡眠时长: {referenceSleepHours(ageMonths)} 小时/天（{formatAge(ageMonths)}）
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加记录
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <section className={S.radius + ' p-5 mb-8'} style={{ background: S.card, boxShadow: S.shadow }}>
          <h2 className="text-lg font-semibold mb-3" style={{ color: S.text }}>新增睡眠记录</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                日期
                <input type="date" value={formSleepDate} onChange={(e) => setFormSleepDate(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                入睡时间
                <input type="time" value={formBedtime} onChange={(e) => setFormBedtime(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                起床时间
                <input type="time" value={formWakeTime} onChange={(e) => setFormWakeTime(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }} />
              </label>
              {autoDuration !== null && (
                <span className="text-xs py-1.5" style={{ color: S.accent }}>
                  夜间 {Math.floor(autoDuration / 60)}h{autoDuration % 60 > 0 ? `${autoDuration % 60}m` : ''}
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                午睡次数
                <input type="number" min="0" max="10" placeholder="0" value={formNapCount} onChange={(e) => setFormNapCount(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm w-20'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                午睡时长(分钟)
                <input type="number" min="0" max="300" placeholder="0" value={formNapMinutes} onChange={(e) => setFormNapMinutes(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm w-28'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                质量
                <select value={formQuality} onChange={(e) => setFormQuality(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }}>
                  {QUALITY_OPTIONS.map((v) => (
                    <option key={v} value={v}>{QUALITY_LABELS[v]}</option>
                  ))}
                </select>
              </label>
            </div>
            <input placeholder="备注" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className={S.radiusSm + ' border px-2 py-1.5 text-sm w-full'} style={{ borderColor: S.border }} />
            <div className="flex gap-2">
              <button onClick={handleSubmit} className={S.radiusSm + ' text-xs px-3 py-1.5 text-white'} style={{ background: S.accent }}>保存</button>
              <button onClick={resetForm} className={S.radiusSm + ' text-xs px-3 py-1.5'} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            </div>
          </div>
        </section>
      )}

      {/* Records List */}
      <section>
        {sortedRecords.length === 0 ? (
          <p className="text-sm" style={{ color: S.sub }}>暂无睡眠记录</p>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map((r) => {
              const totalMin = (r.durationMinutes ?? 0) + (r.napMinutes ?? 0);
              return (
                <div key={r.recordId} className={S.radius + ' p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: S.text }}>{r.sleepDate.split('T')[0]}</span>
                        {r.quality && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${r.quality === 'good' ? 'bg-green-100 text-green-700' : r.quality === 'fair' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                            {QUALITY_LABELS[r.quality] ?? r.quality}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-1" style={{ color: S.sub }}>
                        {r.bedtime && r.wakeTime && `${r.bedtime.slice(0, 5)} - ${r.wakeTime.slice(0, 5)}`}
                        {r.durationMinutes != null && ` · 夜间 ${Math.floor(r.durationMinutes / 60)}h${r.durationMinutes % 60 > 0 ? `${r.durationMinutes % 60}m` : ''}`}
                        {r.napCount != null && ` · 午睡 ${r.napCount} 次`}
                        {r.napMinutes != null && ` ${r.napMinutes}分钟`}
                        {totalMin > 0 && ` · 总计 ${(totalMin / 60).toFixed(1)}h`}
                      </p>
                      {r.notes && <p className="text-xs mt-1" style={{ color: S.sub }}>{r.notes}</p>}
                    </div>
                    <span className="text-xs" style={{ color: S.sub }}>{formatAge(r.ageMonths)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
