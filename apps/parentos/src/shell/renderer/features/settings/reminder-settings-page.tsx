import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '../../app-shell/app-store.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { loadAllFreqOverrides, clearFreqOverride, type FreqOverride } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';

const DOMAIN_LABELS: Record<string, string> = {
  vaccine: '疫苗', checkup: '体检', vision: '视力', dental: '口腔', 'bone-age': '骨龄',
  growth: '生长', nutrition: '营养', sleep: '睡眠', sensitivity: '敏感期', posture: '体态',
  fitness: '体能', tanner: '青春期',
};

interface OverrideEntry {
  ruleId: string;
  ruleTitle: string;
  domain: string;
  defaultInterval: number;
  override: FreqOverride;
}

export default function ReminderSettingsPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [entries, setEntries] = useState<OverrideEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOverrides = async () => {
    if (!child) return;
    setLoading(true);
    const ruleIds = REMINDER_RULES.filter((r) => r.repeatRule).map((r) => r.ruleId);
    const overrides = await loadAllFreqOverrides(child.childId, ruleIds);
    const result: OverrideEntry[] = [];
    for (const [ruleId, override] of overrides.entries()) {
      if (!override.modifiedAt) continue; // skip empty/cleared
      const rule = REMINDER_RULES.find((r) => r.ruleId === ruleId);
      if (!rule || !rule.repeatRule) continue;
      result.push({ ruleId, ruleTitle: rule.title, domain: rule.domain, defaultInterval: rule.repeatRule.intervalMonths, override });
    }
    setEntries(result.sort((a, b) => a.domain.localeCompare(b.domain)));
    setLoading(false);
  };

  useEffect(() => { loadOverrides().catch(catchLogThen('reminder-settings', 'action:load-overrides-failed', () => setLoading(false))); }, [child]);

  const handleReset = async (ruleId: string) => {
    if (!child) return;
    await clearFreqOverride(child.childId, ruleId).catch(catchLog('reminder-settings', 'action:clear-freq-override-failed'));
    await loadOverrides();
  };

  if (!child) return <div className="p-8 text-[var(--nimi-text-muted)]">请先添加孩子</div>;

  return (
    <div className="min-h-full bg-transparent p-6">
      <div className="mx-auto max-w-3xl">
        <Link to="/settings" className="mb-5 inline-flex items-center gap-1 text-[14px] text-[var(--nimi-text-muted)] hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        <h1 className="mb-2 text-[24px] font-bold text-[var(--nimi-text-primary)]">提醒管理</h1>
        <p className="mb-6 text-[14px] text-[var(--nimi-text-muted)]">查看和管理已自定义频率的提醒规则</p>

        {loading ? (
          <p className="text-[14px] text-[var(--nimi-text-muted)]">加载中...</p>
        ) : entries.length === 0 ? (
          <Surface tone="card" material="solid" elevation="base" padding="lg" className="parentos-radius-xl text-center">
            <span className="text-[24px]">⏱️</span>
            <p className="mt-2 text-[14px] font-medium text-[var(--nimi-text-primary)]">所有提醒使用默认频率</p>
            <p className="mt-1 text-[13px] text-[var(--nimi-text-muted)]">在首页或提醒页点击"调整频率"可自定义</p>
          </Surface>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <Surface key={entry.ruleId} tone="card" material="solid" elevation="base" padding="md" className="flex items-center gap-4 parentos-radius-xl">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[var(--nimi-action-secondary-bg)] px-2 py-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                      {DOMAIN_LABELS[entry.domain] ?? entry.domain}
                    </span>
                    <p className="truncate text-[14px] font-medium text-[var(--nimi-text-primary)]">{entry.ruleTitle}</p>
                  </div>
                  <p className="mt-1 text-[13px] text-[var(--nimi-text-muted)]">
                    默认：每 {entry.defaultInterval} 个月 →
                    {entry.override.disabled ? (
                      <span className="text-[var(--nimi-status-danger)]"> 已关闭</span>
                    ) : (
                      <span className="text-[var(--nimi-action-primary-bg)]"> 每 {entry.override.intervalMonths} 个月</span>
                    )}
                  </p>
                </div>
                <Button onClick={() => void handleReset(entry.ruleId)} tone="secondary" size="sm" className="shrink-0 text-[13px]">
                  恢复默认
                </Button>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
