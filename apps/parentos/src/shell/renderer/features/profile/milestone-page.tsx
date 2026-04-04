import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { MILESTONE_CATALOG, MILESTONE_DOMAINS } from '../../knowledge-base/index.js';
import { getMilestoneRecords, upsertMilestoneRecord } from '../../bridge/sqlite-bridge.js';
import type { MilestoneRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const DOMAIN_LABELS: Record<string, string> = {
  'gross-motor': '大运动',
  'fine-motor': '精细动作',
  'language': '语言',
  'cognitive': '认知',
  'social-emotional': '社交情绪',
  'self-care': '自理',
};

export default function MilestonePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<MilestoneRecordRow[]>([]);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  useEffect(() => {
    if (activeChildId) {
      getMilestoneRecords(activeChildId).then(setRecords).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const recordMap = new Map(records.map((r) => [r.milestoneId, r]));

  const handleToggle = async (milestoneId: string) => {
    const existing = recordMap.get(milestoneId);
    const now = isoNow();
    try {
      if (existing?.achievedAt) {
        // Un-achieve
        await upsertMilestoneRecord({
          recordId: existing.recordId, childId: child.childId, milestoneId,
          achievedAt: null, ageMonthsWhenAchieved: null, notes: null, photoPath: null, now,
        });
      } else {
        // Mark achieved
        await upsertMilestoneRecord({
          recordId: existing?.recordId ?? ulid(), childId: child.childId, milestoneId,
          achievedAt: now, ageMonthsWhenAchieved: ageMonths, notes: null, photoPath: null, now,
        });
      }
      const updated = await getMilestoneRecords(child.childId);
      setRecords(updated);
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <h1 className="text-2xl font-bold mb-2">发育里程碑</h1>
      <p className="text-sm text-gray-500 mb-6">
        已达成 {records.filter((r) => r.achievedAt).length} / {MILESTONE_CATALOG.length} 个里程碑
      </p>

      <div className="space-y-4">
        {MILESTONE_DOMAINS.map((domain) => {
          const milestones = MILESTONE_CATALOG.filter((m) => m.domain === domain);
          const achieved = milestones.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
          const isExpanded = expandedDomain === domain;

          return (
            <div key={domain} className="border rounded-lg">
              <button
                onClick={() => setExpandedDomain(isExpanded ? null : domain)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50"
              >
                <div>
                  <h3 className="font-medium">{DOMAIN_LABELS[domain] ?? domain}</h3>
                  <p className="text-xs text-gray-500">{achieved} / {milestones.length} 已达成</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${(achieved / milestones.length) * 100}%` }} />
                  </div>
                  <span className="text-gray-400 text-sm">{isExpanded ? '收起' : '展开'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t px-4 pb-4">
                  {milestones.map((m) => {
                    const record = recordMap.get(m.milestoneId);
                    const isAchieved = !!record?.achievedAt;
                    const isUpcoming = ageMonths >= m.typicalAge.rangeStart - 2 && ageMonths <= m.typicalAge.rangeEnd + 6;

                    return (
                      <div key={m.milestoneId} className={`flex items-start gap-3 py-3 border-b last:border-0 ${!isUpcoming && !isAchieved ? 'opacity-50' : ''}`}>
                        <button
                          onClick={() => handleToggle(m.milestoneId)}
                          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                            isAchieved ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'
                          }`}
                        >
                          {isAchieved && <span className="text-xs">&#10003;</span>}
                        </button>
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${isAchieved ? 'line-through text-gray-400' : ''}`}>{m.title}</p>
                          <p className="text-xs text-gray-500">{m.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            典型月龄: {m.typicalAge.rangeStart}-{m.typicalAge.rangeEnd} 个月 (中位数 {m.typicalAge.medianMonths}m)
                            {m.alertIfNotBy && ` · ${m.alertIfNotBy}m 后建议咨询专业人士`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
