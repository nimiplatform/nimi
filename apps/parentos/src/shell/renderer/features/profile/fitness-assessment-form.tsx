import { useState } from 'react';
import { Button, cn, DashedAddButton, DatePicker, PillTabs, TextField, TextareaField } from '@nimiplatform/kit/ui';
import { AppSelect } from '../../app-shell/app-select.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { deleteFitnessEvent, insertFitnessAssessment, saveHealthRecordCapture } from '../../bridge/sqlite-bridge.js';
import type { HealthRecordCaptureValueInput } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import type { LinkedHealthRecordReminder } from './health-capture-orchestrator.js';
import {
  ChipGroup,
  type ChipOption,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  InfoBanner,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const SOURCE_OPTIONS = ['school-pe', 'sports-club', 'clinic', 'self'] as const;
const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

/* ── Sport-activity categories ─────────────────────────────────────────────
 * The `id` is persisted as the `fitness.activity_category` valueText. Adding a
 * category here is the only change needed for a new sport — the data model and
 * spec carry no per-sport fields. */

export interface ActivityCategoryOption {
  id: string;
  label: string;
  emoji: string;
}

export const ACTIVITY_CATEGORIES: ActivityCategoryOption[] = [
  { id: 'running', label: '跑步', emoji: '🏃' },
  { id: 'swimming', label: '游泳', emoji: '🏊' },
  { id: 'cycling', label: '骑行', emoji: '🚴' },
  { id: 'skating', label: '轮滑', emoji: '🛼' },
  { id: 'basketball', label: '篮球', emoji: '🏀' },
  { id: 'soccer', label: '足球', emoji: '⚽' },
  { id: 'badminton', label: '羽毛球', emoji: '🏸' },
  { id: 'table-tennis', label: '乒乓球', emoji: '🏓' },
  { id: 'tennis', label: '网球', emoji: '🎾' },
  { id: 'gymnastics', label: '体操', emoji: '🤸' },
  { id: 'martial-arts', label: '武术 / 跆拳道', emoji: '🥋' },
  { id: 'dance', label: '舞蹈', emoji: '💃' },
  { id: 'climbing', label: '攀岩', emoji: '🧗' },
  { id: 'hiking', label: '徒步', emoji: '🥾' },
  { id: 'other', label: '其他运动', emoji: '✨' },
];

export const ACTIVITY_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((c) => [c.id, c.label]),
);
export const ACTIVITY_CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((c) => [c.id, c.emoji]),
);

export const INTENSITY_OPTIONS = [
  { value: 'light', label: '轻松' },
  { value: 'moderate', label: '适中' },
  { value: 'vigorous', label: '高强度' },
] as const;
export const INTENSITY_LABELS: Record<string, string> = {
  light: '轻松',
  moderate: '适中',
  vigorous: '高强度',
};

// `标准` (national-standard test) is category id 0; activities follow.
const STANDARD_CATEGORY = 'standard';
const CATEGORY_META: Record<string, { label: string; emoji: string }> = {
  [STANDARD_CATEGORY]: { label: '国标体测', emoji: '📋' },
  ...Object.fromEntries(ACTIVITY_CATEGORIES.map((c) => [c.id, { label: c.label, emoji: c.emoji }])),
};
// `类型` splits into two tabs: 体测 (the single national-standard test) and
// 日常运动 (the sport-activity chips). The standard test is not a chip — picking
// the 体测 tab is itself the selection.
const ACTIVITY_TAB = 'activity';
const ACTIVITY_CHIPS: ChipOption<string>[] = ACTIVITY_CATEGORIES.map((c) => ({
  value: c.id,
  label: c.label,
  emoji: c.emoji,
}));

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

type StandardFieldKey =
  | 'run50m' | 'run800m' | 'run1000m' | 'run50x8'
  | 'sitAndReach' | 'standingLongJump' | 'sitUps' | 'pullUps'
  | 'ropeSkipping' | 'vitalCapacity'
  | 'run10mShuttle' | 'tennisBallThrow' | 'doubleFootJump' | 'balanceBeam';

