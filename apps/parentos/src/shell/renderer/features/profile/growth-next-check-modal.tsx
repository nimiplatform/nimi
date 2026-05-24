import { useEffect, useState } from 'react';
import { Button, IconButton, OverlayShell, TextField, cn } from '@nimiplatform/kit/ui';
import { computeAgeMonths, type NurtureMode } from '../../app-shell/app-store.js';
import { getReminderStates } from '../../bridge/sqlite-bridge.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { applyReminderAction } from '../../engine/reminder-actions.js';
import {
  clearFreqOverride,
  loadFreqOverrides,
  saveFreqOverride,
  type FreqOverride,
} from '../../engine/reminder-freq-overrides.js';
import {
  computeEligibleReminders,
  getLocalToday,
  mapReminderStateRow,
  type ActiveReminder,
  type ReminderEngineContext,
} from '../../engine/reminder-engine.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { resolveGrowthRecheckRuleId } from './growth-curve-page-shared.js';

// growth-next-check-modal.tsx — PO-GROWTH-DETAIL-006 next-check reschedule
// modal. The 更改 CTA on the milestone timeline opens this modal against the
// child's age-active growth record_data reminder. It adjusts two things, both
// through mechanisms owned by reminder-interaction-contract.md:
//   - the next occurrence date — PO-REMI-005 `schedule` action (scheduledDate)
//   - the cadence            — PO-REMI-015 per-(child,rule) frequency override
// It never marks the reminder complete and never writes reminder-rules.yaml.

export interface GrowthNextCheckModalChild {
  childId: string;
  birthDate: string;
  gender: 'male' | 'female';
  createdAt: string;
  nurtureMode: NurtureMode;
  nurtureModeOverrides: Record<string, NurtureMode> | null;
}

interface GrowthNextCheckModalProps {
  child: GrowthNextCheckModalChild;
  onSaved: () => void;
  onClose: () => void;
}

const PRESET_OPTIONS = [
  { months: 1, label: '每月' },
  { months: 3, label: '每 3 个月' },
  { months: 6, label: '每半年' },
  { months: 12, label: '每年' },
] as const;

function presetMonths(): readonly number[] {
  return PRESET_OPTIONS.map((option) => option.months);
}

