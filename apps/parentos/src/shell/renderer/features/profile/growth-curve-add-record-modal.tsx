import { useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMeasurement, saveAttachment } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { bmiLabel, computeBMI } from './growth-curve-page-shared.js';
import { PhotoGrid, type PendingPhoto } from './photo-grid.js';

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

  const inputCls = `w-full ${S.radiusSm} px-3 py-2 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`;
  const inputSty = {
    borderColor: S.border,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    background: '#fafaf8',
  };

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
    <div className="flex flex-col w-full max-h-[85vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]">📏</span>
          <h3 className="text-[16px] font-bold" style={{ color: S.text }}>添加记录</h3>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]"
          style={{ color: S.sub }}
        >
          ✕
        </button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">
        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>测量日期</label>
          <ProfileDatePicker value={formDate} onChange={setFormDate} className={inputCls} style={inputSty} />
        </div>

        <div className={`grid gap-3 ${isUnder6 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>身高 (cm)</label>
            <input
              type="number"
              step="0.1"
              placeholder="120.5"
              value={formHeight}
              onChange={(event) => setFormHeight(event.target.value)}
              className={inputCls}
              style={inputSty}
            />
          </div>
          <div>
            <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>体重 (kg)</label>
            <input
              type="number"
              step="0.01"
              placeholder="22.5"
              value={formWeight}
              onChange={(event) => setFormWeight(event.target.value)}
              className={inputCls}
              style={inputSty}
            />
          </div>
          {isUnder6 ? (
            <div>
              <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>头围 (cm)</label>
              <input
                type="number"
                step="0.1"
                placeholder="48.0"
                value={formHeadCirc}
                onChange={(event) => setFormHeadCirc(event.target.value)}
                className={inputCls}
                style={inputSty}
              />
            </div>
          ) : null}
        </div>

        <div
          className={`${S.radiusSm} px-3 py-2 flex items-center gap-2`}
          style={{
            background: hasBMI ? '#f0fdf4' : '#fafaf8',
            border: `1px solid ${hasBMI ? '#bbf7d0' : S.border}`,
            transition: 'all 0.2s',
          }}
        >
          <span className="text-[13px] font-medium" style={{ color: S.sub }}>BMI 自动计算</span>
          {hasBMI && bmi != null && bmiMeta ? (
            <>
              <span className="text-[16px] font-bold ml-auto" style={{ color: bmiMeta.color }}>{bmi}</span>
              <span className="text-[13px] font-medium" style={{ color: bmiMeta.color }}>{bmiMeta.tag}</span>
            </>
          ) : (
            <span className="text-[14px] ml-auto" style={{ color: '#c4c4c4' }}>--</span>
          )}
        </div>

        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
          <textarea
            value={formNotes}
            onChange={(event) => setFormNotes(event.target.value)}
            placeholder="记录一些观察..."
            className={`${inputCls} resize-none`}
            rows={2}
            style={inputSty}
          />
        </div>

        <div>
          <label className="text-[13px] mb-1 block font-medium" style={{ color: S.sub }}>
            照片 {formPhotos.length > 0 ? `(${formPhotos.length}/9)` : ''}
          </label>
          <PhotoGrid
            photos={formPhotos}
            maxPhotos={9}
            hint="点击或拖拽上传照片（最多 9 张）"
            onChange={setFormPhotos}
          />
        </div>
      </div>

      <div className="px-6 pt-3 pb-5 mt-1">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`}
            style={{ background: '#f0f0ec', color: S.sub }}
          >
            取消
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110 disabled:opacity-50`}
            style={{ background: S.accent }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--nimi-scrim-modal)' }}
      onClick={onClose}
    >
      <div
        className={`w-[440px] ${S.radius} shadow-xl flex flex-col`}
        style={{ background: S.card }}
        onClick={(event) => event.stopPropagation()}
      >
        <GrowthAddRecordContent
          childId={childId}
          birthDate={birthDate}
          isUnder6={isUnder6}
          onSaved={onSaved}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
