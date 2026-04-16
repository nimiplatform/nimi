import { useRef, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { bmiLabel, computeBMI } from './growth-curve-page-shared.js';

type GrowthCurveAddRecordModalProps = {
  formDate: string;
  setFormDate: (value: string) => void;
  formHeight: string;
  setFormHeight: (value: string) => void;
  formWeight: string;
  setFormWeight: (value: string) => void;
  formHeadCirc: string;
  setFormHeadCirc: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
  formPhotoPreview: string | null;
  isUnder6: boolean;
  onPhotoChange: (file: File | null) => void;
  onSave: () => void;
  onClose: () => void;
};

export function GrowthCurveAddRecordModal({
  formDate,
  setFormDate,
  formHeight,
  setFormHeight,
  formWeight,
  setFormWeight,
  formHeadCirc,
  setFormHeadCirc,
  formNotes,
  setFormNotes,
  formPhotoPreview,
  isUnder6,
  onPhotoChange,
  onSave,
  onClose,
}: GrowthCurveAddRecordModalProps) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const dropActive = dragOver || dropHover;

  const height = formHeight ? parseFloat(formHeight) : NaN;
  const weight = formWeight ? parseFloat(formWeight) : NaN;
  const hasBMI = height > 0 && weight > 0;
  const bmi = hasBMI ? computeBMI(height, weight) : null;
  const bmiMeta = bmi != null ? bmiLabel(bmi) : null;

  const inputCls = `w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50`;
  const inputSty = {
    borderColor: S.border,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    background: '#fafaf8',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.25)' }}
      onClick={onClose}
    >
      <div
        className={`w-[440px] max-h-[85vh] overflow-y-auto ${S.radius} shadow-xl flex flex-col`}
        style={{ background: S.card }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">📏</span>
            <h3 className="text-[15px] font-bold" style={{ color: S.text }}>添加记录</h3>
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
            <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>测量日期</label>
            <ProfileDatePicker value={formDate} onChange={setFormDate} className={inputCls} style={inputSty} />
          </div>

          <div className={`grid gap-3 ${isUnder6 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div>
              <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>身高 (cm)</label>
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
              <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>体重 (kg)</label>
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
                <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>头围 (cm)</label>
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
            <span className="text-[11px] font-medium" style={{ color: S.sub }}>BMI 自动计算</span>
            {hasBMI && bmi != null && bmiMeta ? (
              <>
                <span className="text-[14px] font-bold ml-auto" style={{ color: bmiMeta.color }}>{bmi}</span>
                <span className="text-[11px] font-medium" style={{ color: bmiMeta.color }}>{bmiMeta.tag}</span>
              </>
            ) : (
              <span className="text-[13px] ml-auto" style={{ color: '#c4c4c4' }}>--</span>
            )}
          </div>

          <div>
            <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
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
            <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>照片</label>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                onPhotoChange(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
            {formPhotoPreview ? (
              <div className="relative group">
                <img src={formPhotoPreview} alt="preview" className={`w-full h-28 object-cover ${S.radiusSm}`} />
                <button
                  onClick={() => onPhotoChange(null)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                onMouseEnter={() => setDropHover(true)}
                onMouseLeave={() => setDropHover(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  const file = event.dataTransfer.files[0];
                  if (file?.type.startsWith('image/')) onPhotoChange(file);
                }}
                className={`w-full h-24 ${S.radiusSm} flex flex-col items-center justify-center gap-1.5 cursor-pointer`}
                style={{
                  border: `2px dashed ${dropActive ? '#4ECCA3' : '#d0d0cc'}`,
                  background: '#fafaf8',
                  transition: 'border-color 0.25s ease',
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  style={{
                    stroke: dropActive ? '#1e293b' : '#b0b0aa',
                    transform: dropActive ? 'scale(1.15)' : 'scale(1)',
                    transition: 'stroke 0.25s ease, transform 0.25s ease',
                  }}
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span
                  className="text-[11px]"
                  style={{
                    color: dropActive ? '#1e293b' : '#a0a0a0',
                    transition: 'color 0.25s ease',
                  }}
                >
                  点击或拖拽上传照片
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="px-6 pt-3 pb-5 mt-1">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`}
              style={{ background: '#f0f0ec', color: S.sub }}
            >
              取消
            </button>
            <button
              onClick={onSave}
              className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`}
              style={{ background: S.accent }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
