import { useRef, useState } from 'react';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMeasurement } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  CancelButton,
  ChipGroup,
  DateField,
  FormField,
  FormGrid,
  HEALTH_MODAL_TOKENS,
  HealthRecordModalShell,
  InlineError,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  SectionCard,
  TextArea,
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

/** nimi-kit status palette (light scheme): success / warning / danger. */
const KIT_STATUS_SUCCESS = '#16a34a';
const KIT_STATUS_WARNING = '#d97706';
const KIT_STATUS_DANGER = '#dc2626';

/**
 * ParentOS page-accent purple family (indigo). The primary tone `#818CF8`
 * (indigo-400) matches `S.blue` used by the "添加孩子" button and other
 * page-level accents — pairing it with a lighter sibling keeps chip
 * selection within the established page hue.
 */
const KIT_OVERTONE_LIGHT = '#a5b4fc'; // indigo-300 — selected & "normal" state
const KIT_OVERTONE_DEEP = '#818CF8';  // indigo-400 (S.blue) — selected & "abnormal" state

const COBB_LEVELS = [
  { max: 10, label: '正常', color: KIT_STATUS_SUCCESS },
  { max: 25, label: '需定期监测', color: KIT_STATUS_WARNING },
  { max: 40, label: '建议支具治疗', color: KIT_STATUS_DANGER },
  { max: Infinity, label: '建议手术评估', color: KIT_STATUS_DANGER },
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
  const [photoUploadHover, setPhotoUploadHover] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoSlotRef = useRef<string | null>(null);
  const isMedical = formSource === 'checkup' || formSource === 'doctor';

  const handleSubmit = async () => {
    if (!formDate) return;
    setSaving(true);
    setErrorMsg(null);

    const now = isoNow();
    const ageMonths = computeAgeMonthsAt(child.birthDate, formDate);

    const parts: string[] = [];
    if (formSource) parts.push(`来源:${SOURCE_OPTIONS.find((o) => o.value === formSource)?.label ?? formSource}`);
    if (formScapula) parts.push(`肩胛骨:${SCAPULA_OPTIONS.find((o) => o.value === formScapula)?.label ?? formScapula}`);
    if (formHip) parts.push(`高低胯:${HIP_OPTIONS.find((o) => o.value === formHip)?.label ?? formHip}`);
    if (formLeg) parts.push(`腿型:${LEG_OPTIONS.find((o) => o.value === formLeg)?.label ?? formLeg}`);
    if (formHeel) parts.push(`足跟:${HEEL_OPTIONS.find((o) => o.value === formHeel)?.label ?? formHeel}`);
    if (formNeck) parts.push(`颈部:${NECK_OPTIONS.find((o) => o.value === formNeck)?.label ?? formNeck}`);
    if (formPelvis) parts.push(`骨盆:${PELVIS_OPTIONS.find((o) => o.value === formPelvis)?.label ?? formPelvis}`);
    if (formKnee) parts.push(`膝盖:${KNEE_OPTIONS.find((o) => o.value === formKnee)?.label ?? formKnee}`);
    if (formAdam) parts.push(`前屈试验:${ADAM_OPTIONS.find((o) => o.value === formAdam)?.label ?? formAdam}`);
    const photoKeys = Object.keys(formPhotos);
    if (photoKeys.length > 0) {
      parts.push(`照片:${photoKeys.map((k) => POSTURE_TABS.find((t) => t.photoKey === k)?.label ?? k).join(',')}`);
    }
    if (formNotes.trim()) parts.push(formNotes.trim());
    const noteStr = parts.length > 0 ? parts.join(' | ') : null;

    try {
      let wroteSomething = false;
      if (formCobb.trim()) {
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: 'scoliosis-cobb-angle',
          value: parseFloat(formCobb),
          measuredAt: formDate,
          ageMonths,
          percentile: null,
          source: 'manual',
          notes: noteStr,
          now,
        });
        wroteSomething = true;
      }
      if (formShoulder) {
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: 'shoulder-symmetry',
          value: parseFloat(formShoulder),
          measuredAt: formDate,
          ageMonths,
          percentile: null,
          source: 'manual',
          notes: noteStr,
          now,
        });
        wroteSomething = true;
      }
      if (!wroteSomething && (formAdam || formScapula || formHip || formLeg || formHeel || formNeck || formPelvis || formKnee)) {
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: 'shoulder-symmetry',
          value: -1,
          measuredAt: formDate,
          ageMonths,
          percentile: null,
          source: 'manual',
          notes: noteStr,
          now,
        });
        wroteSomething = true;
      }

      if (!wroteSomething) {
        setErrorMsg('请至少选择一项体态评估或填写 Cobb 角');
        setSaving(false);
        return;
      }

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
    return normal ? KIT_OVERTONE_LIGHT : KIT_OVERTONE_DEEP;
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
                <DateField value={formDate} onChange={setFormDate} />
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
            <div
              className="grid grid-cols-3 gap-0 overflow-hidden rounded-[14px]"
              style={{ border: `1px solid ${HEALTH_MODAL_TOKENS.border}`, background: '#ffffff' }}
            >
              {POSTURE_TABS.map((tab) => {
                const active = postureTab === tab.key;
                const hasPhoto = !!formPhotos[tab.photoKey];
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setPostureTab(tab.key)}
                    className="relative flex flex-col items-center gap-1.5 py-3 transition-colors"
                    style={{
                      background: active ? '#f4f7ea' : '#fafaf8',
                      borderBottom: active ? `2px solid ${HEALTH_MODAL_TOKENS.accent}` : '2px solid transparent',
                    }}
                  >
                    <span className="text-[18px]">{tab.emoji}</span>
                    <span className="text-[12.5px] font-medium" style={{ color: active ? HEALTH_MODAL_TOKENS.accent : HEALTH_MODAL_TOKENS.sub }}>
                      {tab.label}
                    </span>
                    <span
                      className="absolute top-1.5 right-1.5 grid h-4 w-4 place-items-center rounded-full text-[10px]"
                      style={{ background: hasPhoto ? '#dcfce7' : '#f0f0ec', color: hasPhoto ? '#166534' : HEALTH_MODAL_TOKENS.sub }}
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
                  <img src={currentPhotoUrl} alt="preview" className="h-28 w-full rounded-[14px] object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setFormPhotos((p) => {
                        const next = { ...p };
                        delete next[currentPhotoKey];
                        return next;
                      })
                    }
                    className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-[12px] text-white hover:bg-black/70"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    photoSlotRef.current = currentPhotoKey;
                    photoInputRef.current?.click();
                  }}
                  onMouseEnter={() => setPhotoUploadHover(true)}
                  onMouseLeave={() => setPhotoUploadHover(false)}
                  className="flex h-20 w-full flex-col items-center justify-center gap-1.5 text-[12.5px] font-medium"
                  style={{
                    borderRadius: 14,
                    border: `2px dashed ${photoUploadHover ? HEALTH_MODAL_TOKENS.accent : '#d0d0cc'}`,
                    background: photoUploadHover ? '#f9fbf4' : '#fafaf8',
                    color: photoUploadHover ? HEALTH_MODAL_TOKENS.accent : HEALTH_MODAL_TOKENS.sub,
                    transition: 'border-color 0.25s ease, background 0.25s ease, color 0.25s ease',
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      stroke: photoUploadHover ? HEALTH_MODAL_TOKENS.accent : '#b0b0aa',
                      transform: photoUploadHover ? 'scale(1.15) rotate(6deg)' : 'scale(1) rotate(0deg)',
                      transition: 'stroke 0.25s ease, transform 0.3s ease',
                    }}
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>点击上传{POSTURE_TABS.find((t) => t.key === postureTab)?.label}照片</span>
                </button>
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
                    <div className="rounded-[12px] px-3 py-2.5" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                      <p className="text-[12.5px] font-medium" style={{ color: KIT_STATUS_DANGER }}>
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
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: '#f5f3ef', color: HEALTH_MODAL_TOKENS.sub }}
                >
                  选择"体检报告"或"医生评估"后激活
                </span>
              )
            }
          >
            <FormField label="Cobb 角（°）" hint="来自 X 光报告">
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  step="1"
                  min="0"
                  max="90"
                  value={formCobb}
                  onChange={(e) => setFormCobb(e.target.value)}
                  disabled={!isMedical}
                  placeholder="--"
                />
                {formCobb && parseFloat(formCobb) > 0 ? (() => {
                  const level = cobbLevel(parseFloat(formCobb));
                  return (
                    <span
                      className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-medium"
                      style={{ background: `${level.color}15`, color: level.color }}
                    >
                      {level.label}
                    </span>
                  );
                })() : null}
              </div>
            </FormField>
          </SectionCard>

          <FormField label="备注">
            <TextArea
              rows={2}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="其他观察到的情况..."
            />
          </FormField>

          {errorMsg ? <InlineError>{errorMsg}</InlineError> : null}
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

export function PostureCaptureModal(props: PostureCaptureProps) {
  return (
    <HealthRecordModalShell open size="L" onClose={props.onClose}>
      <PostureCaptureContent {...props} />
    </HealthRecordModalShell>
  );
}
