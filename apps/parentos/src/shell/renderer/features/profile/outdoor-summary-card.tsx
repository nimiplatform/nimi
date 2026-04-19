import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { getOutdoorGoal, getOutdoorRecords, type OutdoorRecordRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  DEFAULT_OUTDOOR_GOAL_MINUTES,
  computeWeekSummary,
  fmtDate,
  getWeekStart,
} from '../outdoor/outdoor-helpers.js';

/**
 * Compact link-card shown at the top of the vision page. Surfaces this
 * week's outdoor-activity progress because outdoor time is a primary
 * modifiable factor in pediatric myopia prevention. Tapping navigates
 * to the full outdoor page.
 */
export function OutdoorSummaryCard({ childId }: { childId: string }) {
  const [records, setRecords] = useState<OutdoorRecordRow[]>([]);
  const [goal, setGoal] = useState<number | null>(null);

  useEffect(() => {
    getOutdoorRecords(childId)
      .then(setRecords)
      .catch(catchLog('vision', 'action:load-outdoor-records-failed'));
    getOutdoorGoal(childId)
      .then(setGoal)
      .catch(catchLog('vision', 'action:load-outdoor-goal-failed'));
  }, [childId]);

  const goalMinutes = goal ?? DEFAULT_OUTDOOR_GOAL_MINUTES;
  const weekStart = getWeekStart(new Date());
  const todayStr = fmtDate(new Date());
  const summary = computeWeekSummary(records, goalMinutes, weekStart, todayStr);
  const percent = Math.min(100, Math.round((summary.totalMinutes / goalMinutes) * 100));
  const barColor = summary.isComplete ? '#4ECCA3' : '#818CF8';

  return (
    <Link
      to="/profile/outdoor"
      data-testid="vision-outdoor-summary"
      className="block mb-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] rounded-[var(--nimi-radius-xl)] transition-colors hover:bg-white/70"
      style={{ padding: 16 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium" style={{ color: S.text }}>本周户外活动</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#ecfdf5', color: '#15803d' }}>
            近视防控
          </span>
        </div>
        <span className="text-[11px]" style={{ color: S.sub }}>查看详情 →</span>
      </div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[18px] font-bold tabular-nums" style={{ color: S.text }}>
          {summary.totalMinutes}
        </span>
        <span className="text-[11px]" style={{ color: S.sub }}>/ {goalMinutes} 分钟</span>
        <span className="ml-auto text-[11px] font-medium tabular-nums" style={{ color: barColor }}>
          {percent}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.5)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, background: barColor }}
        />
      </div>
    </Link>
  );
}