export function GrowthNextCheckModal({ child, onSaved, onClose }: GrowthNextCheckModalProps) {
  const ageMonths = computeAgeMonths(child.birthDate);
  const recheckRuleId = resolveGrowthRecheckRuleId(ageMonths);
  const rule = recheckRuleId
    ? REMINDER_RULES.find((candidate) => candidate.ruleId === recheckRuleId) ?? null
    : null;
  const defaultInterval = rule?.repeatRule?.intervalMonths ?? 1;

  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<ActiveReminder | null>(null);
  const [override, setOverride] = useState<FreqOverride | null>(null);
  const [dateValue, setDateValue] = useState('');
  const [intervalSel, setIntervalSel] = useState<number | 'custom'>(defaultInterval);
  const [customMonths, setCustomMonths] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!rule) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getReminderStates(child.childId);
        const states = rows.map(mapReminderStateRow);
        const overrides = await loadFreqOverrides(child.childId, [rule.ruleId]);
        const context: ReminderEngineContext = {
          birthDate: child.birthDate,
          gender: child.gender,
          ageMonths,
          profileCreatedAt: child.createdAt,
          localToday: getLocalToday(),
          nurtureMode: child.nurtureMode,
          domainOverrides: child.nurtureModeOverrides,
        };
        const eligible = computeEligibleReminders(REMINDER_RULES, context, states, overrides);
        const matches = eligible.filter((item) => item.rule.ruleId === rule.ruleId);
        const active =
          matches.find((item) => item.lifecycle !== 'completed' && item.lifecycle !== 'not_applicable')
          ?? matches[matches.length - 1]
          ?? null;
        if (cancelled) return;
        const loadedOverride = overrides.get(rule.ruleId) ?? null;
        const effectiveInterval = loadedOverride?.intervalMonths || defaultInterval;
        setTarget(active);
        setOverride(loadedOverride);
        setIntervalSel(presetMonths().includes(effectiveInterval) ? effectiveInterval : 'custom');
        if (!presetMonths().includes(effectiveInterval)) {
          setCustomMonths(String(effectiveInterval));
        }
        setDateValue(active?.state?.scheduledDate ?? active?.effectiveStartDate ?? getLocalToday());
        setLoaded(true);
      } catch (error) {
        catchLog('growth-next-check', 'action:load-next-check-failed')(error);
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [child, rule, ageMonths, defaultInterval]);

  const resolveInterval = (): number => {
    if (intervalSel === 'custom') {
      const parsed = parseInt(customMonths, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultInterval;
    }
    return intervalSel;
  };

  const handleConfirm = async () => {
    if (!rule) return;
    setSaving(true);
    try {
      const chosenInterval = resolveInterval();
      if (chosenInterval !== defaultInterval) {
        await saveFreqOverride(child.childId, rule.ruleId, {
          intervalMonths: chosenInterval,
          disabled: false,
        });
      } else if (override) {
        await clearFreqOverride(child.childId, rule.ruleId);
      }
      await applyReminderAction({
        childId: child.childId,
        reminder: { rule, repeatIndex: target?.repeatIndex ?? 0, kind: 'task' },
        state: target?.state ?? null,
        action: 'schedule',
        scheduledDate: dateValue || null,
      });
      onSaved();
      onClose();
    } catch (error) {
      catchLog('growth-next-check', 'action:reschedule-failed')(error);
    }
    setSaving(false);
  };

  const handleResetDefault = async () => {
    if (!rule) return;
    setSaving(true);
    try {
      if (override) {
        await clearFreqOverride(child.childId, rule.ruleId);
      }
      await applyReminderAction({
        childId: child.childId,
        reminder: { rule, repeatIndex: target?.repeatIndex ?? 0, kind: 'task' },
        state: target?.state ?? null,
        action: 'schedule',
        scheduledDate: null,
      });
      onSaved();
      onClose();
    } catch (error) {
      catchLog('growth-next-check', 'action:reset-next-check-failed')(error);
    }
    setSaving(false);
  };

  const header = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-[18px]">📅</span>
        <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">调整下次复测</h2>
      </div>
      <IconButton onClick={onClose} icon="✕" aria-label="关闭" tone="ghost" size="sm" className="h-7 min-h-7 w-7" />
    </div>
  );

  // Fail-close: no growth record_data rule covers the child's age
  // (PO-GROWTH-DETAIL-009). The 更改 CTA is already disabled in this case;
  // render an explanatory state rather than targeting an arbitrary rule.
  if (!rule) {
    return (
      <OverlayShell
        open
        kind="dialog"
        onClose={onClose}
        panelClassName="w-[380px] parentos-radius-xl"
        title={header}
      >
        <p data-testid="growth-next-check-modal" className="text-[14px] text-[var(--nimi-text-muted)]">
          当前年龄暂无适用的生长复测提醒。
        </p>
      </OverlayShell>
    );
  }

  if (!loaded) {
    return (
      <OverlayShell
        open
        kind="dialog"
        onClose={onClose}
        panelClassName="w-[380px] parentos-radius-xl"
        contentClassName="flex items-center justify-center"
      >
        <span data-testid="growth-next-check-modal" className="text-[14px] text-[var(--nimi-text-muted)]">
          加载中...
        </span>
      </OverlayShell>
    );
  }

  const isCustomized = Boolean(override) || Boolean(target?.state?.scheduledDate);

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      panelClassName="w-[380px] parentos-radius-xl"
      title={header}
      footer={
        <div className="flex gap-2">
          <Button onClick={() => void handleConfirm()} disabled={saving} tone="primary" size="md" fullWidth>
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
      <div data-testid="growth-next-check-modal">
      <p className="mb-4 text-[13px] text-[var(--nimi-text-muted)]">{rule.title}</p>

      {/* Next re-check date — PO-REMI-005 schedule action */}
      <label className="mb-1.5 block text-[13px] font-medium text-[var(--nimi-text-primary)]">
        下次复测日期
      </label>
      <div data-testid="growth-next-check-date">
        <TextField
          type="date"
          value={dateValue}
          onChange={(event) => setDateValue(event.target.value)}
          className="mb-4 w-[180px]"
          inputClassName="text-[14px]"
        />
      </div>

      {/* Cadence — PO-REMI-015 frequency override */}
      <label className="mb-1.5 block text-[13px] font-medium text-[var(--nimi-text-primary)]">
        复测频率
      </label>
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.months}
            type="button"
            onClick={() => setIntervalSel(option.months)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[14px] transition-all',
              option.months === defaultInterval && 'font-medium',
              intervalSel === option.months
                ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                : 'border-[var(--nimi-action-secondary-border)] bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:border-[var(--nimi-border-strong)]',
            )}
          >
            {option.label}
            {option.months === defaultInterval ? '(默认)' : ''}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setIntervalSel('custom');
            if (!customMonths) setCustomMonths(String(defaultInterval));
          }}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[14px] transition-all',
            intervalSel === 'custom'
              ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
              : 'border-[var(--nimi-action-secondary-border)] bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-primary)] hover:border-[var(--nimi-border-strong)]',
          )}
        >
          自定义
        </button>
      </div>

      {intervalSel === 'custom' && (
        <div className="mb-3 flex items-center gap-2">
          <TextField
            type="number"
            min="1"
            max="120"
            value={customMonths}
            onChange={(event) => setCustomMonths(event.target.value)}
            placeholder="月数"
            className="w-20"
            inputClassName="text-[14px]"
          />
          <span className="text-[14px] text-[var(--nimi-text-muted)]">个月</span>
        </div>
      )}

      <p className="text-[12px] text-[var(--nimi-text-muted)]">
        复测频率会按 WHO 标准随年龄段调整；这里的设置仅覆盖当前孩子的提醒节奏，可随时恢复默认。
      </p>
      </div>
    </OverlayShell>
  );
}
