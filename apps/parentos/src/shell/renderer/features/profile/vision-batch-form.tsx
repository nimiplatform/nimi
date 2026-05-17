import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { deleteMeasurement, insertMeasurement, updateMeasurement } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  analyzeCheckupSheetOCR,
  readImageFileAsDataUrl,
  type OCRMeasurementCandidate,
} from './checkup-ocr.js';
import {
  EYE_SET, FORM_SECTIONS, PUPIL_OPTIONS, getPickerConfig,
  type VisionRecord,
} from './vision-data.js';
import {
  CancelButton,
  ChipGroup,
  type ChipOption,
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
} from './health-record-modal-shell.js';

const NOTE_PREFIXES = {
  hospital: '医院: ',
  doctor: '医生: ',
  pupil: '瞳孔: ',
  screenTime: '日近距离用眼: ',
  outdoorTime: '日户外: ',
  controls: '防控: ',
} as const;

type VisionRecordNoteDraft = {
  hospital: string;
  doctor: string;
  pupil: string;
  screenTime: string;
  outdoorTime: string;
  controls: string;
  notes: string;
  perTypeNotes: Record<string, string>;
};

function parseVisionRecordNoteDraft(record?: VisionRecord): VisionRecordNoteDraft {
  if (!record) {
    return {
      hospital: '',
      doctor: '',
      pupil: '',
      screenTime: '',
      outdoorTime: '',
      controls: '',
      notes: '',
      perTypeNotes: {},
    };
  }

  const rows = [...record.measurementsByType.values()];
  const extrasByType = new Map<string, string[]>();
  const unknownTokenSets: Array<Set<string>> = [];
  let hospital = '';
  let doctor = '';
  let pupil = '';
  let screenTime = '';
  let outdoorTime = '';
  let controls = '';

  for (const row of rows) {
    const extras: string[] = [];
    const tokens = (row.notes ?? '')
      .split(' | ')
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of tokens) {
      if (token.startsWith(NOTE_PREFIXES.hospital)) {
        hospital ||= token.slice(NOTE_PREFIXES.hospital.length).trim();
        continue;
      }
      if (token.startsWith(NOTE_PREFIXES.doctor)) {
        doctor ||= token.slice(NOTE_PREFIXES.doctor.length).trim();
        continue;
      }
      if (token.startsWith(NOTE_PREFIXES.pupil)) {
        pupil ||= token.slice(NOTE_PREFIXES.pupil.length).trim();
        continue;
      }
      if (token.startsWith(NOTE_PREFIXES.screenTime)) {
        screenTime ||= token.slice(NOTE_PREFIXES.screenTime.length).trim();
        continue;
      }
      if (token.startsWith(NOTE_PREFIXES.outdoorTime)) {
        outdoorTime ||= token.slice(NOTE_PREFIXES.outdoorTime.length).trim();
        continue;
      }
      if (token.startsWith(NOTE_PREFIXES.controls)) {
        controls ||= token.slice(NOTE_PREFIXES.controls.length).trim();
        continue;
      }
      extras.push(token);
    }

    extrasByType.set(row.typeId, extras);
    unknownTokenSets.push(new Set(extras));
  }

  let commonExtras = rows.length > 0 ? [...(unknownTokenSets[0] ?? new Set<string>())] : [];
  for (const tokens of unknownTokenSets.slice(1)) {
    commonExtras = commonExtras.filter((token) => tokens.has(token));
  }
  if (rows.length === 1 && rows[0]?.source === 'ocr') {
    commonExtras = [];
  }

  const perTypeNotes: Record<string, string> = {};
  for (const [typeId, extras] of extrasByType) {
    const uniqueExtras = extras.filter((token) => !commonExtras.includes(token));
    if (uniqueExtras.length > 0) {
      perTypeNotes[typeId] = uniqueExtras.join(' | ');
    }
  }

  return {
    hospital,
    doctor,
    pupil,
    screenTime,
    outdoorTime,
    controls,
    notes: commonExtras.join(' | '),
    perTypeNotes,
  };
}

/* ================================================================
   NUMBER PICKER — two-step integer + decimal selector
   ================================================================ */