type StandardFieldGroup = 'speed' | 'strength' | 'flex';

interface StandardFieldDef {
  key: StandardFieldKey;
  label: string;
  group: StandardFieldGroup;
  step?: string;
  min?: string;
}

const STANDARD_FIELDS: StandardFieldDef[] = [
  { key: 'run10mShuttle', label: '10米折返跑 (秒)', group: 'speed', step: '0.1', min: '0' },
  { key: 'run50m', label: '50米跑 (秒)', group: 'speed', step: '0.1', min: '0' },
  { key: 'run800m', label: '800米跑 (秒)', group: 'speed', step: '1', min: '0' },
  { key: 'run1000m', label: '1000米跑 (秒)', group: 'speed', step: '1', min: '0' },
  { key: 'run50x8', label: '50m×8往返跑 (秒)', group: 'speed', step: '0.1', min: '0' },
  { key: 'standingLongJump', label: '立定跳远 (cm)', group: 'strength', step: '1', min: '0' },
  { key: 'tennisBallThrow', label: '网球掷远 (米)', group: 'strength', step: '0.1', min: '0' },
  { key: 'doubleFootJump', label: '双脚连续跳 (秒)', group: 'strength', step: '0.1', min: '0' },
  { key: 'sitUps', label: '仰卧起坐 (次/分)', group: 'strength', step: '1', min: '0' },
  { key: 'pullUps', label: '引体向上 (次)', group: 'strength', step: '1', min: '0' },
  { key: 'sitAndReach', label: '坐位体前屈 (cm)', group: 'flex', step: '0.1' },
  { key: 'balanceBeam', label: '走平衡木 (秒)', group: 'flex', step: '0.1', min: '0' },
  { key: 'ropeSkipping', label: '跳绳 (次/分)', group: 'flex', step: '1', min: '0' },
  { key: 'vitalCapacity', label: '肺活量 (mL)', group: 'flex', step: '1', min: '0' },
];

const STANDARD_GROUP_LABELS: Record<StandardFieldGroup, string> = {
  speed: '⚡ 速度 & 耐力',
  strength: '💪 力量',
  flex: '🤸 柔韧 & 心肺',
};

const STANDARD_INT_KEYS = new Set<StandardFieldKey>(['sitUps', 'pullUps', 'ropeSkipping', 'vitalCapacity']);

// Standard field key ↔ canonical metricId — used to reconstruct an edit entry
// from stored `health_record_values`.
export const STANDARD_METRIC_IDS: Record<StandardFieldKey, string> = {
  run50m: 'fitness.run_50m',
  run800m: 'fitness.run_800m',
  run1000m: 'fitness.run_1000m',
  run50x8: 'fitness.run_50x8',
  sitAndReach: 'fitness.sit_and_reach',
  standingLongJump: 'fitness.standing_long_jump',
  sitUps: 'fitness.sit_ups',
  pullUps: 'fitness.pull_ups',
  ropeSkipping: 'fitness.rope_skipping',
  vitalCapacity: 'fitness.vital_capacity',
  run10mShuttle: 'fitness.run_10m_shuttle',
  tennisBallThrow: 'fitness.tennis_ball_throw',
  doubleFootJump: 'fitness.double_foot_jump',
  balanceBeam: 'fitness.balance_beam',
};

type FieldVisibility = Record<StandardFieldKey, boolean>;

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

/* ── Event entry model ────────────────────────────────────────────────────
 * Each entry is one card in the modal and saves as its own health record. A
 * `standard` entry writes the national-standard assessment; an activity entry
 * writes a universal sport-activity event. */

export interface FitnessEventEntry {
  category: string;
  standardValues: Partial<Record<StandardFieldKey, string>>;
  duration: string;
  distance: string;
  intensity: string;
}

