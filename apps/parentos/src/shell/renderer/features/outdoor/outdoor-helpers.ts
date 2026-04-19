import type { OutdoorRecordRow } from '../../bridge/sqlite-bridge.js';

// ── Week boundary helpers (ISO week: Monday = day 1) ──────

/** Return YYYY-MM-DD of the Monday for the week containing `date`. */
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon…6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return fmtDate(d);
}

/** Days remaining in the current week *including* today (1–7). */
export function getRemainingDaysInWeek(date: Date): number {
  const day = date.getDay(); // 0=Sun
  return day === 0 ? 1 : 8 - day;
}

/** Shift a week start string by N weeks (negative = past). */
export function shiftWeek(weekStart: string, weeks: number): string {
  const d = parseDate(weekStart);
  d.setDate(d.getDate() + weeks * 7);
  return fmtDate(d);
}

/** Short Chinese label for a week range, e.g. "4月7日 – 4月13日". */
export function formatWeekRange(weekStart: string): string {
  const start = parseDate(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Chinese weekday label: "周一" … "周日". */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
export function weekdayLabel(date: Date): string {
  return WEEKDAY_LABELS[date.getDay()]!;
}

// ── Week summary computation ─────────────────────────────

export interface DailyBreakdown {
  date: string;
  weekday: string;
  minutes: number;
}

export interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  dailyBreakdown: DailyBreakdown[];
  goalMinutes: number;
  remainingMinutes: number;
  remainingDays: number;
  pacePerDay: number;
  isComplete: boolean;
  overMinutes: number;
}

export function computeWeekSummary(
  records: OutdoorRecordRow[],
  goalMinutes: number,
  weekStart: string,
  today?: string,
): WeekSummary {
  const weekEndDate = parseDate(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEndStr = fmtDate(weekEndDate);

  // Build daily breakdown for all 7 days
  const dailyMinutes = new Map<string, number>();
  for (const r of records) {
    if (r.activityDate >= weekStart && r.activityDate <= weekEndStr) {
      dailyMinutes.set(r.activityDate, (dailyMinutes.get(r.activityDate) ?? 0) + r.durationMinutes);
    }
  }

  const breakdown: DailyBreakdown[] = [];
  const startDate = parseDate(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = fmtDate(d);
    breakdown.push({
      date: dateStr,
      weekday: weekdayLabel(d),
      minutes: dailyMinutes.get(dateStr) ?? 0,
    });
  }

  const totalMinutes = breakdown.reduce((sum, d) => sum + d.minutes, 0);
  const remainingMinutes = Math.max(0, goalMinutes - totalMinutes);
  const overMinutes = Math.max(0, totalMinutes - goalMinutes);
  const isComplete = totalMinutes >= goalMinutes;

  // Remaining days: if today is within this week, count from today to Sunday inclusive
  const todayStr = today ?? fmtDate(new Date());
  let remainingDays: number;
  if (todayStr < weekStart) {
    remainingDays = 7; // future week
  } else if (todayStr > weekEndStr) {
    remainingDays = 0; // past week
  } else {
    const todayDate = parseDate(todayStr);
    remainingDays = getRemainingDaysInWeek(todayDate);
  }

  const pacePerDay = remainingDays > 0 ? Math.ceil(remainingMinutes / remainingDays) : 0;

  return {
    weekStart,
    weekEnd: weekEndStr,
    totalMinutes,
    dailyBreakdown: breakdown,
    goalMinutes,
    remainingMinutes,
    remainingDays,
    pacePerDay,
    isComplete,
    overMinutes,
  };
}

/** Compute summaries for the most recent N weeks ending with the current week. */
export function computeRecentWeeks(
  records: OutdoorRecordRow[],
  goalMinutes: number,
  count: number,
  today?: string,
): WeekSummary[] {
  const todayStr = today ?? fmtDate(new Date());
  const currentWeekStart = getWeekStart(parseDate(todayStr));
  const weeks: WeekSummary[] = [];
  for (let i = 0; i < count; i++) {
    const ws = shiftWeek(currentWeekStart, -i);
    weeks.push(computeWeekSummary(records, goalMinutes, ws, todayStr));
  }
  return weeks;
}

// ── Supportive messaging ─────────────────────────────────

export type OutdoorMessageType =
  | 'empty'
  | 'in-progress-on-track'
  | 'in-progress-behind'
  | 'complete'
  | 'over-complete'
  | 'past-complete'
  | 'past-incomplete';

export interface OutdoorMessage {
  type: OutdoorMessageType;
  primary: string;
  secondary: string;
}

export function buildOutdoorMessage(summary: WeekSummary, isPastWeek: boolean): OutdoorMessage {
  if (isPastWeek) {
    if (summary.isComplete) {
      return {
        type: 'past-complete',
        primary: `本周完成 ${summary.totalMinutes} 分钟，已达标`,
        secondary: summary.overMinutes > 0 ? `超出目标 ${summary.overMinutes} 分钟` : '刚好完成目标',
      };
    }
    return {
      type: 'past-incomplete',
      primary: `本周累计 ${summary.totalMinutes} / ${summary.goalMinutes} 分钟`,
      secondary: `差 ${summary.remainingMinutes} 分钟`,
    };
  }

  if (summary.totalMinutes === 0) {
    return {
      type: 'empty',
      primary: '本周还没有户外记录',
      secondary: '从今天开始记录吧',
    };
  }

  if (summary.isComplete) {
    if (summary.overMinutes > 0) {
      return {
        type: 'over-complete',
        primary: `本周已达标！累计 ${summary.totalMinutes} 分钟`,
        secondary: `超出目标 ${summary.overMinutes} 分钟`,
      };
    }
    return {
      type: 'complete',
      primary: `本周已达标！累计 ${summary.totalMinutes} 分钟`,
      secondary: '继续保持',
    };
  }

  // In progress — check pace
  const progress = summary.totalMinutes / summary.goalMinutes;
  const expectedProgress = summary.remainingDays < 7 ? (7 - summary.remainingDays) / 7 : 0;
  const isOnTrack = progress >= expectedProgress * 0.8; // 80% of expected pace counts as on-track

  if (isOnTrack) {
    return {
      type: 'in-progress-on-track',
      primary: `本周已累计 ${summary.totalMinutes} 分钟，进度不错`,
      secondary: `还差 ${summary.remainingMinutes} 分钟`,
    };
  }

  // Behind pace
  if (summary.remainingDays <= 2) {
    return {
      type: 'in-progress-behind',
      primary: `本周已累计 ${summary.totalMinutes} 分钟，还差 ${summary.remainingMinutes} 分钟`,
      secondary: `这周还有 ${summary.remainingDays} 天，可以多安排一些户外活动`,
    };
  }

  return {
    type: 'in-progress-behind',
    primary: `本周已累计 ${summary.totalMinutes} 分钟，还差 ${summary.remainingMinutes} 分钟`,
    secondary: `这周还有 ${summary.remainingDays} 天，平均每天再补 ${summary.pacePerDay} 分钟即可接近目标`,
  };
}

// ── Date utilities ───────────────────────────────────────

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function formatShortDate(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const DEFAULT_OUTDOOR_GOAL_MINUTES = 630;

/** Quick-select duration presets in minutes. */
export const DURATION_PRESETS = [30, 60, 90, 120] as const;

// ── Heatmap (multi-week daily intensity grid) ────────────

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatmapCell {
  date: string;
  minutes: number;
  /** minutes ÷ daily target. 0 when no record. */
  ratio: number;
  level: HeatmapLevel;
  isFuture: boolean;
  isToday: boolean;
}

export interface HeatmapMonthLabel {
  /** Column (week) index where this month's first Monday falls. */
  weekIndex: number;
  label: string; // e.g. "4月"
}

export interface Heatmap {
  weeksBack: number;
  dailyTargetMinutes: number;
  /** weeks[col] = 7 cells (Monday → Sunday), oldest week first. */
  weeks: HeatmapCell[][];
  monthLabels: HeatmapMonthLabel[];
}

export function ratioToHeatmapLevel(ratio: number, hasRecord: boolean): HeatmapLevel {
  if (!hasRecord) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  if (ratio < 1.5) return 3;
  return 4;
}

export function computeHeatmap(
  records: OutdoorRecordRow[],
  goalMinutes: number,
  weeksBack: number,
  today?: string,
): Heatmap {
  const todayStr = today ?? fmtDate(new Date());
  const currentWeekStart = getWeekStart(parseDate(todayStr));
  const dailyTarget = goalMinutes / 7;

  const minuteMap = new Map<string, number>();
  for (const r of records) {
    minuteMap.set(r.activityDate, (minuteMap.get(r.activityDate) ?? 0) + r.durationMinutes);
  }

  const weeks: HeatmapCell[][] = [];
  const monthLabels: HeatmapMonthLabel[] = [];
  let lastMonth = -1;

  for (let w = weeksBack - 1; w >= 0; w--) {
    const weekStart = shiftWeek(currentWeekStart, -w);
    const base = parseDate(weekStart);
    const col: HeatmapCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cursor = new Date(base);
      cursor.setDate(cursor.getDate() + d);
      const dateStr = fmtDate(cursor);
      const minutes = minuteMap.get(dateStr) ?? 0;
      const ratio = dailyTarget > 0 ? minutes / dailyTarget : 0;
      col.push({
        date: dateStr,
        minutes,
        ratio,
        level: ratioToHeatmapLevel(ratio, minutes > 0),
        isFuture: dateStr > todayStr,
        isToday: dateStr === todayStr,
      });
    }

    const colIdx = weeks.length;
    const mondayMonth = base.getMonth();
    if (mondayMonth !== lastMonth) {
      monthLabels.push({ weekIndex: colIdx, label: `${mondayMonth + 1}月` });
      lastMonth = mondayMonth;
    }
    weeks.push(col);
  }

  return {
    weeksBack,
    dailyTargetMinutes: Math.round(dailyTarget),
    weeks,
    monthLabels,
  };
}
