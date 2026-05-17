import { useState } from 'react';
import '@nimiplatform/nimi-kit/ui';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertFitnessAssessment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { LinkedHealthRecordReminder } from './health-capture-orchestrator.js';
import {
  CancelButton,
  DateField,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  InfoBanner,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  SectionCard,
  Select,
} from './health-record-modal-shell.js';

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
  linkedReminder?: LinkedHealthRecordReminder | null;
};

export function FitnessAssessmentFormContent({ child, ageMonths, onSaved, onClose, linkedReminder }: FitnessFormContentProps) {
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
        linkedReminderStateId: linkedReminder?.stateId ?? null,
        linkedReminderRuleId: linkedReminder?.ruleId ?? null,
      });
      await onSaved();
      onClose();
    } catch {
      /* bridge unavailable */
    } finally {
      setSaving(false);
    }
  };

  const numericInput = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { step?: string; min?: string; placeholder?: string },
  ) => (
    <FormField key={label} label={label}>
      <Input
        type="number"
        step={opts?.step}
        min={opts?.min}
        placeholder={opts?.placeholder ?? '--'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );

  const speedFields = [
    fields.run10mShuttle && numericInput('10米折返跑 (秒)', formRun10mShuttle, setFormRun10mShuttle, { step: '0.1', min: '0' }),
    fields.run50m && numericInput('50米跑 (秒)', formRun50m, setFormRun50m, { step: '0.1', min: '0' }),
    fields.run800m && numericInput('800米跑 (秒)', formRun800m, setFormRun800m, { step: '1', min: '0' }),
    fields.run1000m && numericInput('1000米跑 (秒)', formRun1000m, setFormRun1000m, { step: '1', min: '0' }),
    fields.run50x8 && numericInput('50m×8往返跑 (秒)', formRun50x8, setFormRun50x8, { step: '0.1', min: '0' }),
  ].filter(Boolean);

  const strengthFields = [
    fields.standingLongJump && numericInput('立定跳远 (cm)', formStandingLongJump, setFormStandingLongJump, { step: '1', min: '0' }),
    fields.tennisBallThrow && numericInput('网球掷远 (米)', formTennisBallThrow, setFormTennisBallThrow, { step: '0.1', min: '0' }),
    fields.doubleFootJump && numericInput('双脚连续跳 (秒)', formDoubleFootJump, setFormDoubleFootJump, { step: '0.1', min: '0' }),
    fields.sitUps && numericInput('仰卧起坐 (次/分)', formSitUps, setFormSitUps, { step: '1', min: '0' }),
    fields.pullUps && numericInput('引体向上 (次)', formPullUps, setFormPullUps, { step: '1', min: '0' }),
  ].filter(Boolean);

  const flexFields = [
    fields.sitAndReach && numericInput('坐位体前屈 (cm)', formSitAndReach, setFormSitAndReach, { step: '0.1' }),
    fields.balanceBeam && numericInput('走平衡木 (秒)', formBalanceBeam, setFormBalanceBeam, { step: '0.1', min: '0' }),
    fields.ropeSkipping && numericInput('跳绳 (次/分)', formRopeSkipping, setFormRopeSkipping, { step: '1', min: '0' }),
    fields.vitalCapacity && numericInput('肺活量 (mL)', formVitalCapacity, setFormVitalCapacity, { step: '1', min: '0' }),
  ].filter(Boolean);

  return (
    <>
      <ModalHeader
        title="添加体能评估"
        icon="🏃"
        subtitle={AGE_TIER_LABELS[tier]}
        onClose={onClose}
      />
      <ModalContent>
        <div className="space-y-5">
          {tier === 'preschool' ? (
            <InfoBanner tone="accent">
              📋 依据《国民体质测定标准》幼儿部分（3-6岁），共 6 项测试
            </InfoBanner>
          ) : null}

          <FormGrid cols={2}>
            <FormField label="评估日期">
              <DateField value={formAssessedAt} onChange={setFormAssessedAt} />
            </FormField>
            <FormField label="来源">
              <Select
                value={formSource}
                onChange={setFormSource}
                options={SOURCE_OPTIONS.map((v) => ({ value: v, label: SOURCE_LABELS[v] ?? v }))}
              />
            </FormField>
          </FormGrid>

          {speedFields.length > 0 ? (
            <SectionCard
              icon="⚡"
              title={tier === 'preschool' ? '速度 & 灵敏' : '速度 & 耐力'}
            >
              <FormGrid cols={3}>{speedFields}</FormGrid>
            </SectionCard>
          ) : null}

          {strengthFields.length > 0 ? (
            <SectionCard
              icon="💪"
              title={tier === 'preschool' ? '力量 & 协调' : '力量'}
            >
              <FormGrid cols={3}>{strengthFields}</FormGrid>
            </SectionCard>
          ) : null}

          {flexFields.length > 0 ? (
            <SectionCard
              icon="🤸"
              title={tier === 'preschool' ? '柔韧 & 平衡' : '协调 & 心肺'}
            >
              <FormGrid cols={3}>{flexFields}</FormGrid>
            </SectionCard>
          ) : null}

          <FormField label="备注">
            <Input
              placeholder="记录一些观察..."
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
            />
          </FormField>
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}

export function FitnessAssessmentModal(props: FitnessFormContentProps) {
  return (
    <HealthRecordModalShell open size="L" onClose={props.onClose}>
      <FitnessAssessmentFormContent {...props} />
    </HealthRecordModalShell>
  );
}