export function makeEntry(category: string): FitnessEventEntry {
  return { category, standardValues: {}, duration: '', distance: '', intensity: '' };
}

/** Seeds the modal in single-event edit mode for an existing fitness record. */
export interface FitnessEditTarget {
  eventId: string;
  date: string;
  source: string;
  notes: string;
  entry: FitnessEventEntry;
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
  /** When set, the modal edits this existing record instead of adding new ones. */
  editTarget?: FitnessEditTarget | null;
};

export function FitnessAssessmentFormContent({ child, ageMonths, onSaved, onClose, linkedReminder, editTarget }: FitnessFormContentProps) {
  const tier = ageTier(ageMonths);
  const isFemale = child.gender === 'female';
  const fields = visibleFields(tier, isFemale);
  const editing = !!editTarget;

  const [date, setDate] = useState(editTarget?.date ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(editTarget?.source || 'self');
  const [notes, setNotes] = useState(editTarget?.notes ?? '');
  const [entries, setEntries] = useState<FitnessEventEntry[]>(
    editTarget ? [editTarget.entry] : [makeEntry('running')],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const updateEntry = (idx: number, patch: Partial<FitnessEventEntry>) => {
    setEntries((prev) => prev.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry)));
  };
  const addEntry = () => {
    setEntries((prev) => {
      setActiveIdx(prev.length);
      return [...prev, makeEntry('running')];
    });
  };
  const removeEntry = (idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => (idx < cur ? cur - 1 : Math.min(cur, entries.length - 2)));
  };

  // An activity entry needs a positive duration; a standard entry always saves.
  const entryComplete = (entry: FitnessEventEntry) =>
    entry.category === STANDARD_CATEGORY || (parseNum(entry.duration) ?? 0) > 0;
  const canSave = !!date && entries.every(entryComplete);

  const handleSubmit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const now = isoNow();
    const ageAtDate = computeAgeMonthsAt(child.birthDate, date);
    try {
      // Edit = replace: drop the original event, then write the (single) entry.
      if (editTarget) {
        await deleteFitnessEvent(editTarget.eventId);
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        // A reminder is fulfilled once — attach it to the first event only.
        const linkedStateId = i === 0 ? linkedReminder?.stateId ?? null : null;
        const linkedRuleId = i === 0 ? linkedReminder?.ruleId ?? null : null;

        if (entry.category === STANDARD_CATEGORY) {
          const num = (key: StandardFieldKey) => {
            const raw = entry.standardValues[key] ?? '';
            return STANDARD_INT_KEYS.has(key) ? parseIntNum(raw) : parseNum(raw);
          };
          await insertFitnessAssessment({
            assessmentId: ulid(),
            childId: child.childId,
            assessedAt: date,
            ageMonths: ageAtDate,
            assessmentSource: source || null,
            run50m: num('run50m'),
            run800m: num('run800m'),
            run1000m: num('run1000m'),
            run50x8: num('run50x8'),
            sitAndReach: num('sitAndReach'),
            standingLongJump: num('standingLongJump'),
            sitUps: num('sitUps'),
            pullUps: num('pullUps'),
            ropeSkipping: num('ropeSkipping'),
            vitalCapacity: num('vitalCapacity'),
            run10mShuttle: num('run10mShuttle'),
            tennisBallThrow: num('tennisBallThrow'),
            doubleFootJump: num('doubleFootJump'),
            balanceBeam: num('balanceBeam'),
            footArchStatus: null,
            notes: notes || null,
            now,
            linkedReminderStateId: linkedStateId,
            linkedReminderRuleId: linkedRuleId,
          });
        } else {
          const value = (
            metricId: string,
            patch: Partial<HealthRecordCaptureValueInput>,
          ): HealthRecordCaptureValueInput => ({
            valueId: ulid(),
            metricId,
            valueNumber: null,
            valueText: null,
            valueJson: null,
            unit: null,
            qualifier: null,
            recordKind: 'measured',
            sourceValueIds: null,
            ...patch,
          });
          const values: HealthRecordCaptureValueInput[] = [
            value('fitness.activity_category', { valueText: entry.category }),
            value('fitness.activity_duration', { valueNumber: parseNum(entry.duration), unit: 'min' }),
          ];
          const distanceNum = parseNum(entry.distance);
          if (distanceNum != null) {
            values.push(value('fitness.activity_distance', { valueNumber: distanceNum, unit: 'm' }));
          }
          if (entry.intensity) {
            values.push(value('fitness.activity_intensity', { valueText: entry.intensity }));
          }
          await saveHealthRecordCapture({
            eventId: ulid(),
            childId: child.childId,
            protocolId: 'fitness-sport-activity',
            groupId: 'fitness',
            recordKind: 'manual',
            sourceSurface: 'profile_detail',
            recordedAt: now,
            effectiveDate: date,
            ageMonths: ageAtDate,
            recorderId: null,
            linkedReminderStateId: linkedStateId,
            linkedReminderRuleId: linkedRuleId,
            notes: notes || null,
            metadataJson: source ? JSON.stringify({ assessmentSource: source }) : null,
            now,
            values,
          });
        }
      }
      await onSaved();
      onClose();
    } catch {
      /* bridge unavailable */
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ModalHeader title={editing ? '编辑体能记录' : '添加体能记录'} icon={editing ? '✏️' : '🏃'} onClose={onClose} />
      <ModalContent>
        <div className="space-y-5">
          <FormGrid cols={2}>
            <FormField label="日期">
              <DatePicker value={date} onChange={setDate} className="h-12" />
            </FormField>
            <FormField label="来源">
              <AppSelect
                value={source}
                onChange={setSource}
                options={SOURCE_OPTIONS.map((v) => ({ value: v, label: SOURCE_LABELS[v] ?? v }))}
                className="min-h-12"
                contentClassName="z-[120]"
              />
            </FormField>
          </FormGrid>

          {entries.map((entry, idx) => {
            const isActive = idx === activeIdx;
            const meta = CATEGORY_META[entry.category];
            return (
              <div
                key={idx}
                className={cn(
                  'cursor-pointer rounded-2xl border p-4 transition-all',
                  isActive
                    ? 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_38%,var(--nimi-border-subtle))] bg-[var(--nimi-surface-card)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
                )}
                onClick={() => setActiveIdx(idx)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p
                    className={cn(
                      'text-[13px] font-semibold',
                      isActive ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]',
                    )}
                  >
                    事件 {idx + 1} {meta ? `· ${meta.emoji} ${meta.label}` : ''}
                  </p>
                  {entries.length > 1 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeEntry(idx);
                      }}
                      className="rounded-full px-2 py-0.5 text-[12px] text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)]"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                {isActive ? (
                  <div className="mt-2 space-y-3" onClick={(event) => event.stopPropagation()}>
                    <FormField label="类型">
                      <div className="space-y-2.5">
                        <PillTabs
                          size="sm"
                          ariaLabel="记录类型"
                          items={[
                            { value: STANDARD_CATEGORY, label: '📋 体测' },
                            { value: ACTIVITY_TAB, label: '🏃 日常运动' },
                          ]}
                          value={entry.category === STANDARD_CATEGORY ? STANDARD_CATEGORY : ACTIVITY_TAB}
                          onValueChange={(tab) => {
                            if (tab === STANDARD_CATEGORY) {
                              updateEntry(idx, { category: STANDARD_CATEGORY });
                            } else if (entry.category === STANDARD_CATEGORY) {
                              updateEntry(idx, { category: 'running' });
                            }
                          }}
                        />
                        {entry.category !== STANDARD_CATEGORY ? (
                          <ChipGroup
                            size="sm"
                            options={ACTIVITY_CHIPS}
                            value={entry.category}
                            onChange={(value) => updateEntry(idx, { category: value })}
                          />
                        ) : null}
                      </div>
                    </FormField>

                    {entry.category === STANDARD_CATEGORY ? (
                      <StandardEventFields
                        tier={tier}
                        fields={fields}
                        values={entry.standardValues}
                        onChange={(key, value) =>
                          updateEntry(idx, { standardValues: { ...entry.standardValues, [key]: value } })
                        }
                      />
                    ) : (
                      <ActivityEventFields
                        entry={entry}
                        onChange={(patch) => updateEntry(idx, patch)}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {!editing ? (
            <DashedAddButton shape="row" onClick={addEntry} label="添加另一个事件" />
          ) : null}

          <FormField label="备注">
            <TextareaField
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="选填"
              rows={2}
              className="w-full"
            />
          </FormField>
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={saving || !canSave} tone="primary" size="md">
          {saving ? '保存中...' : editing ? '保存修改' : '保存'}
        </Button>
      </ModalFooter>
    </>
  );
}

function StandardEventFields({
  tier,
  fields,
  values,
  onChange,
}: {
  tier: AgeTier;
  fields: FieldVisibility;
  values: Partial<Record<StandardFieldKey, string>>;
  onChange: (key: StandardFieldKey, value: string) => void;
}) {
  const groups: StandardFieldGroup[] = ['speed', 'strength', 'flex'];
  return (
    <div className="space-y-3">
      <InfoBanner tone="accent">
        📋 {AGE_TIER_LABELS[tier]} · 依据《国家学生体质健康标准》测试项目，按需填写
      </InfoBanner>
      {groups.map((group) => {
        const groupFields = STANDARD_FIELDS.filter((f) => f.group === group && fields[f.key]);
        if (groupFields.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1.5 text-[12px] font-medium text-[var(--nimi-text-muted)]">
              {STANDARD_GROUP_LABELS[group]}
            </p>
            <FormGrid cols={3}>
              {groupFields.map((f) => (
                <FormField key={f.key} label={f.label}>
                  <TextField
                    type="number"
                    step={f.step}
                    min={f.min}
                    placeholder="--"
                    value={values[f.key] ?? ''}
                    onChange={(event) => onChange(f.key, event.target.value)}
                    className="w-full min-h-12"
                    inputClassName={NUMBER_INPUT_CLASS}
                  />
                </FormField>
              ))}
            </FormGrid>
          </div>
        );
      })}
    </div>
  );
}

function ActivityEventFields({
  entry,
  onChange,
}: {
  entry: FitnessEventEntry;
  onChange: (patch: Partial<FitnessEventEntry>) => void;
}) {
  return (
    <div className="space-y-3">
      <FormGrid cols={2}>
        <FormField label="时长 (分钟)" required>
          <TextField
            type="number"
            step="1"
            min="0"
            placeholder="例如 30"
            value={entry.duration}
            onChange={(event) => onChange({ duration: event.target.value })}
            className="w-full min-h-12"
            inputClassName={NUMBER_INPUT_CLASS}
          />
        </FormField>
        <FormField label="距离 (米)" hint="可选 — 适用于跑步、游泳、骑行等">
          <TextField
            type="number"
            step="1"
            min="0"
            placeholder="例如 800"
            value={entry.distance}
            onChange={(event) => onChange({ distance: event.target.value })}
            className="w-full min-h-12"
            inputClassName={NUMBER_INPUT_CLASS}
          />
        </FormField>
      </FormGrid>
      <FormField label="强度">
        <ChipGroup
          size="sm"
          layout="fill"
          clearable
          options={INTENSITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={entry.intensity}
          onChange={(value) => onChange({ intensity: value })}
        />
      </FormField>
    </div>
  );
}

export function FitnessAssessmentModal(props: FitnessFormContentProps) {
  return (
    <HealthRecordModalShell open size="L" onClose={props.onClose}>
      <FitnessAssessmentFormContent {...props} />
    </HealthRecordModalShell>
  );
}
