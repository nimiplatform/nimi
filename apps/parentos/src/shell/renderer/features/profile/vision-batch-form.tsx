import { useState } from 'react';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMeasurement } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { analyzeCheckupSheetOCR, readImageFileAsDataUrl } from './checkup-ocr.js';
import {
  EYE_SET, FORM_SECTIONS, PUPIL_OPTIONS, getPickerConfig,
  type VisionRecord,
} from './vision-data.js';

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
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl shadow-2xl animate-slide-up" style={{ background: '#f0f0ec' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ background: '#e0e4e0' }}>
          {step === 'dec' && (
            <button onClick={() => setStep('int')} className="text-[12px] font-medium" style={{ color: S.accent }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline -mt-0.5 mr-1"><path d="M15 18l-6-6 6-6" /></svg>
              返回
            </button>
          )}
          {step === 'int' && <span />}
          <div className="text-center flex-1">
            {eyeLabel && <span className="text-[12px] font-bold mr-2" style={{ color: '#e67e22' }}>{eyeLabel}</span>}
            <span className="text-[15px] font-bold" style={{ color: S.text }}>{label}</span>
            {unit && <span className="text-[11px] ml-1.5" style={{ color: S.sub }}>{unit}</span>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: S.sub }}>✕</button>
        </div>

        {/* Current value display */}
        {(intPart != null || value) && (
          <div className="text-center py-2">
            <span className="text-[20px] font-bold" style={{ color: S.text }}>
              {intPart != null ? `${intPart}.` : value}
            </span>
          </div>
        )}

        {/* Grid */}
        <div className="px-3 pb-4 max-h-[320px] overflow-y-auto">
          {step === 'int' ? (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(ints.length, 6)}, 1fr)` }}>
              {ints.map((n) => (
                <button key={n} onClick={() => handleIntSelect(n)}
                  className={`py-3 text-[16px] font-semibold rounded-xl transition-all ${intPart === n ? 'text-white' : 'hover:bg-white'}`}
                  style={intPart === n ? { background: S.accent, color: '#fff' } : { background: '#fafafa', color: S.text }}>
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(decimals.length, 10)}, 1fr)` }}>
              {decimals.map((d) => (
                <button key={d} onClick={() => handleDecSelect(d)}
                  className="py-3 text-[15px] font-semibold rounded-xl transition-all hover:bg-white"
                  style={{ background: '#fafafa', color: S.text }}>
                  {d < 10 && decimals.some((x) => x >= 10) ? `0${d}` : String(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Manual input fallback */}
        <div className="flex items-center gap-2 px-4 pb-4">
          <input type="number" placeholder="或手动输入..." value={value}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2 text-[13px] border-0 outline-none"
            style={{ background: '#fff', color: S.text }} />
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-[12px] font-medium text-white"
            style={{ background: S.accent }}>确定</button>
        </div>
      </div>
    </div>
  );
}

/* ── Clickable value cell (shows picker on click) ──────── */

export function ValueCell({ typeId, label, unit, value, onChange }: {
  typeId: string; label: string; unit: string; value: string; onChange: (v: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const hasPicker = getPickerConfig(typeId) != null;

  return (
    <>
      {hasPicker ? (
        <button onClick={() => setShowPicker(true)}
          className="w-full text-center text-[13px] font-medium rounded-lg py-1.5 transition-all hover:ring-2 hover:ring-[#86AFDA]/30"
          style={{ background: value ? '#eef3ee' : '#f5f3ef', color: value ? S.text : '#c0bdb8' }}>
          {value || '—'}
        </button>
      ) : (
        <input type="number" placeholder="—" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full text-center text-[13px] font-medium rounded-lg py-1.5 border-0 outline-none focus:ring-2 focus:ring-[#86AFDA]/30"
          style={{ background: '#f5f3ef', color: S.text }} />
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

export function BatchForm({ childId, birthDate, onSave, onClose, initialRecord }: {
  childId: string; birthDate: string; onSave: () => void; onClose: () => void;
  initialRecord?: VisionRecord;
}) {
  const initVals: Record<string, string> = {};
  if (initialRecord) { for (const [k, v] of initialRecord.data) initVals[k] = String(v); }
  const [date, setDate] = useState(initialRecord?.date ?? new Date().toISOString().slice(0, 10));
  const [hospital, setHospital] = useState('');
  const [pupil, setPupil] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>(initVals);
  const [hrValue, setHrValue] = useState(initVals['hyperopia-reserve'] ?? '');
  const [screenTime, setScreenTime] = useState('');
  const [outdoorTime, setOutdoorTime] = useState('');
  const [controls, setControls] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  const set = (typeId: string, val: string) => setValues((prev) => ({ ...prev, [typeId]: val }));

  // OCR: pick image -> analyze -> prefill form
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
        if (result?.measurements) {
          const next = { ...values };
          for (const m of result.measurements) {
            if (EYE_SET.has(m.typeId)) next[m.typeId] = String(m.value);
          }
          setValues(next);
          if (result.measurements[0]?.measuredAt) setDate(result.measurements[0].measuredAt);
        }
      } catch { /* OCR failed silently */ }
      setOcrBusy(false);
    };
    input.click();
  };

  const handleSubmit = async () => {
    setSaving(true);
    const ageMonths = computeAgeMonthsAt(birthDate, date);
    const now = isoNow();
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== '');
    if (hrValue.trim()) entries.push(['hyperopia-reserve', hrValue.trim()]);

    const noteParts: string[] = [];
    if (hospital) noteParts.push(`医院: ${hospital}`);
    if (pupil) noteParts.push(`瞳孔: ${pupil}`);
    if (screenTime) noteParts.push(`日近距用眼: ${screenTime}`);
    if (outdoorTime) noteParts.push(`日户外: ${outdoorTime}`);
    if (controls) noteParts.push(`防控: ${controls}`);
    if (notes) noteParts.push(notes);
    const noteStr = noteParts.length > 0 ? noteParts.join(' | ') : null;

    for (const [typeId, val] of entries) {
      const parsed = parseFloat(val);
      if (isNaN(parsed)) continue;
      try {
        await insertMeasurement({
          measurementId: ulid(), childId, typeId, value: parsed,
          measuredAt: date, ageMonths, percentile: null, source: 'manual', notes: noteStr, now,
        });
      } catch { /* duplicate or bridge error */ }
    }
    onSave();
    onClose();
    setSaving(false);
  };

  const filledCount = Object.values(values).filter((v) => v.trim()).length + (hrValue.trim() ? 1 : 0);
  const inp = `${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none focus:ring-2 focus:ring-[#86AFDA]/30`;

  return (
    <div className={`${S.radius} p-5 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold" style={{ color: S.text }}>{initialRecord ? `编辑检查记录 · ${initialRecord.date}` : '录入检查数据'}</h3>
        <div className="flex items-center gap-2">
          {/* OCR button */}
          <button onClick={() => void handleOCR()} disabled={ocrBusy}
            className={`group relative flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90 disabled:opacity-50`}
            style={{ background: S.accent }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h4M7 12h10M7 16h6" />
            </svg>
            {ocrBusy ? '识别中...' : '智能识别'}
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-normal text-white opacity-0 group-hover:opacity-100 z-50"
              style={{ background: '#1a2b4a' }}>拍照或上传验光单自动填入</span>
          </button>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>检查日期 *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>医院/机构</label>
          <input value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填"
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>瞳孔状态</label>
          <div className="flex gap-1.5">
            {PUPIL_OPTIONS.map((p) => (
              <button key={p} onClick={() => setPupil(pupil === p ? '' : p)}
                className={`flex-1 py-2 text-[11px] font-medium ${S.radiusSm} transition-all`}
                style={pupil === p ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Form sections with picker-enabled cells */}
      {FORM_SECTIONS.map((section) => (
        <div key={section.title} className="mb-4">
          <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>{section.title}</p>
          <div className={`${S.radiusSm} overflow-hidden border`} style={{ borderColor: '#e8e5e0' }}>
            <div className="grid grid-cols-[1.5fr_1fr_1fr] text-center text-[10px] font-medium py-2 px-3"
              style={{ background: '#f8faf9', color: S.sub }}>
              <span className="text-left">项目</span>
              <span>OD 右眼</span>
              <span>OS 左眼</span>
            </div>
            {section.fields.map((f, i) => (
              <div key={f.label} className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 py-2 px-3 border-t"
                style={{ borderColor: '#f0f0ec', background: i % 2 === 0 ? S.card : '#fafcfb' }}>
                <div>
                  <span className="text-[11px]" style={{ color: S.text }}>{f.label}</span>
                  {f.unit && <span className="text-[9px] ml-1" style={{ color: S.sub }}>({f.unit})</span>}
                </div>
                <ValueCell typeId={f.od} label={f.label} unit={f.unit} value={values[f.od] ?? ''} onChange={(v) => set(f.od, v)} />
                <ValueCell typeId={f.os} label={f.label} unit={f.unit} value={values[f.os] ?? ''} onChange={(v) => set(f.os, v)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Hyperopia reserve */}
      <div className="mb-4">
        <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>远视储备</p>
        <div className="flex items-center gap-3">
          <ValueCell typeId="hyperopia-reserve" label="远视储备" unit="D" value={hrValue} onChange={setHrValue} />
          <span className="text-[11px]" style={{ color: S.sub }}>D</span>
        </div>
      </div>

      {/* Behavioral factors */}
      <div className={`${S.radiusSm} p-4 mb-4`} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
        <p className="text-[12px] font-semibold mb-3" style={{ color: S.text }}>用眼行为因素</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] block mb-1" style={{ color: S.sub }}>日近距用眼时长（课外）</label>
            <div className="flex gap-1.5">
              {['0-1小时', '2-3小时', '4-5小时', '6小时以上'].map((opt) => (
                <button key={opt} onClick={() => setScreenTime(screenTime === opt ? '' : opt)}
                  className={`flex-1 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                  style={screenTime === opt ? { background: S.accent, color: '#fff' } : { background: '#fff', border: `1px solid ${S.border}`, color: S.sub }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: S.sub }}>日户外活动时长</label>
            <div className="flex gap-1.5">
              {['0-1小时', '2-3小时', '4-5小时', '5小时以上'].map((opt) => (
                <button key={opt} onClick={() => setOutdoorTime(outdoorTime === opt ? '' : opt)}
                  className={`flex-1 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                  style={outdoorTime === opt ? { background: S.accent, color: '#fff' } : { background: '#fff', border: `1px solid ${S.border}`, color: S.sub }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Control measures & notes */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>防控措施</label>
          <input value={controls} onChange={(e) => setControls(e.target.value)}
            placeholder="如：OK镜、低浓度阿托品、户外运动..."
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>防控笔记</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="补充说明..."
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: S.sub }}>已填写 {filledCount} 项数据</span>
        <div className="flex gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[12px] ${S.radiusSm}`}
            style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          <button onClick={() => void handleSubmit()} disabled={saving || filledCount === 0}
            className={`px-5 py-2 text-[12px] font-medium text-white ${S.radiusSm} disabled:opacity-40 transition-all hover:opacity-90`}
            style={{ background: S.accent }}>
            {saving ? '保存中...' : '保存记录'}
          </button>
        </div>
      </div>
    </div>
  );
}
