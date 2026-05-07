import { useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertFitnessAssessment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { ProfileDatePicker } from './profile-date-picker.js';

const SOURCE_OPTIONS = ['school-pe', 'sports-club', 'clinic', 'self'] as const;
const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

type AgeTier = 'preschool' | 'grade12' | 'grade34' | 'grade56' | 'grade7plus';

const AGE_TIER_LABELS: Record<AgeTier, string> = {
  preschool: '学龄前',
  grade12: '1-2年级',
  grade34: '3-4年级',
  grade56: '5-6年级',
  grade7plus: '初中及以上',
};

export function ageTier(ageMonths: number): AgeTier {
  if (ageMonths < 72) return 'preschool';
  if (ageMonths < 96) return 'grade12';
  if (ageMonths < 120) return 'grade34';
  if (ageMonths < 144) return 'grade56';
  return 'grade7plus';
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

type FitnessFormChild = {
  childId: string;
  birthDate: string;
  gender: string;
};

type FitnessFormContentProps = {
  child: FitnessFormChild;
  ageMonths: number;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function FitnessAssessmentFormContent({ child, ageMonths, onSaved, onClose }: FitnessFormContentProps) {
  const tier = ageTier(ageMonths);
  const isFemale = child.gender === 'female';
  const fields = visibleFields(tier, isFemale);

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
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!formAssessedAt) return;
    setSaving(true);
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
        footArchStatus: null,
        notes: formNotes || null,
        now,
      });
      await onSaved();
      onClose();
    } catch {
      /* bridge unavailable */
    } finally {
      setSaving(false);
    }
  };

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

  const sectionHeader = (icon: string, title: string) => (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[16px]">{icon}</span>
      <span className="text-[14px] font-semibold" style={{ color: S.text }}>{title}</span>
    </div>
  );

  return (
    <div className="flex flex-col w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]">🏃</span>
          <h2 className="text-[16px] font-bold" style={{ color: S.text }}>添加体能评估</h2>
          <span className="text-[13px] px-2 py-0.5 rounded-full" style={{ background: '#f4f4f2', color: S.sub }}>
            {AGE_TIER_LABELS[tier]}
          </span>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        {tier === 'preschool' && (
          <div className={`${S.radiusSm} px-4 py-3 text-[14px]`} style={{ background: '#EEF6EE', color: '#3a7a3a' }}>
            📋 依据《国民体质测定标准》幼儿部分（3-6岁），共 6 项测试
          </div>
        )}

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

        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
          <input placeholder="记录一些观察..." value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
            className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`}
            style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', color: S.text, background: '#fafaf8' }} />
        </div>
      </div>

      <div className="px-6 pt-3 pb-5 mt-1">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          <button onClick={() => void handleSubmit()} disabled={saving} className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`} style={{ background: S.accent }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FitnessAssessmentModal(props: FitnessFormContentProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={props.onClose}>
      <section className={`w-[440px] ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        <FitnessAssessmentFormContent {...props} />
      </section>
    </div>
  );
}
