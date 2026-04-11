import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
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

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  return (
    <div className="min-h-full p-6" style={{ background: S.bg }}>
      <div className="max-w-3xl mx-auto">
        <Link to="/settings" className="inline-flex items-center gap-1 text-[12px] mb-5 hover:underline" style={{ color: S.sub }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          返回设置
        </Link>

        <h1 className="text-[22px] font-bold mb-2" style={{ color: S.text }}>提醒管理</h1>
        <p className="text-[12px] mb-6" style={{ color: S.sub }}>查看和管理已自定义频率的提醒规则</p>

        {loading ? (
          <p className="text-[13px]" style={{ color: S.sub }}>加载中...</p>
        ) : entries.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[28px]">⏱️</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>所有提醒使用默认频率</p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>在首页或提醒页点击"调整频率"可自定义</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.ruleId} className={`${S.radius} p-4 flex items-center gap-4`} style={{ background: S.card, boxShadow: S.shadow }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#f5f3ef', color: S.sub }}>
                      {DOMAIN_LABELS[entry.domain] ?? entry.domain}
                    </span>
                    <p className="text-[13px] font-medium truncate" style={{ color: S.text }}>{entry.ruleTitle}</p>
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: S.sub }}>
                    默认：每 {entry.defaultInterval} 个月 →
                    {entry.override.disabled ? (
                      <span style={{ color: '#dc2626' }}> 已关闭</span>
                    ) : (
                      <span style={{ color: S.accent }}> 每 {entry.override.intervalMonths} 个月</span>
                    )}
                  </p>
                </div>
                <button onClick={() => void handleReset(entry.ruleId)}
                  className={`shrink-0 px-3 py-1.5 text-[11px] ${S.radiusSm} hover:opacity-80`}
                  style={{ background: '#f5f3ef', color: S.text }}>
                  恢复默认
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