export function NumberPickerPopover({ typeId, label, unit, value, onSelect, onClose }: {
  typeId: string; label: string; unit: string; value: string;
  onSelect: (val: string) => void; onClose: () => void;
}) {
  const cfg = getPickerConfig(typeId);
  const [intPart, setIntPart] = useState<number | null>(() => {
    if (value) { const n = parseFloat(value); return isNaN(n) ? null : Math.floor(n); }
    return null;
  });
  const [step, setStep] = useState<'int' | 'dec'>(value ? 'dec' : 'int');

  if (!cfg) return null;

  const { intRange, decimals } = cfg;
  const ints: number[] = [];
  for (let i = intRange[0]; i <= intRange[1]; i++) ints.push(i);

  const handleIntSelect = (n: number) => {
    setIntPart(n);
    if (decimals.length === 0) {
      onSelect(String(n));
      onClose();
    } else {
      setStep('dec');
    }
  };

  const handleDecSelect = (d: number) => {
    const int = intPart ?? 0;
    const decStr = d < 10 ? `0${d}` : String(d);
    const val = decimals.some((x) => x >= 10) ? `${int}.${decStr}` : `${int}.${d}`;
    onSelect(val);
    onClose();
  };

  const eyeLabel = typeId.includes('right') ? 'OD R' : typeId.includes('left') ? 'OS L' : '';

  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl shadow-2xl animate-slide-up" style={{ background: '#f0f0ec' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: '#e0e4e0' }}>
          {step === 'dec' && (
            <button onClick={() => setStep('int')} className="text-[14px] font-medium" style={{ color: HEALTH_MODAL_TOKENS.accent }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline -mt-0.5 mr-1"><path d="M15 18l-6-6 6-6" /></svg>
              返回
            </button>
          )}
          {step === 'int' && <span />}
          <div className="text-center flex-1">
            {eyeLabel && <span className="text-[14px] font-bold mr-2" style={{ color: '#e67e22' }}>{eyeLabel}</span>}
            <span className="text-[16px] font-bold" style={{ color: HEALTH_MODAL_TOKENS.text }}>{label}</span>
            {unit && <span className="text-[13px] ml-1.5" style={{ color: HEALTH_MODAL_TOKENS.sub }}>{unit}</span>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: HEALTH_MODAL_TOKENS.sub }}>✕</button>
        </div>

        {(intPart != null || value) && (
          <div className="text-center py-2">
            <span className="text-[20px] font-bold" style={{ color: HEALTH_MODAL_TOKENS.text }}>
              {intPart != null ? `${intPart}.` : value}
            </span>
          </div>
        )}

        <div className="px-3 pb-4 max-h-[320px] overflow-y-auto">
          {step === 'int' ? (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(ints.length, 6)}, 1fr)` }}>
              {ints.map((n) => (
                <button key={n} onClick={() => handleIntSelect(n)}
                  className={`py-3 text-[16px] font-semibold rounded-xl transition-all ${intPart === n ? 'text-white' : 'hover:bg-white'}`}
                  style={intPart === n ? { background: HEALTH_MODAL_TOKENS.accent, color: '#fff' } : { background: '#fafafa', color: HEALTH_MODAL_TOKENS.text }}>
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(decimals.length, 10)}, 1fr)` }}>
              {decimals.map((d) => (
                <button key={d} onClick={() => handleDecSelect(d)}
                  className="py-3 text-[16px] font-semibold rounded-xl transition-all hover:bg-white"
                  style={{ background: '#fafafa', color: HEALTH_MODAL_TOKENS.text }}>
                  {d < 10 && decimals.some((x) => x >= 10) ? `0${d}` : String(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 pb-4">
          <input type="number" placeholder="或手动输入..." value={value}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2 text-[14px] border-0 outline-none"
            style={{ background: '#fff', color: HEALTH_MODAL_TOKENS.text }} />
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-[14px] font-medium text-white"
            style={{ background: HEALTH_MODAL_TOKENS.accent }}>确定</button>
        </div>
      </div>
    </div>
  );
}

export function ValueCell({ typeId, label, unit, value, onChange }: {
  typeId: string; label: string; unit: string; value: string; onChange: (v: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const hasPicker = getPickerConfig(typeId) != null;

  return (
    <>
      {hasPicker ? (
        <button onClick={() => setShowPicker(true)}
          className="w-full text-center text-[14px] font-medium rounded-lg py-1.5 transition-all hover:ring-2 hover:ring-[#BDE0F5]/30"
          style={{ background: value ? '#eef3ee' : '#f5f3ef', color: value ? HEALTH_MODAL_TOKENS.text : '#c0bdb8' }}>
          {value || '—'}
        </button>
      ) : (
        <input type="number" placeholder="—" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full text-center text-[14px] font-medium rounded-lg py-1.5 border-0 outline-none focus:ring-2 focus:ring-[#BDE0F5]/30"
          style={{ background: '#f5f3ef', color: HEALTH_MODAL_TOKENS.text }} />
      )}
      {showPicker && (
        <NumberPickerPopover typeId={typeId} label={label} unit={unit} value={value}
          onSelect={onChange} onClose={() => setShowPicker(false)} />
      )}
    </>
  );
}

/* ================================================================
   BATCH INPUT FORM
   ================================================================ */

type VisionBatchFormProps = {
  childId: string;
  birthDate: string;
  onSave: () => void;
  onClose: () => void;
  initialRecord?: VisionRecord;
  ocrDraft?: OCRMeasurementCandidate[] | null;
};

export function BatchForm(props: VisionBatchFormProps) {
  return (
    <HealthRecordModalShell open size="XL" onClose={props.onClose}>
      <VisionBatchFormContent {...props} />
    </HealthRecordModalShell>
  );
}

const SCREEN_TIME_OPTIONS = ['0-1小时', '2-3小时', '4-5小时', '6小时以上'] as const;
const OUTDOOR_TIME_OPTIONS = ['0-1小时', '2-3小时', '4-5小时', '5小时以上'] as const;

export function VisionBatchFormContent({ childId, birthDate, onSave, onClose, initialRecord, ocrDraft }: VisionBatchFormProps) {
  const { t } = useTranslation();
  const initVals: Record<string, string> = {};
  if (initialRecord) { for (const [k, v] of initialRecord.data) initVals[k] = String(v); }
  const initialNoteDraft = parseVisionRecordNoteDraft(initialRecord);
  const [date, setDate] = useState(initialRecord?.date ?? new Date().toISOString().slice(0, 10));
  const [hospital, setHospital] = useState(initialNoteDraft.hospital);
  const [doctor, setDoctor] = useState(initialNoteDraft.doctor);
  const [pupil, setPupil] = useState<string>(initialNoteDraft.pupil);
  const [values, setValues] = useState<Record<string, string>>(initVals);
  const [hrValue, setHrValue] = useState(initVals['hyperopia-reserve'] ?? '');
  const [screenTime, setScreenTime] = useState(initialNoteDraft.screenTime);
  const [outdoorTime, setOutdoorTime] = useState(initialNoteDraft.outdoorTime);
  const [controls, setControls] = useState(initialNoteDraft.controls);
  const [notes, setNotes] = useState(initialNoteDraft.notes);
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOCRError] = useState<string | null>(null);
  const [ocrImportedTypes, setOCRImportedTypes] = useState<Set<string>>(new Set());
  const [ocrNotesByType, setOCRNotesByType] = useState<Record<string, string>>({});

  const set = (typeId: string, val: string) => setValues((prev) => ({ ...prev, [typeId]: val }));

  const applyOCRMeasurements = useCallback((measurements: OCRMeasurementCandidate[]) => {
    const eyeMeasurements = measurements.filter((measurement) => EYE_SET.has(measurement.typeId));
    if (eyeMeasurements.length === 0) {
      setOCRError(t('Profile.rich.vision.ocrNoData'));
      return;
    }

    setValues((prev) => {
      const next = { ...prev };
      for (const measurement of eyeMeasurements) {
        next[measurement.typeId] = String(measurement.value);
      }
      return next;
    });
    setDate((prev) => eyeMeasurements[0]?.measuredAt ?? prev);
    setOCRError(null);
    setOCRImportedTypes((prev) => {
      const next = new Set(prev);
      for (const measurement of eyeMeasurements) {
        next.add(measurement.typeId);
      }
      return next;
    });
    setOCRNotesByType((prev) => {
      const next = { ...prev };
      for (const measurement of eyeMeasurements) {
        if (measurement.notes) {
          next[measurement.typeId] = measurement.notes;
        }
      }
      return next;
    });
  }, [t]);

  useEffect(() => {
    if (!ocrDraft || ocrDraft.length === 0) return;
    applyOCRMeasurements(ocrDraft);
  }, [applyOCRMeasurements, ocrDraft]);

  const joinNoteParts = (...parts: Array<string | null | undefined>) => {
    const seen = new Set<string>();
    const normalized = parts
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const deduped = normalized.filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    });
    return deduped.length > 0 ? deduped.join(' | ') : null;
  };

  const handleOCR = async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setOcrBusy(true);
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const result = await analyzeCheckupSheetOCR({ imageUrl: dataUrl });
        applyOCRMeasurements(result.measurements);
      } catch (error) {
        setOCRError(error instanceof Error ? error.message : t('Profile.rich.vision.ocrFailed'));
      }
      setOcrBusy(false);
    };
    input.click();
  };

  const handleSubmit = async () => {
    setSaving(true);
    const nextAgeMonths = computeAgeMonthsAt(birthDate, date);
    const nextNow = isoNow();
    const nextEntries = Object.entries(values).filter(([, value]) => value.trim() !== '');
    if (hrValue.trim()) nextEntries.push(['hyperopia-reserve', hrValue.trim()]);

    const nextNoteParts: string[] = [];
    if (hospital) nextNoteParts.push(`${NOTE_PREFIXES.hospital}${hospital}`);
    if (doctor) nextNoteParts.push(`${NOTE_PREFIXES.doctor}${doctor}`);
    if (pupil) nextNoteParts.push(`${NOTE_PREFIXES.pupil}${pupil}`);
    if (screenTime) nextNoteParts.push(`${NOTE_PREFIXES.screenTime}${screenTime}`);
    if (outdoorTime) nextNoteParts.push(`${NOTE_PREFIXES.outdoorTime}${outdoorTime}`);
    if (controls) nextNoteParts.push(`${NOTE_PREFIXES.controls}${controls}`);
    if (notes) nextNoteParts.push(notes);
    const nextNoteStr = nextNoteParts.length > 0 ? nextNoteParts.join(' | ') : null;

    try {
      const existingByType = new Map(initialRecord?.measurementsByType ?? []);
      const nextTypeIds = new Set(nextEntries.map(([typeId]) => typeId));

      for (const [typeId, measurement] of existingByType) {
        if (!nextTypeIds.has(typeId)) {
          await deleteMeasurement(measurement.measurementId);
        }
      }

      for (const [typeId, rawValue] of nextEntries) {
        const parsedValue = parseFloat(rawValue);
        if (Number.isNaN(parsedValue)) continue;

        const existing = existingByType.get(typeId);
        const measurementNotes = joinNoteParts(
          nextNoteStr,
          initialNoteDraft.perTypeNotes[typeId],
          ocrNotesByType[typeId],
        );
        const source = ocrImportedTypes.has(typeId) ? 'ocr' : (existing?.source ?? 'manual');

        if (existing) {
          await updateMeasurement({
            measurementId: existing.measurementId,
            value: parsedValue,
            measuredAt: date,
            ageMonths: nextAgeMonths,
            percentile: existing.percentile,
            source,
            notes: measurementNotes,
            now: nextNow,
          });
          continue;
        }

        try {
          await insertMeasurement({
            measurementId: ulid(),
            childId,
            typeId,
            value: parsedValue,
            measuredAt: date,
            ageMonths: nextAgeMonths,
            percentile: null,
            source,
            notes: measurementNotes,
            now: nextNow,
          });
        } catch {
          /* duplicate or bridge error */
        }
      }

      onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const filledCount = Object.values(values).filter((v) => v.trim()).length + (hrValue.trim() ? 1 : 0);

  const pupilChips: ChipOption<string>[] = PUPIL_OPTIONS.map((p) => ({ value: p, label: p }));
  const screenChips: ChipOption<string>[] = SCREEN_TIME_OPTIONS.map((opt) => ({ value: opt, label: opt }));
  const outdoorChips: ChipOption<string>[] = OUTDOOR_TIME_OPTIONS.map((opt) => ({ value: opt, label: opt }));

  const ocrButton = (
    <button
      onClick={() => void handleOCR()}
      disabled={ocrBusy}
      className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
      style={{ background: HEALTH_MODAL_TOKENS.accent }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 8h4M7 12h10M7 16h6" />
      </svg>
      {ocrBusy ? t('Profile.rich.vision.recognizing') : t('Profile.rich.vision.smartRecognize')}
    </button>
  );

  return (
    <>
      <ModalHeader
        title={initialRecord ? t('Profile.rich.visionBatch.editTitle', { date: initialRecord.date }) : t('Profile.rich.visionBatch.createTitle')}
        icon="👁️"
        onClose={onClose}
        trailing={ocrButton}
      />
      <ModalContent>
        <div className="space-y-5">
          {ocrError ? <InlineError>{ocrError}</InlineError> : null}

          <FormGrid cols={2}>
            <FormField label={t('Profile.rich.visionBatch.examDate')} required>
              <DateField value={date} onChange={setDate} />
            </FormField>
            <FormField label={t('Profile.rich.visionBatch.pupilStatus')}>
              <ChipGroup options={pupilChips} value={pupil} onChange={setPupil} layout="fill" clearable />
            </FormField>
          </FormGrid>

          <FormGrid cols={2}>
            <FormField label={t('Profile.rich.visionBatch.hospital')}>
              <Input
                value={hospital}
                onChange={(event) => setHospital(event.target.value)}
                placeholder={t('Profile.rich.common.optional')}
              />
            </FormField>
            <FormField label={t('Profile.rich.visionBatch.doctor')}>
              <Input
                value={doctor}
                onChange={(event) => setDoctor(event.target.value)}
                placeholder={t('Profile.rich.common.optional')}
              />
            </FormField>
          </FormGrid>

          {FORM_SECTIONS.map((section) => (
            <SectionCard key={section.title} title={section.title}>
              <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: '#f1f5f9' }}>
                <div
                  className="grid grid-cols-[1.5fr_1fr_1fr] px-3 py-2 text-center text-[12px] font-medium"
                  style={{ background: '#f8faf9', color: HEALTH_MODAL_TOKENS.sub }}
                >
                  <span className="text-left">{t('Profile.rich.visionBatch.item')}</span>
                  <span>{t('Profile.rich.visionBatch.od')}</span>
                  <span>{t('Profile.rich.visionBatch.os')}</span>
                </div>
                {section.fields.map((f, i) => (
                  <div
                    key={f.label}
                    className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 border-t px-3 py-2"
                    style={{ borderColor: '#f0f0ec', background: i % 2 === 0 ? '#ffffff' : '#fafcfb' }}
                  >
                    <div>
                      <span className="text-[13px]" style={{ color: HEALTH_MODAL_TOKENS.text }}>{f.label}</span>
                      {f.unit && <span className="ml-1 text-[12px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>({f.unit})</span>}
                    </div>
                    <ValueCell typeId={f.od} label={f.label} unit={f.unit} value={values[f.od] ?? ''} onChange={(v) => set(f.od, v)} />
                    <ValueCell typeId={f.os} label={f.label} unit={f.unit} value={values[f.os] ?? ''} onChange={(v) => set(f.os, v)} />
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}

          <SectionCard title={t('Profile.rich.visionBatch.hyperopiaReserve')}>
            <div className="flex items-center gap-3">
              <div className="w-32">
                <ValueCell typeId="hyperopia-reserve" label={t('Profile.rich.visionBatch.hyperopiaReserve')} unit="D" value={hrValue} onChange={setHrValue} />
              </div>
              <span className="text-[13px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>D</span>
            </div>
          </SectionCard>

          <SectionCard title={t('Profile.rich.visionBatch.behaviorFactors')}>
            <FormGrid cols={2}>
              <FormField label={t('Profile.rich.visionBatch.nearWorkDaily')}>
                <ChipGroup options={screenChips} value={screenTime} onChange={setScreenTime} layout="wrap" clearable size="sm" />
              </FormField>
              <FormField label={t('Profile.rich.visionBatch.outdoorDaily')}>
                <ChipGroup options={outdoorChips} value={outdoorTime} onChange={setOutdoorTime} layout="wrap" clearable size="sm" />
              </FormField>
            </FormGrid>
          </SectionCard>

          <FormGrid cols={2}>
            <FormField label={t('Profile.rich.visionBatch.controlMeasures')}>
              <Input
                value={controls}
                onChange={(event) => setControls(event.target.value)}
                placeholder={t('Profile.rich.visionBatch.controlMeasuresPlaceholder')}
              />
            </FormField>
            <FormField label={t('Profile.rich.visionBatch.controlNotes')}>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t('Profile.rich.visionBatch.controlNotesPlaceholder')}
              />
            </FormField>
          </FormGrid>
        </div>
      </ModalContent>
      <ModalFooter
        leading={
          <span className="text-[13px]" style={{ color: HEALTH_MODAL_TOKENS.sub }}>
            {t('Profile.rich.common.itemsFilled', { count: filledCount })}
          </span>
        }
      >
        <CancelButton onClick={onClose}>{t('Profile.rich.common.cancel')}</CancelButton>
        <PrimaryButton
          onClick={() => void handleSubmit()}
          disabled={saving || filledCount === 0}
          ariaLabel="vision-record-save"
        >
          {saving ? t('Profile.rich.common.saving') : t('Profile.rich.visionBatch.saveRecord')}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}

