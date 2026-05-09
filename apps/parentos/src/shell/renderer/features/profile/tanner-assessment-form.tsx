import { useState, type ReactNode } from 'react';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMeasurement, insertTannerAssessment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { TannerStageSelector } from './tanner-stage-selector.js';
import {
  ASSESSED_BY_LABELS,
  ASSESSED_BY_OPTIONS,
  BREAST_STAGES,
  GENITAL_STAGES,
  PUBIC_HAIR_STAGES,
  type StageDesc,
} from './tanner-page-shared.js';
import {
  CancelButton,
  ChipGroup,
  type ChipOption,
  DateField,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
} from './health-record-modal-shell.js';

type TannerAssessmentFormProps = {
  bgLabel: string;
  bgStages: StageDesc[];
  formAssessedAt: string;
  setFormAssessedAt: (value: string) => void;
  formBG: number;
  setFormBG: (value: number) => void;
  formPH: number;
  setFormPH: (value: number) => void;
  formAssessedBy: string;
  setFormAssessedBy: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
  formBoneAge: string;
  setFormBoneAge: (value: string) => void;
  formBodyFat: string;
  setFormBodyFat: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

const ASSESSED_BY_CHIPS: ChipOption<string>[] = ASSESSED_BY_OPTIONS.map((value) => ({
  value,
  label: ASSESSED_BY_LABELS[value] ?? value,
}));

export function TannerAssessmentForm({
  bgLabel,
  bgStages,
  formAssessedAt,
  setFormAssessedAt,
  formBG,
  setFormBG,
  formPH,
  setFormPH,
  formAssessedBy,
  setFormAssessedBy,
  formNotes,
  setFormNotes,
  formBoneAge,
  setFormBoneAge,
  formBodyFat,
  setFormBodyFat,
  onClose,
  onSave,
}: TannerAssessmentFormProps) {
  return (
    <HealthRecordModalShell open size="XL" onClose={onClose}>
      <ModalHeader title="新增评估" icon="🌱" onClose={onClose} />
      <ModalContent>
        <TannerFormFields
          bgLabel={bgLabel}
          bgStages={bgStages}
          formAssessedAt={formAssessedAt}
          setFormAssessedAt={setFormAssessedAt}
          formBG={formBG}
          setFormBG={setFormBG}
          formPH={formPH}
          setFormPH={setFormPH}
          formAssessedBy={formAssessedBy}
          setFormAssessedBy={setFormAssessedBy}
          formNotes={formNotes}
          setFormNotes={setFormNotes}
          formBoneAge={formBoneAge}
          setFormBoneAge={setFormBoneAge}
          formBodyFat={formBodyFat}
          setFormBodyFat={setFormBodyFat}
        />
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={onSave}>保存评估</PrimaryButton>
      </ModalFooter>
    </HealthRecordModalShell>
  );
}

type TannerFormFieldsProps = Omit<TannerAssessmentFormProps, 'onClose' | 'onSave'>;

function TannerFormFields({
  bgLabel,
  bgStages,
  formAssessedAt,
  setFormAssessedAt,
  formBG,
  setFormBG,
  formPH,
  setFormPH,
  formAssessedBy,
  setFormAssessedBy,
  formNotes,
  setFormNotes,
  formBoneAge,
  setFormBoneAge,
  formBodyFat,
  setFormBodyFat,
}: TannerFormFieldsProps) {
  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <FormField label="评估日期">
          <DateField value={formAssessedAt} onChange={setFormAssessedAt} />
        </FormField>
        <FormField label="评估人">
          <ChipGroup
            options={ASSESSED_BY_CHIPS}
            value={formAssessedBy}
            onChange={setFormAssessedBy}
            layout="fill"
            activeColor="#BDE0F5"
          />
        </FormField>
      </FormGrid>

      <FormGrid cols={2} gap={4}>
        <TannerStageSelector stages={bgStages} value={formBG} onChange={setFormBG} label={bgLabel} />
        <TannerStageSelector stages={PUBIC_HAIR_STAGES} value={formPH} onChange={setFormPH} label="阴毛发育 (PH期)" />
      </FormGrid>

      <FormGrid cols={2}>
        <FormField label="🦴 骨龄（岁，可选）">
          <Input
            type="number"
            step="0.1"
            value={formBoneAge}
            onChange={(event) => setFormBoneAge(event.target.value)}
            placeholder="如 12.5"
          />
        </FormField>
        <FormField label="📊 体脂率（%，可选）">
          <Input
            type="number"
            step="0.1"
            value={formBodyFat}
            onChange={(event) => setFormBodyFat(event.target.value)}
            placeholder="如 18.5"
          />
        </FormField>
      </FormGrid>

      <FormField label="备注">
        <Input
          value={formNotes}
          onChange={(event) => setFormNotes(event.target.value)}
          placeholder="如：与上次对比有进展..."
        />
      </FormField>
    </div>
  );
}

type TannerCaptureContentProps = {
  child: { childId: string; birthDate: string; gender: 'male' | 'female' };
  onSaved: () => void | Promise<void>;
  onClose: () => void;
  /** Optional trailing slot in the header (e.g., milestone/tanner tab switcher). */
  headerTrailing?: ReactNode;
};

export function TannerCaptureContent({ child, onSaved, onClose, headerTrailing }: TannerCaptureContentProps) {
  const isFemale = child.gender === 'female';
  const bgLabel = isFemale ? '乳房发育 (B期)' : '外生殖器发育 (G期)';
  const bgStages: StageDesc[] = isFemale ? BREAST_STAGES : GENITAL_STAGES;

  const [assessedAt, setAssessedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [bg, setBg] = useState(1);
  const [ph, setPh] = useState(1);
  const [assessedBy, setAssessedBy] = useState<string>('parent');
  const [notes, setNotes] = useState('');
  const [boneAge, setBoneAge] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!assessedAt || bg < 1 || bg > 5 || ph < 1 || ph > 5) return;
    setSaving(true);
    const now = isoNow();
    const ageMonths = computeAgeMonthsAt(child.birthDate, assessedAt);
    try {
      await insertTannerAssessment({
        assessmentId: ulid(),
        childId: child.childId,
        assessedAt,
        ageMonths,
        breastOrGenitalStage: bg,
        pubicHairStage: ph,
        assessedBy: assessedBy || null,
        notes: notes.trim() || null,
        now,
      });
      if (boneAge.trim()) {
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: 'bone-age',
          value: parseFloat(boneAge),
          measuredAt: assessedAt,
          ageMonths,
          percentile: null,
          source: 'manual',
          notes: null,
          now,
        });
      }
      if (bodyFat.trim()) {
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: 'body-fat-percentage',
          value: parseFloat(bodyFat),
          measuredAt: assessedAt,
          ageMonths,
          percentile: null,
          source: 'manual',
          notes: null,
          now,
        });
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
      <ModalHeader title="记录青春期评估" icon="🌱" onClose={onClose} trailing={headerTrailing} />
      <ModalContent>
        <TannerFormFields
          bgLabel={bgLabel}
          bgStages={bgStages}
          formAssessedAt={assessedAt}
          setFormAssessedAt={setAssessedAt}
          formBG={bg}
          setFormBG={setBg}
          formPH={ph}
          setFormPH={setPh}
          formAssessedBy={assessedBy}
          setFormAssessedBy={setAssessedBy}
          formNotes={notes}
          setFormNotes={setNotes}
          formBoneAge={boneAge}
          setFormBoneAge={setBoneAge}
          formBodyFat={bodyFat}
          setFormBodyFat={setBodyFat}
        />
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? '保存中…' : '保存评估'}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}
