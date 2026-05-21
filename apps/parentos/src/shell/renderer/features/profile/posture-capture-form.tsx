import { X } from 'lucide-react';
import { Button, DashedAddButton, DatePicker, StatusBadge, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useRef, useState } from 'react';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertPostureAssessment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  ChipGroup,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  InlineError,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SectionCard,
} from './health-record-modal-shell.js';

const SOURCE_OPTIONS = [
  { value: 'parent', label: '家长观察' },
  { value: 'checkup', label: '体检报告' },
  { value: 'doctor', label: '医生评估' },
] as const;

const SHOULDER_OPTIONS = [
  { value: '0', label: '对称', normal: true },
  { value: '1', label: '左肩偏高', normal: false },
  { value: '2', label: '右肩偏高', normal: false },
] as const;

const SCAPULA_OPTIONS = [
  { value: 'symmetric', label: '对称', normal: true },
  { value: 'left-wing', label: '左侧突出', normal: false },
  { value: 'right-wing', label: '右侧突出', normal: false },
] as const;

const HIP_OPTIONS = [
  { value: 'equal', label: '等高', normal: true },
  { value: 'left-high', label: '左侧高', normal: false },
  { value: 'right-high', label: '右侧高', normal: false },
] as const;

const LEG_OPTIONS = [
  { value: 'straight', label: '直腿', normal: true },
  { value: 'o-leg', label: 'O型腿', normal: false },
  { value: 'x-leg', label: 'X型腿', normal: false },
] as const;

const HEEL_OPTIONS = [
  { value: 'normal', label: '垂直', normal: true },
  { value: 'valgus', label: '外翻', normal: false },
  { value: 'varus', label: '内翻', normal: false },
] as const;

const NECK_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'mild-forward', label: '轻度前倾', normal: false },
  { value: 'obvious-forward', label: '明显前倾', normal: false },
] as const;

const PELVIS_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'anterior-tilt', label: '骨盆前倾', normal: false },
] as const;

const KNEE_OPTIONS = [
  { value: 'normal', label: '正常', normal: true },
  { value: 'hyperextension', label: '膝盖超伸', normal: false },
] as const;

const ADAM_OPTIONS = [
  { value: 'normal', label: '两侧等高', normal: true },
  { value: 'mild', label: '轻微不对称', normal: false },
  { value: 'obvious', label: '明显隆起', normal: false },
] as const;

const POSTURE_TABS = [
  { key: 'back', label: '正背面', emoji: '🧍', photoKey: 'back' },
  { key: 'side', label: '侧面', emoji: '🧍‍♂️', photoKey: 'side' },
  { key: 'forward-bend', label: '前屈', emoji: '🙇', photoKey: 'adam' },
] as const;

type PostureTab = (typeof POSTURE_TABS)[number]['key'];

const COBB_LEVELS = [
  { max: 10, label: '正常', tone: 'success' },
  { max: 25, label: '需定期监测', tone: 'warning' },
  { max: 40, label: '建议支具治疗', tone: 'danger' },
  { max: Infinity, label: '建议手术评估', tone: 'danger' },
] as const;

function cobbLevel(angle: number) {
  return COBB_LEVELS.find((l) => angle <= l.max) ?? COBB_LEVELS[COBB_LEVELS.length - 1]!;
}

type PostureCaptureChild = {
  childId: string;
  birthDate: string;
};

