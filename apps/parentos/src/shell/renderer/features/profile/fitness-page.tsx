import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { insertFitnessAssessment, getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';

const SOURCE_OPTIONS = ['school-pe', 'sports-club', 'clinic', 'self'] as const;
const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

const FOOT_ARCH_LABELS: Record<string, string> = {
  normal: '正常',
  flat: '扁平足',
  'high-arch': '高弓足',
  monitoring: '观察中',
};

const GRADE_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  pass: '及格',
  fail: '不及格',
};

/* ── Age tier logic (国家学生体质健康标准 2014) ──────────── */

type AgeTier = 'preschool' | 'grade12' | 'grade34' | 'grade56' | 'grade7plus';

const AGE_TIER_LABELS: Record<AgeTier, string> = {
  preschool: '学龄前',
  grade12: '1-2年级',
  grade34: '3-4年级',
  grade56: '5-6年级',
  grade7plus: '初中及以上',
};

function ageTier(ageMonths: number): AgeTier {
  if (ageMonths < 72) return 'preschool';     // < 6岁
  if (ageMonths < 96) return 'grade12';        // 6-8岁
  if (ageMonths < 120) return 'grade34';       // 8-10岁
  if (ageMonths < 144) return 'grade56';       // 10-12岁
  return 'grade7plus';                          // 12岁+
}

interface FieldVisibility {
  run50m: boolean; run800m: boolean; run1000m: boolean; run50x8: boolean;
  sitAndReach: boolean; standingLongJump: boolean; sitUps: boolean; pullUps: boolean;
  ropeSkipping: boolean; vitalCapacity: boolean;
  run10mShuttle: boolean; tennisBallThrow: boolean; doubleFootJump: boolean; balanceBeam: boolean;
}

const NO_FIELDS: FieldVisibility = {
  run50m: false, run800m: false, run1000m: false, run50x8: false,
  sitAndReach: false, standingLongJump: false, sitUps: false, pullUps: false,
  ropeSkipping: false, vitalCapacity: false,
  run10mShuttle: false, tennisBallThrow: false, doubleFootJump: false, balanceBeam: false,
};

/** Which metric fields are visible for a given age tier + gender */
function visibleFields(tier: AgeTier, isFemale: boolean): FieldVisibility {
  const base = { ...NO_FIELDS, run50m: true, sitAndReach: true, ropeSkipping: true, vitalCapacity: true };
  switch (tier) {
    case 'preschool':
      return { ...NO_FIELDS, run10mShuttle: true, standingLongJump: true, tennisBallThrow: true, doubleFootJump: true, sitAndReach: true, balanceBeam: true };
    case 'grade12':
      return base;
    case 'grade34':
      return { ...base, sitUps: true };
    case 'grade56':
      return { ...base, sitUps: true, run50x8: true };
    case 'grade7plus':
      return {
        ...base,
        standingLongJump: true,
        sitUps: isFemale,
        pullUps: !isFemale,
        run800m: isFemale,
        run1000m: !isFemale,
      };
  }
}

function parseNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export default function FitnessPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [assessments, setAssessments] = useState<FitnessAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formAssessedAt, setFormAssessedAt] = useState(new Date().toISOString().slice(0, 10));
  const [formSource, setFormSource] = useState('school-pe');
  const [formRun50m, setFormRun50m] = useState('');
  const [formRun800m, setFormRun800m] = useState('');
  const [formRun1000m, setFormRun1000m] = useState('');
  const [formRun50x8, setFormRun50x8] = useState('');
  const [formSitAndReach, setFormSitAndReach] = useState('');
  const [formStandingLongJump, setFormStandingLongJump] = useState('');
  const [formSitUps, setFormSitUps] = useState('');
  const [formPullUps, setFormPullUps] = useState('');
  const [formRopeSkipping, setFormRopeSkipping] = useState('');
  const [formVitalCapacity, setFormVitalCapacity] = useState('');
  const [formRun10mShuttle, setFormRun10mShuttle] = useState('');
  const [formTennisBallThrow, setFormTennisBallThrow] = useState('');
  const [formDoubleFootJump, setFormDoubleFootJump] = useState('');
  const [formBalanceBeam, setFormBalanceBeam] = useState('');
  const [formFootArch, setFormFootArch] = useState('');
  const [formGrade, setFormGrade] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getFitnessAssessments(activeChildId).then(setAssessments).catch(catchLog('fitness', 'action:load-fitness-assessments-failed'));
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const isFemale = child.gender === 'female';
  const tier = ageTier(ageMonths);
  const fields = visibleFields(tier, isFemale);

  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.assessedAt).getTime() - new Date(a.assessedAt).getTime(),
  );

  const resetForm = () => {
    setFormAssessedAt(new Date().toISOString().slice(0, 10));
    setFormSource('school-pe');
    setFormRun50m('');
    setFormRun800m('');
    setFormRun1000m('');
    setFormRun50x8('');
    setFormSitAndReach('');
    setFormStandingLongJump('');
    setFormSitUps('');
    setFormPullUps('');
    setFormRopeSkipping('');
    setFormVitalCapacity('');
    setFormRun10mShuttle('');
    setFormTennisBallThrow('');
    setFormDoubleFootJump('');
    setFormBalanceBeam('');
    setFormFootArch('');
    setFormGrade('');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAssessedAt) return;
    const now = isoNow();
    try {
      await insertFitnessAssessment({
        assessmentId: ulid(),
        childId: child.childId,
        assessedAt: formAssessedAt,
        ageMonths: computeAgeMonthsAt(child.birthDate, formAssessedAt),
        assessmentSource: formSource || null,
        run50m: parseNum(formRun50m),
        run800m: parseNum(formRun800m),
        run1000m: parseNum(formRun1000m),
        run50x8: parseNum(formRun50x8),
        sitAndReach: parseNum(formSitAndReach),
        standingLongJump: parseNum(formStandingLongJump),
        sitUps: parseIntNum(formSitUps),
        pullUps: parseIntNum(formPullUps),
        ropeSkipping: parseIntNum(formRopeSkipping),
        vitalCapacity: parseIntNum(formVitalCapacity),
        run10mShuttle: parseNum(formRun10mShuttle),
        tennisBallThrow: parseNum(formTennisBallThrow),
        doubleFootJump: parseNum(formDoubleFootJump),
        balanceBeam: parseNum(formBalanceBeam),
        footArchStatus: formFootArch || null,
        overallGrade: formGrade || null,
        notes: formNotes || null,
        now,
      });
      const updated = await getFitnessAssessments(child.childId);
      setAssessments(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  /** Reusable styled input for the form */
  const formInput = (label: string, value: string, onChange: (v: string) => void, opts?: { type?: string; step?: string; min?: string; placeholder?: string; className?: string }) => (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium" style={{ color: S.sub }}>{label}</span>
      <input
        type={opts?.type ?? 'number'} step={opts?.step} min={opts?.min} placeholder={opts?.placeholder ?? '--'}
        value={value} onChange={(e) => onChange(e.target.value)}
        className={`${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50 ${opts?.className ?? ''}`}
        style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', color: S.text, background: '#fafaf8' }}
      />
    </label>
  );

  /** Section header inside form */
  const sectionHeader = (icon: string, title: string) => (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[16px]">{icon}</span>
      <span className="text-[14px] font-semibold" style={{ color: S.text }}>{title}</span>
    </div>
  );

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>体能评估</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加评估
          </button>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>
      <AISummaryCard domain="fitness" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
        dataContext={assessments.length > 0 ? `共 ${assessments.length} 次体能测评` : ''}
      />

      {/* Add Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <section className={`w-[440px] max-h-[85vh] overflow-y-auto ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">🏃</span>
              <h2 className="text-[16px] font-bold" style={{ color: S.text }}>添加体能评估</h2>
              <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: '#f4f4f2', color: S.sub }}>
                {AGE_TIER_LABELS[tier]}
              </span>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-2 space-y-4 flex-1">
          {tier === 'preschool' && (
            <div className={`${S.radiusSm} px-4 py-3 text-[14px]`} style={{ background: '#EEF6EE', color: '#3a7a3a' }}>
              📋 依据《国民体质测定标准》幼儿部分（3-6岁），共 6 项测试
            </div>
          )}

          {/* Meta: date + source */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium" style={{ color: S.sub }}>评估日期</span>
              <ProfileDatePicker value={formAssessedAt} onChange={setFormAssessedAt} style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', color: S.text, background: '#fafaf8' }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium" style={{ color: S.sub }}>来源</span>
              <AppSelect value={formSource} onChange={setFormSource}
                options={SOURCE_OPTIONS.map((v) => ({ value: v, label: SOURCE_LABELS[v] ?? v }))} />
            </label>
          </div>

          <div className="space-y-4">
            {/* Speed / Agility */}
            {(fields.run50m || fields.run800m || fields.run1000m || fields.run50x8 || fields.run10mShuttle) && (
              <div className={`${S.radiusSm} p-4`} style={{ background: '#f8f8f6' }}>
                {sectionHeader('⚡', tier === 'preschool' ? '速度 & 灵敏' : '速度 & 耐力')}
                <div className="grid grid-cols-2 gap-3">
                  {fields.run10mShuttle && formInput('10米折返跑 (秒)', formRun10mShuttle, setFormRun10mShuttle, { step: '0.1', min: '0' })}
                  {fields.run50m && formInput('50米跑 (秒)', formRun50m, setFormRun50m, { step: '0.1', min: '0' })}
                  {fields.run800m && formInput('800米跑 (秒)', formRun800m, setFormRun800m, { step: '1', min: '0' })}
                  {fields.run1000m && formInput('1000米跑 (秒)', formRun1000m, setFormRun1000m, { step: '1', min: '0' })}
                  {fields.run50x8 && formInput('50m×8往返跑 (秒)', formRun50x8, setFormRun50x8, { step: '0.1', min: '0' })}
                </div>
              </div>
            )}

            {/* Power & Coordination */}
            {(fields.standingLongJump || fields.tennisBallThrow || fields.doubleFootJump || fields.sitUps || fields.pullUps) && (
              <div className={`${S.radiusSm} p-4`} style={{ background: '#f8f8f6' }}>
                {sectionHeader('💪', tier === 'preschool' ? '力量 & 协调' : '力量')}
                <div className="grid grid-cols-2 gap-3">
                  {fields.standingLongJump && formInput('立定跳远 (cm)', formStandingLongJump, setFormStandingLongJump, { step: '1', min: '0' })}
                  {fields.tennisBallThrow && formInput('网球掷远 (米)', formTennisBallThrow, setFormTennisBallThrow, { step: '0.1', min: '0' })}
                  {fields.doubleFootJump && formInput('双脚连续跳 (秒)', formDoubleFootJump, setFormDoubleFootJump, { step: '0.1', min: '0' })}
                  {fields.sitUps && formInput('仰卧起坐 (次/分)', formSitUps, setFormSitUps, { step: '1', min: '0' })}
                  {fields.pullUps && formInput('引体向上 (次)', formPullUps, setFormPullUps, { step: '1', min: '0' })}
                </div>
              </div>
            )}

            {/* Flexibility & Balance */}
            {(fields.sitAndReach || fields.balanceBeam || fields.ropeSkipping || fields.vitalCapacity) && (
              <div className={`${S.radiusSm} p-4`} style={{ background: '#f8f8f6' }}>
                {sectionHeader('🤸', tier === 'preschool' ? '柔韧 & 平衡' : '协调 & 心肺')}
                <div className="grid grid-cols-2 gap-3">
                  {fields.sitAndReach && formInput('坐位体前屈 (cm)', formSitAndReach, setFormSitAndReach, { step: '0.1' })}
                  {fields.balanceBeam && formInput('走平衡木 (秒)', formBalanceBeam, setFormBalanceBeam, { step: '0.1', min: '0' })}
                  {fields.ropeSkipping && formInput('跳绳 (次/分)', formRopeSkipping, setFormRopeSkipping, { step: '1', min: '0' })}
                  {fields.vitalCapacity && formInput('肺活量 (mL)', formVitalCapacity, setFormVitalCapacity, { step: '1', min: '0' })}
                </div>
              </div>
            )}

          </div>

          {/* Notes */}
          <div>
            <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
            <input placeholder="记录一些观察..." value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
              className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', color: S.text, background: '#fafaf8' }} />
          </div>
          </div>
          <div className="px-6 pt-3 pb-5 mt-1">
            <div className="flex items-center justify-end gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={handleSubmit} className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`} style={{ background: S.accent }}>保存</button>
            </div>
          </div>
        </section>
        </div>
      )}

      {/* Assessment Cards */}
      <section>
        {sortedAssessments.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[24px]">🏃</span>
            <p className="text-[14px] mt-2 font-medium" style={{ color: S.text }}>还没有体能评估</p>
            <p className="text-[13px] mt-1" style={{ color: S.sub }}>记录体测成绩，追踪体能发展</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedAssessments.map((a) => {
              const speedMetrics = [
                { label: '10米折返跑', value: a.run10mShuttle, unit: 's' },
                { label: '50米跑', value: a.run50m, unit: 's' },
                { label: '800米跑', value: a.run800m, unit: 's' },
                { label: '1000米跑', value: a.run1000m, unit: 's' },
                { label: '50m×8', value: a.run50x8, unit: 's' },
              ].filter((m) => m.value != null);
              const strengthMetrics = [
                { label: '立定跳远', value: a.standingLongJump, unit: 'cm' },
                { label: '网球掷远', value: a.tennisBallThrow, unit: 'm' },
                { label: '双脚连续跳', value: a.doubleFootJump, unit: 's' },
                { label: '坐位体前屈', value: a.sitAndReach, unit: 'cm' },
                { label: '仰卧起坐', value: a.sitUps, unit: '次/分' },
                { label: '引体向上', value: a.pullUps, unit: '次' },
              ].filter((m) => m.value != null);
              const cardioMetrics = [
                { label: '走平衡木', value: a.balanceBeam, unit: 's' },
                { label: '跳绳', value: a.ropeSkipping, unit: '次/分' },
                { label: '肺活量', value: a.vitalCapacity, unit: 'mL' },
              ].filter((m) => m.value != null);

              const metricChip = (m: { label: string; value: number | null; unit: string }) => (
                <span key={m.label} className="inline-flex items-center gap-1 text-[14px] px-2 py-0.5 rounded-full" style={{ background: '#f4f4f2' }}>
                  <span style={{ color: S.sub }}>{m.label}</span>
                  <span className="font-medium" style={{ color: S.text }}>{m.value}{m.unit}</span>
                </span>
              );

              return (
                <div key={a.assessmentId} className={S.radius + ' p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold" style={{ color: S.text }}>{a.assessedAt.split('T')[0]}</span>
                      <span className="text-[13px] px-1.5 py-0.5 rounded" style={{ background: '#f4f4f2', color: S.sub }}>{AGE_TIER_LABELS[ageTier(a.ageMonths)]}</span>
                      {a.assessmentSource && (
                        <span className="text-[13px]" style={{ color: S.sub }}>{SOURCE_LABELS[a.assessmentSource] ?? a.assessmentSource}</span>
                      )}
                    </div>
                    {a.overallGrade && (
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${a.overallGrade === 'excellent' ? 'bg-green-100 text-green-700' : a.overallGrade === 'good' ? 'bg-blue-100 text-blue-700' : a.overallGrade === 'pass' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {GRADE_LABELS[a.overallGrade] ?? a.overallGrade}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {speedMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>速度</span>
                        {speedMetrics.map(metricChip)}
                      </div>
                    )}
                    {strengthMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>力量</span>
                        {strengthMetrics.map(metricChip)}
                      </div>
                    )}
                    {cardioMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>心肺</span>
                        {cardioMetrics.map(metricChip)}
                      </div>
                    )}
                    {a.footArchStatus && (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>足弓</span>
                        <span className="inline-flex items-center text-[14px] px-2 py-0.5 rounded-full font-medium" style={{ background: '#f4f4f2', color: S.text }}>
                          {FOOT_ARCH_LABELS[a.footArchStatus] ?? a.footArchStatus}
                        </span>
                      </div>
                    )}
                  </div>
                  {a.notes && <p className="text-[14px] mt-3 pt-2" style={{ color: S.sub, borderTop: `1px solid ${S.border}` }}>{a.notes}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
