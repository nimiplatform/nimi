import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const progressTone = summary.isComplete
    ? 'text-[var(--nimi-action-primary-bg)]'
    : 'text-[var(--nimi-status-info)]';

  return (
    <Surface
      as={Link}
      to="/profile"
      data-testid="vision-outdoor-summary"
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="md"
      interactive
      className="mb-5 block no-underline"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">本周户外活动</span>
          <span className="rounded bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-1.5 py-0.5 text-[12px] text-[var(--nimi-status-success)]">
            近视防控
          </span>
        </div>
        <span className="text-[13px] text-[var(--nimi-text-muted)]">查看详情 →</span>
      </div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[18px] font-bold tabular-nums text-[var(--nimi-text-primary)]">
          {summary.totalMinutes}
        </span>
        <span className="text-[13px] text-[var(--nimi-text-muted)]">/ {goalMinutes} 分钟</span>
        <span className={`ml-auto text-[13px] font-medium tabular-nums ${progressTone}`}>
          {percent}%
        </span>
      </div>
      <progress
        value={percent}
        max={100}
        aria-label="本周户外活动完成度"
        className="h-1.5 w-full overflow-hidden rounded-full accent-[var(--nimi-action-primary-bg)]"
      />
    </Surface>
  );
}
