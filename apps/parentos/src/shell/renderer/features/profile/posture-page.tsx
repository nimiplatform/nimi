import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement, getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { PostureGuide } from './posture-guide.js';

const SHOULDER_OPTIONS = [
  { value: '0', label: '对称' },
  { value: '1', label: '左高' },
  { value: '2', label: '右高' },
] as const;
const SHOULDER_LABELS: Record<string, string> = { '0': '对称', '1': '左肩偏高', '2': '右肩偏高' };

const SCAPULA_OPTIONS = [
  { value: 'symmetric', label: '正常对称' },
  { value: 'left-wing', label: '左侧突出（翼状）' },
  { value: 'right-wing', label: '右侧突出（翼状）' },
] as const;
const SCAPULA_LABELS: Record<string, string> = { symmetric: '正常对称', 'left-wing': '左侧突出', 'right-wing': '右侧突出' };

const ADAM_OPTIONS = [
  { value: 'normal', label: '两侧等高' },
  { value: 'mild', label: '轻微不对称' },
  { value: 'obvious', label: '明显隆起' },
] as const;

const SOURCE_OPTIONS = [
  { value: 'parent', label: '家长观察' },
  { value: 'checkup', label: '体检报告' },
  { value: 'doctor', label: '医生评估' },
] as const;

const PHOTO_SLOTS = [
  { key: 'back', label: '正后方站立' },
  { key: 'adam', label: '前屈试验' },
  { key: 'side', label: '侧面站立' },
] as const;

const FOOT_ARCH_OPTIONS = [
  { value: 'normal', label: '正常' },
  { value: 'flat', label: '扁平足' },
  { value: 'high-arch', label: '高弓足' },
  { value: 'monitoring', label: '观察中' },
] as const;
const FOOT_ARCH_LABELS: Record<string, string> = { normal: '正常', flat: '扁平足', 'high-arch': '高弓足', monitoring: '观察中' };
const FOOT_ARCH_COLORS: Record<string, string> = { normal: '#22c55e', flat: '#f59e0b', 'high-arch': '#f59e0b', monitoring: '#3b82f6' };

const SHOE_WEAR_OPTIONS = [
  { value: 'normal', label: '正常（外侧偏多）' },
  { value: 'inner', label: '内侧磨损严重' },
  { value: 'even', label: '均匀磨损' },
] as const;

/* ── New posture assessment options ─────────────────────── */

const HIP_OPTIONS = [
  { value: 'equal', label: '等高', normal: true },
  { value: 'left-high', label: '左侧高', normal: false },
  { value: 'right-high', label: '右侧高', normal: false },
] as const;

const LEG_OPTIONS = [
  { value: 'straight', label: '正常直腿', normal: true },
  { value: 'o-leg', label: 'O型腿', normal: false },
  { value: 'x-leg', label: 'X型腿', normal: false },
] as const;

const HEEL_OPTIONS = [
  { value: 'normal', label: '正常垂直', normal: true },
  { value: 'valgus', label: '足跟外翻', normal: false },
  { value: 'varus', label: '足跟内翻', normal: false },
] as const;

const NECK_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'mild-forward', label: '轻度头前倾', normal: false },
  { value: 'obvious-forward', label: '明显头前倾', normal: false },
] as const;

const PELVIS_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'anterior-tilt', label: '骨盆前倾', normal: false },
] as const;

const KNEE_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'hyperextension', label: '膝盖超伸', normal: false },
] as const;

type PostureTab = 'back' | 'side' | 'forward-bend';

const COBB_LEVELS = [
  { max: 10, label: '正常', color: '#22c55e' },
  { max: 25, label: '需定期监测', color: '#f59e0b' },
  { max: 40, label: '建议支具治疗', color: '#ef4444' },
  { max: Infinity, label: '建议手术评估', color: '#dc2626' },
];

function cobbLevel(angle: number) {
  return COBB_LEVELS.find((l) => angle <= l.max) ?? COBB_LEVELS[COBB_LEVELS.length - 1]!;
}

function fmtAge(months: number) {
  const y = Math.floor(months / 12); const m = months % 12;
  return y > 0 ? (m > 0 ? `${y}岁${m}个月` : `${y}岁`) : `${m}个月`;
}

