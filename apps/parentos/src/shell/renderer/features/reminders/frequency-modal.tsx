import { useEffect, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { saveFreqOverride, clearFreqOverride, loadFreqOverrides, type FreqOverride } from '../../engine/reminder-freq-overrides.js';
import { catchLogThen } from '../../infra/telemetry/catch-log.js';

interface FrequencyModalProps {
  childId: string;
  ruleId: string;
  ruleTitle: string;
  currentIntervalMonths: number;
  existingOverride?: FreqOverride | null;
  onSaved: () => void;
  onClose: () => void;
}

const PRESET_OPTIONS = [
  { months: 1, label: '每月' },
  { months: 3, label: '每 3 个月' },
  { months: 6, label: '每半年' },
  { months: 12, label: '每年' },
  { months: 24, label: '每 2 年' },
] as const;

export function FrequencyModal({ childId, ruleId, ruleTitle, currentIntervalMonths, existingOverride: existingOverrideProp, onSaved, onClose }: FrequencyModalProps) {
  const [loadedOverride, setLoadedOverride] = useState<FreqOverride | null>(existingOverrideProp ?? null);
  const [loaded, setLoaded] = useState(Boolean(existingOverrideProp));

  useEffect(() => {
    if (existingOverrideProp != null) return; // caller already provided
    loadFreqOverrides(childId, [ruleId]).then((map) => {
      setLoadedOverride(map.get(ruleId) ?? null);
      setLoaded(true);
    }).catch(catchLogThen('reminders', 'action:load-freq-overrides-failed', () => setLoaded(true)));
  }, [childId, ruleId, existingOverrideProp]);

  const existingOverride = loadedOverride;
  const effectiveCurrent = existingOverride?.intervalMonths || currentIntervalMonths;
  const isDisabled = existingOverride?.disabled ?? false;

  const [selected, setSelected] = useState<number | 'custom' | 'disable' | null>(null);
  const [customMonths, setCustomMonths] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-initialize selection when override loads
  useEffect(() => {
    if (!loaded) return;
    const eff = existingOverride?.intervalMonths || currentIntervalMonths;
    const dis = existingOverride?.disabled ?? false;
    setSelected(dis ? 'disable' : (PRESET_OPTIONS.some((o) => o.months === eff) ? eff : 'custom'));
    if (!PRESET_OPTIONS.some((o) => o.months === eff) && !dis) {
      setCustomMonths(String(eff));
    }
  }, [loaded, existingOverride, currentIntervalMonths]);

  if (!loaded || selected === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--nimi-scrim-modal)' }} onClick={onClose}>
        <div className={`w-[380px] ${S.radius} p-6 shadow-xl flex items-center justify-center`} style={{ background: S.card }}>
          <span className="text-[14px]" style={{ color: S.sub }}>加载中...</span>
        </div>
      </div>
    );
  }

  const handleConfirm = async () => {
    setSaving(true);
    try {
      if (selected === 'disable') {
        await saveFreqOverride(childId, ruleId, { intervalMonths: currentIntervalMonths, disabled: true });
      } else {
        const months = selected === 'custom' ? (parseInt(customMonths, 10) || currentIntervalMonths) : selected;
        await saveFreqOverride(childId, ruleId, { intervalMonths: months, disabled: false });
      }
      onSaved();
      onClose();
    } catch { /* bridge */ }
    setSaving(false);
  };

  const handleResetDefault = async () => {
    setSaving(true);
    try {
      await clearFreqOverride(childId, ruleId);
      onSaved();
      onClose();
    } catch { /* bridge */ }
    setSaving(false);
  };

  const isCustomized = Boolean(existingOverride);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--nimi-scrim-modal)' }} onClick={onClose}>
      <div className={`w-[380px] ${S.radius} p-6 shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">⏱️</span>
            <h2 className="text-[16px] font-bold" style={{ color: S.text }}>调整提醒频率</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <p className="text-[14px] mb-1" style={{ color: S.text }}>{ruleTitle}</p>
        <p className="text-[13px] mb-4" style={{ color: S.sub }}>
          默认频率：每 {currentIntervalMonths} 个月
          {isCustomized && !isDisabled && <span style={{ color: S.accent }}> → 已调整为每 {effectiveCurrent} 个月</span>}
          {isDisabled && <span style={{ color: '#dc2626' }}> → 已关闭</span>}
        </p>

        {/* Options */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_OPTIONS.map((opt) => (
            <button key={opt.months} onClick={() => setSelected(opt.months)}
              className={`px-3 py-1.5 rounded-full text-[14px] transition-all ${opt.months === currentIntervalMonths ? 'font-medium' : ''}`}
              style={selected === opt.months
                ? { background: S.accent, color: '#fff' }
                : { background: '#f5f3ef', color: S.text, border: `1px solid ${S.border}` }}>
              {opt.label}{opt.months === currentIntervalMonths ? '(默认)' : ''}
            </button>
          ))}
          <button onClick={() => { setSelected('custom'); if (!customMonths) setCustomMonths(String(effectiveCurrent)); }}
            className="px-3 py-1.5 rounded-full text-[14px] transition-all"
            style={selected === 'custom'
              ? { background: S.accent, color: '#fff' }
              : { background: '#f5f3ef', color: S.text, border: `1px solid ${S.border}` }}>
            自定义
          </button>
          <button onClick={() => setSelected('disable')}
            className="px-3 py-1.5 rounded-full text-[14px] transition-all"
            style={selected === 'disable'
              ? { background: '#dc2626', color: '#fff' }
              : { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
            关闭此提醒
          </button>
        </div>

        {/* Custom input */}
        {selected === 'custom' && (
          <div className="flex items-center gap-2 mb-4">
            <input type="number" min="1" max="120" value={customMonths} onChange={(e) => setCustomMonths(e.target.value)}
              placeholder="月数" className={`w-20 ${S.radiusSm} px-3 py-1.5 text-[14px] border-0 outline-none`}
              style={{ background: '#f5f3ef', color: S.text }} />
            <span className="text-[14px]" style={{ color: S.sub }}>个月</span>
          </div>
        )}

        {selected === 'disable' && (
          <p className="text-[13px] mb-4 px-3 py-2 rounded-lg" style={{ background: '#fef2f2', color: '#dc2626' }}>
            关闭后该提醒将不再出现。可在设置 → 提醒管理中恢复。
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={() => void handleConfirm()} disabled={saving}
            className={`flex-1 py-2.5 text-[14px] font-medium text-white ${S.radiusSm} disabled:opacity-40 hover:opacity-90`}
            style={{ background: selected === 'disable' ? '#dc2626' : S.accent }}>
            {saving ? '保存中...' : '确认'}
          </button>
          {isCustomized && (
            <button onClick={() => void handleResetDefault()} disabled={saving}
              className={`px-4 py-2.5 text-[14px] ${S.radiusSm}`}
              style={{ background: '#f5f3ef', color: S.text }}>
              恢复默认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