type PostureCaptureProps = {
  child: PostureCaptureChild;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function PostureCaptureContent({ child, onSaved, onClose }: PostureCaptureProps) {
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formSource, setFormSource] = useState<string>('parent');
  const [formShoulder, setFormShoulder] = useState('');
  const [formScapula, setFormScapula] = useState('');
  const [formAdam, setFormAdam] = useState('');
  const [formCobb, setFormCobb] = useState('');
  const [formHip, setFormHip] = useState('');
  const [formLeg, setFormLeg] = useState('');
  const [formHeel, setFormHeel] = useState('');
  const [formNeck, setFormNeck] = useState('');
  const [formPelvis, setFormPelvis] = useState('');
  const [formKnee, setFormKnee] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotos, setFormPhotos] = useState<Record<string, string>>({});
  const [postureTab, setPostureTab] = useState<PostureTab>('back');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoSlotRef = useRef<string | null>(null);
  const isMedical = formSource === 'checkup' || formSource === 'doctor';

  const handleSubmit = async () => {
    if (!formDate) {
      setErrorMsg('请选择评估日期');
      return;
    }

    const photoValues = Object.values(formPhotos);
    const hasAnyField =
      Boolean(formShoulder || formScapula || formAdam || formHip || formLeg || formHeel
        || formNeck || formPelvis || formKnee)
      || formCobb.trim().length > 0
      || formNotes.trim().length > 0
      || photoValues.length > 0;
    if (!hasAnyField) {
      setErrorMsg('请至少选择一项体态评估或填写 Cobb 角');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await insertPostureAssessment({
        assessmentId: ulid(),
        childId: child.childId,
        assessedAt: formDate,
        ageMonths: computeAgeMonthsAt(child.birthDate, formDate),
        source: formSource || null,
        shoulder: formShoulder || null,
        scapula: formScapula || null,
        hip: formHip || null,
        leg: formLeg || null,
        heel: formHeel || null,
        neck: formNeck || null,
        pelvis: formPelvis || null,
        knee: formKnee || null,
        adam: formAdam || null,
        cobbAngle: formCobb.trim() ? parseFloat(formCobb) : null,
        notes: formNotes.trim() || null,
        photoPaths: photoValues.length > 0 ? JSON.stringify(photoValues) : null,
        now: isoNow(),
      });
      await onSaved();
      onClose();
    } catch (error) {
      catchLog('posture-capture', 'action:submit-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const currentPhotoKey = POSTURE_TABS.find((t) => t.key === postureTab)?.photoKey ?? 'back';
  const currentPhotoUrl = formPhotos[currentPhotoKey];

  const chipActiveColorFor = (selected: boolean, normal: boolean): string | undefined => {
    if (!selected) return undefined;
    return normal ? 'var(--nimi-status-success)' : 'var(--nimi-status-info)';
  };

  type ChipOpt = { value: string; label: string; normal: boolean };
  const renderChips = (opts: readonly ChipOpt[], value: string, onChange: (v: string) => void) => {
    const selectedOpt = opts.find((o) => o.value === value);
    const activeColor = selectedOpt ? chipActiveColorFor(true, selectedOpt.normal) : undefined;
    return (
      <ChipGroup
        layout="fill"
        size="sm"
        clearable
        activeColor={activeColor}
        options={opts.map((o) => ({ value: o.value, label: o.label }))}
        value={value}
        onChange={(next) => onChange(next === value ? '' : next)}
      />
    );
  };

  return (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          const slot = photoSlotRef.current;
          event.target.value = '';
          if (!file || !slot) return;
          try {
            const dataUrl = await readImageFileAsDataUrl(file);
            setFormPhotos((p) => ({ ...p, [slot]: dataUrl }));
          } catch (error) {
            catchLog('posture-capture', 'action:read-photo-failed')(error);
          }
        }}
      />

      <ModalHeader title="添加体态记录" icon="🧍" onClose={onClose} />
      <ModalContent>
        <div className="space-y-4">
          <SectionCard title="基础信息">
            <FormGrid cols={2}>
              <FormField label="评估日期">
                <DatePicker value={formDate} onChange={setFormDate} className="h-12" />
              </FormField>
              <FormField label="数据来源">
                <ChipGroup
                  layout="fill"
                  size="sm"
                  options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  value={formSource}
                  onChange={(next) => setFormSource(next)}
                />
              </FormField>
            </FormGrid>
          </SectionCard>

          <SectionCard variant="plain">
            <div className="grid grid-cols-3 gap-0 overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
              {POSTURE_TABS.map((tab) => {
                const active = postureTab === tab.key;
                const hasPhoto = !!formPhotos[tab.photoKey];
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setPostureTab(tab.key)}
                    className={`relative flex flex-col items-center gap-1.5 border-b-2 py-3 transition-colors ${
                      active
                        ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]'
                        : 'border-transparent bg-[var(--nimi-surface-panel)] hover:bg-[var(--nimi-action-ghost-hover)]'
                    }`}
                  >
                    <span className="text-[18px]">{tab.emoji}</span>
                    <span
                      className={`text-[12.5px] font-medium ${
                        active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'
                      }`}
                    >
                      {tab.label}
                    </span>
                    <span
                      className={`absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                        hasPhoto
                          ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]'
                          : 'bg-[var(--nimi-surface-muted)] text-[var(--nimi-text-muted)]'
                      }`}
                    >
                      {hasPhoto ? '✓' : '📷'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 space-y-3">
              {currentPhotoUrl ? (
                <div className="relative">
                  <img src={currentPhotoUrl} alt="preview" className="h-28 w-full rounded-2xl object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setFormPhotos((p) => {
                        const next = { ...p };
                        delete next[currentPhotoKey];
                        return next;
                      })
                    }
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--nimi-text-primary)_50%,transparent)] text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_70%,transparent)]"
                    aria-label="删除照片"
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </div>
              ) : (
                <DashedAddButton
                  shape="tile"
                  onClick={() => {
                    photoSlotRef.current = currentPhotoKey;
                    photoInputRef.current?.click();
                  }}
                  label={`点击上传${POSTURE_TABS.find((t) => t.key === postureTab)?.label}照片`}
                />
              )}

              {postureTab === 'back' && (
                <div className="space-y-3">
                  <FormField label="高低肩">
                    {renderChips(SHOULDER_OPTIONS as readonly ChipOpt[], formShoulder, setFormShoulder)}
                  </FormField>
                  <FormField label="肩胛骨">
                    {renderChips(SCAPULA_OPTIONS as readonly ChipOpt[], formScapula, setFormScapula)}
                  </FormField>
                  <FormField label="高低胯">
                    {renderChips(HIP_OPTIONS as readonly ChipOpt[], formHip, setFormHip)}
                  </FormField>
                  <FormField label="腿型">
                    {renderChips(LEG_OPTIONS as readonly ChipOpt[], formLeg, setFormLeg)}
                  </FormField>
                  <FormField label="足跟内外翻">
                    {renderChips(HEEL_OPTIONS as readonly ChipOpt[], formHeel, setFormHeel)}
                  </FormField>
                </div>
              )}
              {postureTab === 'side' && (
                <div className="space-y-3">
                  <FormField label="颈部与头部">
                    {renderChips(NECK_OPTIONS as readonly ChipOpt[], formNeck, setFormNeck)}
                  </FormField>
                  <FormField label="骨盆">
                    {renderChips(PELVIS_OPTIONS as readonly ChipOpt[], formPelvis, setFormPelvis)}
                  </FormField>
                  <FormField label="膝盖">
                    {renderChips(KNEE_OPTIONS as readonly ChipOpt[], formKnee, setFormKnee)}
                  </FormField>
                </div>
              )}
              {postureTab === 'forward-bend' && (
                <div className="space-y-3">
                  <FormField label="前屈试验（Adam's test）">
                    {renderChips(ADAM_OPTIONS as readonly ChipOpt[], formAdam, setFormAdam)}
                  </FormField>
                  {formAdam === 'obvious' && (
                    <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-3 py-2.5">
                      <p className="text-[12.5px] font-medium text-[var(--nimi-status-danger)]">
                        ⚠️ 建议尽快去骨科或脊柱外科做正式评估
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="医疗数据（脊柱侧弯）"
            trailing={
              isMedical ? null : (
                <span
                  className="rounded-full bg-[var(--nimi-surface-muted)] px-2 py-0.5 text-[11px] text-[var(--nimi-text-muted)]"
                >
                  选择"体检报告"或"医生评估"后激活
                </span>
              )
            }
          >
            <FormField label="Cobb 角（°）" hint="来自 X 光报告">
              <div className="flex items-center gap-3">
                <TextField
                  type="number"
                  step="1"
                  min="0"
                  max="90"
                  value={formCobb}
                  onChange={(e) => setFormCobb(e.target.value)}
                  disabled={!isMedical}
                  placeholder="--"
                  className="w-full min-h-12"
                  inputClassName="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                {formCobb && parseFloat(formCobb) > 0 ? (() => {
                  const level = cobbLevel(parseFloat(formCobb));
                  return (
                    <StatusBadge tone={level.tone} className="shrink-0 py-1 text-[12.5px]">
                      {level.label}
                    </StatusBadge>
                  );
                })() : null}
              </div>
            </FormField>
          </SectionCard>

          <FormField label="备注">
            <TextareaField
              rows={2}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="其他观察到的情况..."
              className="w-full"
            />
          </FormField>

          {errorMsg ? <InlineError>{errorMsg}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={saving} tone="primary" size="md">
          {saving ? '保存中...' : '保存'}
        </Button>
      </ModalFooter>
    </>
  );
}

/**
 * Sidebar-less modal wrapper for the posture detail page's "添加记录" button.
 * Sized M (720) so the form pane matches the width of the posture pane inside
 * the `/profile` 添加健康数据 capture modal (L 920 − 200 sidebar = 720).
 */
export function PostureCaptureModal(props: PostureCaptureProps) {
  return (
    <HealthRecordModalShell open size="M" onClose={props.onClose}>
      <PostureCaptureContent {...props} />
    </HealthRecordModalShell>
  );
}