export default function PosturePage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [fitnessAssessments, setFitnessAssessments] = useState<FitnessAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formSource, setFormSource] = useState('parent');
  const [formShoulder, setFormShoulder] = useState('');
  const [formScapula, setFormScapula] = useState('');
  const [formAdam, setFormAdam] = useState('');
  const [formCobb, setFormCobb] = useState('');
  const [formFootArch, setFormFootArch] = useState('');
  const [formShoeWear, setFormShoeWear] = useState('');
  const [formHip, setFormHip] = useState('');
  const [formLeg, setFormLeg] = useState('');
  const [formHeel, setFormHeel] = useState('');
  const [formNeck, setFormNeck] = useState('');
  const [formPelvis, setFormPelvis] = useState('');
  const [formKnee, setFormKnee] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotos, setFormPhotos] = useState<Record<string, string>>({});
  const [photoHover, setPhotoHover] = useState<string | null>(null);
  const [postureTab, setPostureTab] = useState<PostureTab>('back');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoSlotRef = useRef<string | null>(null);
  const isMedical = formSource === 'checkup' || formSource === 'doctor';

  const loadData = async (cid: string) => {
    const [ms, fa] = await Promise.all([getMeasurements(cid), getFitnessAssessments(cid)]);
    setMeasurements(ms.filter((m) => m.typeId === 'scoliosis-cobb-angle' || m.typeId === 'shoulder-symmetry'));
    setFitnessAssessments(fa);
  };

  useEffect(() => { if (activeChildId) loadData(activeChildId).catch(catchLog('posture', 'action:load-posture-data-failed')); }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const cobbRecords = measurements.filter((m) => m.typeId === 'scoliosis-cobb-angle').sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const shoulderRecords = measurements.filter((m) => m.typeId === 'shoulder-symmetry').sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const latestFootArch = [...fitnessAssessments].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt)).find((a) => a.footArchStatus);

  const resetForm = () => {
    setFormDate(new Date().toISOString().slice(0, 10)); setFormSource('parent');
    setFormShoulder(''); setFormScapula(''); setFormAdam('');
    setFormCobb(''); setFormFootArch(''); setFormShoeWear('');
    setFormHip(''); setFormLeg(''); setFormHeel('');
    setFormNeck(''); setFormPelvis(''); setFormKnee('');
    setFormNotes(''); setFormPhotos({});
    setPhotoHover(null); setPostureTab('back'); setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formDate) return;
    const now = isoNow();
    const am = computeAgeMonthsAt(child.birthDate, formDate);
    // Pack structured notes
    const parts: string[] = [];
    if (formSource) parts.push(`来源:${SOURCE_OPTIONS.find((o) => o.value === formSource)?.label ?? formSource}`);
    if (formScapula) parts.push(`肩胛骨:${SCAPULA_LABELS[formScapula] ?? formScapula}`);
    if (formHip) parts.push(`高低胯:${HIP_OPTIONS.find((o) => o.value === formHip)?.label ?? formHip}`);
    if (formLeg) parts.push(`腿型:${LEG_OPTIONS.find((o) => o.value === formLeg)?.label ?? formLeg}`);
    if (formHeel) parts.push(`足跟:${HEEL_OPTIONS.find((o) => o.value === formHeel)?.label ?? formHeel}`);
    if (formNeck) parts.push(`颈部:${NECK_OPTIONS.find((o) => o.value === formNeck)?.label ?? formNeck}`);
    if (formPelvis) parts.push(`骨盆:${PELVIS_OPTIONS.find((o) => o.value === formPelvis)?.label ?? formPelvis}`);
    if (formKnee) parts.push(`膝盖:${KNEE_OPTIONS.find((o) => o.value === formKnee)?.label ?? formKnee}`);
    if (formAdam) parts.push(`前屈试验:${ADAM_OPTIONS.find((o) => o.value === formAdam)?.label ?? formAdam}`);
    if (formFootArch) parts.push(`足弓:${FOOT_ARCH_LABELS[formFootArch] ?? formFootArch}`);
    if (formShoeWear) parts.push(`鞋底磨损:${SHOE_WEAR_OPTIONS.find((o) => o.value === formShoeWear)?.label ?? formShoeWear}`);
    const photoKeys = Object.keys(formPhotos);
    if (photoKeys.length > 0) parts.push(`照片:${photoKeys.map((k) => PHOTO_SLOTS.find((s) => s.key === k)?.label ?? k).join(',')}`);
    if (formNotes.trim()) parts.push(formNotes.trim());
    const noteStr = parts.length > 0 ? parts.join(' | ') : null;
    try {
      if (formCobb.trim()) {
        await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'scoliosis-cobb-angle', value: parseFloat(formCobb), measuredAt: formDate, ageMonths: am, percentile: null, source: 'manual', notes: noteStr, now });
      }
      if (formShoulder) {
        await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'shoulder-symmetry', value: parseFloat(formShoulder), measuredAt: formDate, ageMonths: am, percentile: null, source: 'manual', notes: noteStr, now });
      }
      // If neither cobb nor shoulder but we have adam/scapula notes, still save as a shoulder-symmetry entry
      if (!formCobb.trim() && !formShoulder && (formAdam || formScapula.trim())) {
        await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'shoulder-symmetry', value: -1, measuredAt: formDate, ageMonths: am, percentile: null, source: 'manual', notes: noteStr, now });
      }
      await loadData(child.childId);
      resetForm();
    } catch { /* bridge */ }
  };

  // Merge all records into a unified timeline by date
  const timeline = useMemo(() => {
    const byDate = new Map<string, { date: string; cobb?: number; shoulder?: string; cobbNotes?: string | null }>();
    for (const m of cobbRecords) {
      const d = m.measuredAt.split('T')[0]!;
      const existing = byDate.get(d) ?? { date: d };
      existing.cobb = m.value; existing.cobbNotes = m.notes;
      byDate.set(d, existing);
    }
    for (const m of shoulderRecords) {
      const d = m.measuredAt.split('T')[0]!;
      const existing = byDate.get(d) ?? { date: d };
      existing.shoulder = String(m.value);
      byDate.set(d, existing);
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [cobbRecords, shoulderRecords]);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <Link to="/profile" className="text-[13px] hover:underline mb-5 inline-block" style={{ color: S.sub }}>← 返回档案</Link>

      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>体态档案</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuide((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium ${S.radiusSm} transition-all`}
            style={showGuide ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            录入指引
          </button>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} hover:opacity-90`}
              style={{ background: S.accent }}>
              + 添加记录
            </button>
          )}
        </div>
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      <AISummaryCard domain="posture" childName={child.displayName} childId={child.childId}
        ageLabel={fmtAge(ageMonths)} gender={child.gender}
        dataContext={(() => {
          const lines: string[] = [];
          if (cobbRecords[0]) lines.push(`Cobb角: ${cobbRecords[0].value}° (${cobbRecords[0].measuredAt.split('T')[0]})`);
          if (latestFootArch?.footArchStatus) lines.push(`足弓: ${FOOT_ARCH_LABELS[latestFootArch.footArchStatus] ?? latestFootArch.footArchStatus}`);
          return lines.join('\n');
        })()} />

      {showGuide && <PostureGuide onClose={() => setShowGuide(false)} />}

      {/* Quick overview */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className={`${S.radiusSm} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[10px] font-medium" style={{ color: S.sub }}>🦴 Cobb 角</p>
          {cobbRecords[0] ? (() => {
            const level = cobbLevel(cobbRecords[0].value);
            return (<>
              <p className="text-[20px] font-bold mt-1" style={{ color: S.text }}>{cobbRecords[0].value}°</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ background: `${level.color}20`, color: level.color }}>{level.label}</span>
            </>);
          })() : <p className="text-[13px] mt-1" style={{ color: S.sub }}>未记录</p>}
        </div>

        <div className={`${S.radiusSm} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[10px] font-medium" style={{ color: S.sub }}>🧍 肩部</p>
          {shoulderRecords[0] ? (
            <p className="text-[16px] font-bold mt-1" style={{ color: S.text }}>{SHOULDER_LABELS[String(shoulderRecords[0].value)] ?? '未知'}</p>
          ) : <p className="text-[13px] mt-1" style={{ color: S.sub }}>未记录</p>}
        </div>

        <div className={`${S.radiusSm} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[10px] font-medium" style={{ color: S.sub }}>🦶 足弓</p>
          {latestFootArch?.footArchStatus ? (
            <p className="text-[16px] font-bold mt-1" style={{ color: FOOT_ARCH_COLORS[latestFootArch.footArchStatus] ?? S.text }}>
              {FOOT_ARCH_LABELS[latestFootArch.footArchStatus] ?? latestFootArch.footArchStatus}
            </p>
          ) : <p className="text-[13px] mt-1" style={{ color: S.sub }}>未记录</p>}
          <p className="text-[9px] mt-0.5" style={{ color: S.sub }}>来自体能测评</p>
        </div>
      </div>

      {/* Hidden photo input */}
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const slot = photoSlotRef.current;
          if (file && slot) setFormPhotos((p) => ({ ...p, [slot]: file.name }));
          e.target.value = '';
        }} />

      {/* Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <div className={`w-[580px] max-h-[85vh] overflow-y-auto rounded-2xl flex flex-col shadow-xl`} style={{ background: '#f4f5f0' }} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-2">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px]" style={{ background: '#EEF3F1' }}>🧍</span>
              <h2 className="text-[16px] font-bold" style={{ color: S.text }}>添加体态记录</h2>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-4 flex-1 space-y-4">

            {/* ━━ 基础信息 + 视角 Tab ━━ */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>基础信息</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>评估日期</p>
                  <ProfileDatePicker value={formDate} onChange={setFormDate}
                    style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text, borderRadius: 12 }} />
                </div>
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>数据来源</p>
                  <div className="flex gap-1.5">
                    {SOURCE_OPTIONS.map((opt) => (
                      <button key={opt.value} onClick={() => setFormSource(opt.value)}
                        className="flex-1 py-2.5 text-[11px] font-medium rounded-xl transition-all"
                        style={formSource === opt.value
                          ? { background: S.accent, color: '#fff' }
                          : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ━━ 视角联动 Tab ━━ */}
            {(() => {
              const tabs: Array<{ key: PostureTab; label: string; emoji: string; photoKey: string }> = [
                { key: 'back', label: '正背面观察', emoji: '🧍', photoKey: 'back' },
                { key: 'side', label: '侧面观察', emoji: '🧍‍♂️', photoKey: 'side' },
                { key: 'forward-bend', label: '前屈观察', emoji: '🙇', photoKey: 'adam' },
              ];

              const optionBtn = (
                opts: readonly { value: string; label: string; normal?: boolean }[],
                val: string,
                set: (v: string) => void,
              ) => (
                <div className="flex gap-1.5">
                  {opts.map((o) => {
                    const selected = val === o.value;
                    const isNormal = 'normal' in o ? o.normal : o.value === '0' || o.value === 'normal' || o.value === 'equal' || o.value === 'straight' || o.value === 'symmetric';
                    return (
                      <button key={o.value} onClick={() => set(val === o.value ? '' : o.value)}
                        className="flex-1 py-2 text-[11px] font-medium rounded-xl transition-all"
                        style={selected
                          ? { background: isNormal ? '#dcfce7' : '#fef3c7', color: isNormal ? '#166534' : '#92400e', border: `1px solid ${isNormal ? '#bbf7d0' : '#fde68a'}` }
                          : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              );

              const fieldLabel = (text: string) => <p className="text-[11px] font-medium mb-1.5" style={{ color: S.text }}>{text}</p>;

              return (
                <>
                  {/* Tab bar with photo upload areas */}
                  <div className="rounded-xl overflow-hidden" style={{ background: '#fff' }}>
                    <div className="grid grid-cols-3 gap-0">
                      {tabs.map((tab) => {
                        const active = postureTab === tab.key;
                        const hasPhoto = formPhotos[tab.photoKey];
                        return (
                          <button key={tab.key} onClick={() => setPostureTab(tab.key)}
                            className="relative flex flex-col items-center gap-1.5 py-4 transition-all"
                            style={{
                              background: active ? '#f4f7ea' : '#fafaf8',
                              borderBottom: active ? `2px solid ${S.accent}` : '2px solid transparent',
                            }}>
                            <span className="text-[20px]">{tab.emoji}</span>
                            <span className="text-[11px] font-medium" style={{ color: active ? S.accent : S.sub }}>{tab.label}</span>
                            {/* Photo upload indicator */}
                            <button onClick={(e) => { e.stopPropagation(); photoSlotRef.current = tab.photoKey; photoInputRef.current?.click(); }}
                              className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-colors hover:bg-black/5"
                              style={{ background: hasPhoto ? '#dcfce7' : '#f0f0ec', color: hasPhoto ? '#166534' : S.sub }}
                              title={hasPhoto ? '已上传' : '上传照片'}>
                              {hasPhoto ? '✓' : '📷'}
                            </button>
                          </button>
                        );
                      })}
                    </div>

                    {/* Tab content — fields change per tab */}
                    <div className="p-4 space-y-4">
                      {postureTab === 'back' && (
                        <>
                          <div>{fieldLabel('高低肩')}{optionBtn(SHOULDER_OPTIONS.map((o) => ({ ...o, normal: o.value === '0' })), formShoulder, setFormShoulder)}</div>
                          <div>{fieldLabel('肩胛骨')}{optionBtn(SCAPULA_OPTIONS.map((o) => ({ ...o, normal: o.value === 'symmetric' })), formScapula, setFormScapula)}</div>
                          <div>{fieldLabel('高低胯')}{optionBtn(HIP_OPTIONS, formHip, setFormHip)}</div>
                          <div>{fieldLabel('腿型')}{optionBtn(LEG_OPTIONS, formLeg, setFormLeg)}</div>
                          <div>{fieldLabel('足跟内外翻')}{optionBtn(HEEL_OPTIONS, formHeel, setFormHeel)}</div>
                        </>
                      )}
                      {postureTab === 'side' && (
                        <>
                          <div>{fieldLabel('颈部与头部')}{optionBtn(NECK_OPTIONS, formNeck, setFormNeck)}</div>
                          <div>{fieldLabel('骨盆')}{optionBtn(PELVIS_OPTIONS, formPelvis, setFormPelvis)}</div>
                          <div>{fieldLabel('膝盖')}{optionBtn(KNEE_OPTIONS, formKnee, setFormKnee)}</div>
                        </>
                      )}
                      {postureTab === 'forward-bend' && (
                        <>
                          <div>
                            {fieldLabel('前屈试验')}
                            {optionBtn(ADAM_OPTIONS.map((o) => ({ ...o, normal: o.value === 'normal' })), formAdam, setFormAdam)}
                            {formAdam === 'obvious' && (
                              <div className="rounded-xl px-3 py-2.5 mt-2" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                                <p className="text-[11px] font-medium" style={{ color: '#dc2626' }}>⚠️ 建议尽快去骨科或脊柱外科做正式评估</p>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ━━ 医疗数据（Cobb 角）━━ */}
                  <div className={`rounded-xl p-4 space-y-3 transition-opacity ${isMedical ? 'opacity-100' : 'opacity-50'}`} style={{ background: '#fff' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] font-semibold" style={{ color: S.text }}>医疗数据</p>
                      {!isMedical && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#f5f3ef', color: S.sub }}>选择"体检报告"或"医生评估"后激活</span>}
                    </div>
                    <div>
                      <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>Cobb 角（°）</p>
                      <div className="flex items-center gap-3">
                        <input type="number" step="1" min="0" max="90" value={formCobb}
                          onChange={(e) => setFormCobb(e.target.value)} placeholder="来自 X 光报告"
                          disabled={!isMedical}
                          className="flex-1 rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 disabled:cursor-not-allowed"
                          style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: isMedical ? '#fafaf8' : '#f5f3ef', color: S.text }} />
                        <span className="text-[13px] shrink-0" style={{ color: S.sub }}>°</span>
                        {formCobb && parseFloat(formCobb) > 0 && (() => {
                          const level = cobbLevel(parseFloat(formCobb));
                          return <span className="text-[11px] px-2.5 py-1 rounded-full shrink-0 font-medium" style={{ background: `${level.color}15`, color: level.color }}>{level.label}</span>;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* ━━ 备注 ━━ */}
                  <div className="rounded-xl p-4" style={{ background: '#fff' }}>
                    <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>补充备注</p>
                    <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="其他观察到的情况..."
                      rows={2}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 resize-none"
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
                  </div>
                </>
              );
            })()}

          </div>

          {/* Footer */}
          <div className="px-6 pt-3 pb-5">
            <div className="flex items-center justify-end gap-2.5">
              <button onClick={resetForm} className="px-5 py-2.5 text-[13px] rounded-xl transition-colors hover:bg-[#e8e8e4]" style={{ background: '#e8e8e4', color: S.sub }}>取消</button>
              <button onClick={() => void handleSubmit()} className="px-6 py-2.5 text-[13px] font-medium text-white rounded-xl transition-colors hover:brightness-110" style={{ background: S.accent }}>保存记录</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Timeline */}
      <h2 className="text-[13px] font-semibold mb-3 mt-2" style={{ color: S.text }}>
        {timeline.length > 0 ? `评估记录（${timeline.length} 次）` : ''}
      </h2>
      {timeline.length === 0 && !showForm && (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[28px]">🧍</span>
          <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有体态评估记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>记录脊柱侧弯角度和肩部对称性</p>
        </div>
      )}
      <div className="space-y-3">
        {timeline.map((rec) => (
          <div key={rec.date} className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: S.sub }}>{rec.date}</p>
            <div className="flex flex-wrap gap-3">
              {rec.cobb != null && (() => {
                const level = cobbLevel(rec.cobb);
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: S.sub }}>Cobb 角</span>
                    <span className="text-[14px] font-bold" style={{ color: S.text }}>{rec.cobb}°</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: `${level.color}20`, color: level.color }}>{level.label}</span>
                  </div>
                );
              })()}
              {rec.shoulder && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: S.sub }}>肩部</span>
                  <span className="text-[13px] font-medium" style={{ color: S.text }}>{SHOULDER_LABELS[rec.shoulder] ?? '未知'}</span>
                </div>
              )}
            </div>
            {rec.cobbNotes && <p className="text-[11px] mt-2" style={{ color: S.sub }}>{rec.cobbNotes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
