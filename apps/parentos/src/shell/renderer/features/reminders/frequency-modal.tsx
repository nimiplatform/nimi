import { useEffect, useState } from 'react';
import { Button, IconButton, OverlayShell, TextField, cn } from '@nimiplatform/nimi-kit/ui';
import { saveFreqOverride, clearFreqOverride, loadFreqOverrides, type FreqOverride } from '../../engine/reminder-freq-overrides.js';
import { catchLogThen } from '../../infra/telemetry/catch-log.js';

interface FrequencyModalProps {
  childId: string;
  ruleId: string;
  ruleTitle: string;
  currentIntervalMonths: number;
  canDisable?: boolean;
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

export function FrequencyModal({ childId, ruleId, ruleTitle, currentIntervalMonths, canDisable = true, existingOverride: existingOverrideProp, onSaved, onClose }: FrequencyModalProps) {
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
  const isDisabled = canDisable && (existingOverride?.disabled ?? false);

  const [selected, setSelected] = useState<number | 'custom' | 'disable' | null>(null);
  const [customMonths, setCustomMonths] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-initialize selection when override loads
  useEffect(() => {
    if (!loaded) return;
    const eff = existingOverride?.intervalMonths || currentIntervalMonths;
    const dis = canDisable && (existingOverride?.disabled ?? false);
    setSelected(dis ? 'disable' : (PRESET_OPTIONS.some((o) => o.months === eff) ? eff : 'custom'));
    if (!PRESET_OPTIONS.some((o) => o.months === eff) && !dis) {
      setCustomMonths(String(eff));
    }
  }, [loaded, existingOverride, currentIntervalMonths, canDisable]);

  if (!loaded || selected === null) {
    return (
      <OverlayShell
        open
        kind="dialog"
        onClose={onClose}
        panelClassName="w-[380px] parentos-radius-xl"
        contentClassName="flex items-center justify-center"
      >
        <span className="text-[14px] text-[var(--nimi-text-muted)]">加载中...</span>
      </OverlayShell>
    );
  }

  const handleConfirm = async () => {
    setSaving(true);
    try {
      if (canDisable && selected === 'disable') {
        await saveFreqOverride(childId, ruleId, { intervalMonths: currentIntervalMonths, disabled: true });
      } else {
        const months = selected === 'custom'
          ? (parseInt(customMonths, 10) || currentIntervalMonths)
          : typeof selected === 'number'
            ? selected
            : currentIntervalMonths;
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
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      panelClassName="w-[380px] parentos-radius-xl"
      title={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[18px]">⏱️</span>
            <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">调整提醒频率</h2>
          </div>
          <IconButton onClick={onClose} icon="✕" aria-label="关闭" tone="ghost" size="sm" className="h-7 min-h-7 w-7" />
        </div>
      }
      footer={
        <div className="flex gap-2">
          <Button
            onClick={() => void handleConfirm()}
            disabled={saving}
            tone={selected === 'disable' ? 'danger' : 'primary'}
            size="md"
            fullWidth
            className={selected === 'disable' ? 'bg-[var(--nimi-status-danger)] text-[var(--nimi-action-primary-text)]' : undefined}
          >
            {saving ? '保存中...' : '确认'}
          </Button>
          {isCustomized && (
            <Button onClick={() => void handleResetDefault()} disabled={saving} tone="secondary" size="md">
              恢复默认
            </Button>
          )}
        </div>
      }
    >
      <p className="mb-1 text-[14px] text-[var(--nimi-text-primary)]">{ruleTitle}</p>
      <p className="mb-4 text-[13px] text-[var(--nimi-text-muted)]">
        默认频率：每 {currentIntervalMonths} 个月
        {isCustomized && !isDisabled && <span className="text-[var(--nimi-action-primary-bg)]"> → 已调整为每 {effectiveCurrent} 个月</span>}
        {isDisabled && <span className="text-[var(--nimi-status-danger)]"> → 已关闭</span>}
      </p>

      {/* Options */}
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESET_OPTIONS.map((opt) => (
          <button key={opt.months} onClick={() => setSelected(opt.months)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[14px] transition-all',
              opt.months === currentIntervalMonths && 'font-medium',
              selected === opt.months
                ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                : 'border-[var(--nimi-action-secondary-border)] bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:border-[var(--nimi-border-strong)]',
            )}>
            {opt.label}{opt.months === currentIntervalMonths ? '(默认)' : ''}
          </button>
        ))}
        <button onClick={() => { setSelected('custom'); if (!customMonths) setCustomMonths(String(effectiveCurrent)); }}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[14px] transition-all',
            selected === 'custom'
              ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : 'border-[var(--nimi-action-secondary-border)] bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:border-[var(--nimi-border-strong)]',
          )}>
          自定义
        </button>
        {canDisable && (
          <button onClick={() => setSelected('disable')}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[14px] transition-all',
              selected === 'disable'
                ? 'border-[var(--nimi-status-danger)] bg-[var(--nimi-status-danger)] text-[var(--nimi-action-primary-text)]'
                : 'border-[color-mix(in_srgb,var(--nimi-status-danger)_25%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]',
            )}>
            关闭此提醒
          </button>
        )}
      </div>

      {/* Custom input */}
      {selected === 'custom' && (
        <div className="mb-4 flex items-center gap-2">
          <TextField
            type="number"
            min="1"
            max="120"
            value={customMonths}
            onChange={(e) => setCustomMonths(e.target.value)}
            placeholder="月数"
            className="w-20"
            inputClassName="text-[14px]"
          />
          <span className="text-[14px] text-[var(--nimi-text-muted)]">个月</span>
        </div>
      )}

      {selected === 'disable' && (
        <p className="mb-4 parentos-radius-md bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-3 py-2 text-[13px] text-[var(--nimi-status-danger)]">
          关闭后该提醒将不再出现。可在设置 → 提醒管理中恢复。
        </p>
      )}
    </OverlayShell>
  );
}
