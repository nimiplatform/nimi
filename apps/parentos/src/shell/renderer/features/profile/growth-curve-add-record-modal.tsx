import { useState } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMeasurement, saveAttachment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { bmiLabel, computeBMI } from './growth-curve-page-shared.js';
import { PhotoGrid, type PendingPhoto } from './photo-grid.js';
import {
  CancelButton,
  DateField,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  Input,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  TextArea,
  UploadBox,
} from './health-record-modal-shell.js';

type GrowthAddRecordContentProps = {
  childId: string;
  birthDate: string;
  isUnder6: boolean;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function GrowthAddRecordContent({
  childId,
  birthDate,
  isUnder6,
  onSaved,
  onClose,
}: GrowthAddRecordContentProps) {
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formHeight, setFormHeight] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formHeadCirc, setFormHeadCirc] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotos, setFormPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const height = formHeight ? parseFloat(formHeight) : NaN;
  const weight = formWeight ? parseFloat(formWeight) : NaN;
  const hasBMI = height > 0 && weight > 0;
  const bmi = hasBMI ? computeBMI(height, weight) : null;
  const bmiMeta = bmi != null ? bmiLabel(bmi) : null;

  const handleSave = async () => {
    if (!formDate) return;
    const h = formHeight ? parseFloat(formHeight) : null;
    const w = formWeight ? parseFloat(formWeight) : null;
    const hc = formHeadCirc ? parseFloat(formHeadCirc) : null;
    if (h === null && w === null && hc === null) return;

    const age = computeAgeMonthsAt(birthDate, formDate);
    const now = isoNow();
    const notes = formNotes.trim() || null;

    setSaving(true);
    try {
      let photoOwnerId: string | null = null;
      if (h != null) {
        const id = ulid();
        await insertMeasurement({ measurementId: id, childId, typeId: 'height', value: h, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
        photoOwnerId = photoOwnerId ?? id;
      }
      if (w != null) {
        const id = ulid();
        await insertMeasurement({ measurementId: id, childId, typeId: 'weight', value: w, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
        photoOwnerId = photoOwnerId ?? id;
      }
      if (hc != null) {
        const id = ulid();
        await insertMeasurement({ measurementId: id, childId, typeId: 'head-circumference', value: hc, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
        photoOwnerId = photoOwnerId ?? id;
      }
      if (h != null && w != null) {
        const bmiValue = computeBMI(h, w);
        await insertMeasurement({ measurementId: ulid(), childId, typeId: 'bmi', value: bmiValue, measuredAt: formDate, ageMonths: age, percentile: null, source: 'computed', notes: null, now });
      }

      if (photoOwnerId && formPhotos.length > 0) {
        for (const photo of formPhotos) {
          await saveAttachment({
            attachmentId: ulid(),
            childId,
            ownerTable: 'measurements',
            ownerId: photoOwnerId,
            fileName: photo.fileName,
            mimeType: photo.mimeType,
            imageBase64: photo.base64,
            caption: null,
            now,
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
      <ModalHeader title="添加生长记录" icon="📏" onClose={onClose} />
      <ModalContent>
        <div className="space-y-5">
          <FormField label="测量日期">
            <DateField value={formDate} onChange={setFormDate} />
          </FormField>

          <FormGrid cols={isUnder6 ? 3 : 2}>
            <FormField label="身高 (cm)">
              <Input
                type="number"
                step="0.1"
                placeholder="120.5"
                value={formHeight}
                onChange={(event) => setFormHeight(event.target.value)}
              />
            </FormField>
            <FormField label="体重 (kg)">
              <Input
                type="number"
                step="0.01"
                placeholder="22.5"
                value={formWeight}
                onChange={(event) => setFormWeight(event.target.value)}
              />
            </FormField>
            {isUnder6 ? (
              <FormField label="头围 (cm)">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="48.0"
                  value={formHeadCirc}
                  onChange={(event) => setFormHeadCirc(event.target.value)}
                />
              </FormField>
            ) : null}
          </FormGrid>

          <div
            className={cn(
              'flex min-h-[44px] items-center gap-2 rounded-2xl border px-4 transition-colors',
              hasBMI
                ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))]'
                : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
            )}
          >
            <span className="text-[13px] font-medium text-[var(--nimi-text-muted)]">
              BMI 自动计算
            </span>
            {hasBMI && bmi != null && bmiMeta ? (
              <>
                <span className={`ml-auto text-[16px] font-bold ${bmiToneClassName(bmiMeta.tag)}`}>
                  {bmi}
                </span>
                <span className={`text-[13px] font-medium ${bmiToneClassName(bmiMeta.tag)}`}>
                  {bmiMeta.tag}
                </span>
              </>
            ) : (
              <span className="ml-auto text-[14px] text-[var(--nimi-text-muted)]">
                --
              </span>
            )}
          </div>

          <FormField label="备注">
            <TextArea
              rows={2}
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
              placeholder="记录一些观察..."
            />
          </FormField>

          <FormField label={`照片${formPhotos.length > 0 ? ` (${formPhotos.length}/9)` : ''}`}>
            <UploadBox>
              <PhotoGrid
                photos={formPhotos}
                maxPhotos={9}
                hint="点击或拖拽上传照片（最多 9 张）"
                onChange={setFormPhotos}
              />
            </UploadBox>
          </FormField>
        </div>
      </ModalContent>
      <ModalFooter>
        <CancelButton onClick={onClose} />
        <PrimaryButton onClick={() => void handleSave()} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}

function bmiToneClassName(tag: string): string {
  if (tag.includes('偏轻')) return 'text-[var(--nimi-status-info)]';
  if (tag.includes('正常')) return 'text-[var(--nimi-status-success)]';
  if (tag.includes('偏重')) return 'text-[var(--nimi-status-warning)]';
  return 'text-[var(--nimi-status-danger)]';
}

type GrowthCurveAddRecordModalProps = {
  childId: string;
  birthDate: string;
  isUnder6: boolean;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

export function GrowthCurveAddRecordModal({
  childId,
  birthDate,
  isUnder6,
  onSaved,
  onClose,
}: GrowthCurveAddRecordModalProps) {
  return (
    <HealthRecordModalShell open size="M" onClose={onClose}>
      <GrowthAddRecordContent
        childId={childId}
        birthDate={birthDate}
        isUnder6={isUnder6}
        onSaved={onSaved}
        onClose={onClose}
      />
    </HealthRecordModalShell>
  );
}
