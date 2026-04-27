import type { MilestoneTimelineSummary, MonthlyReportSummary, ObservationDistributionSummary, SleepTrendSummary, VisionSnapshotSummary } from './timeline-data.js';
import { parseReportContent } from '../reports/structured-report.js';
import {
  fmtRel,
} from './timeline-data.js';
import { Cd, Hdr, textMain, textMuted } from './timeline-card-primitives.js';

export { ChildContextCard, QuickLinksStrip, RecentChangesHeroCard, StageFocusCard } from './timeline-card-overview.js';
export { GrowthSnapshotCard, OutdoorGoalCard, RecentLinesCard } from './timeline-card-summary.js';

/* ── Sleep Trend ── */

const DOMAIN_LABELS: Record<string, string> = { 'gross-motor': '大运动', 'fine-motor': '精细运动', language: '语言', cognitive: '认知', 'social-emotional': '社会情感', 'self-care': '自理' };

function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function SleepTrendCard({ summary }: { summary: SleepTrendSummary }) {
  const hasData = summary.points.length > 0;
  return (
    <Cd cls="col-span-4">
      <Hdr title="睡眠趋势" to="/profile/sleep" link="查看详情" />
      {hasData ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
                {summary.avgDurationMinutes != null ? fmtDuration(summary.avgDurationMinutes) : '--'}
              </p>
              <p className="mt-2 text-[13px]" style={{ color: textMuted }}>近两周平均时长</p>
            </div>
            <div className="text-right">
              {summary.latestBedtime ? <p className="text-[13px]" style={{ color: textMuted }}>最近入睡 <span className="font-semibold" style={{ color: textMain }}>{summary.latestBedtime}</span></p> : null}
              {summary.latestWakeTime ? <p className="mt-0.5 text-[13px]" style={{ color: textMuted }}>最近起床 <span className="font-semibold" style={{ color: textMain }}>{summary.latestWakeTime}</span></p> : null}
            </div>
          </div>
          <div className="mt-6 flex items-end gap-2">
            {summary.points.map((point) => {
              const maxDur = Math.max(...summary.points.map((p) => p.durationMinutes));
              const minDur = Math.min(...summary.points.map((p) => p.durationMinutes));
              const range = maxDur - minDur || 1;
              const height = Math.max(((point.durationMinutes - minDur) / range) * 56 + 16, 16);
              return (
                <div key={point.date} className="flex flex-1 flex-col items-center gap-1.5" title={`${point.date}: ${fmtDuration(point.durationMinutes)}`}>
                  <div className="w-full rounded-lg" style={{ height, background: '#818CF8' }} />
                  <span className="text-[12px] font-medium" style={{ color: '#64748b' }}>{point.date.slice(5).replace('-', '/')}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>还没有睡眠记录</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>记录第一条睡眠数据后，这里会显示近两周的睡眠趋势。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Vision Snapshot ── */

export function VisionCard({ snapshot }: { snapshot: VisionSnapshotSummary }) {
  const hasData = snapshot.leftEye != null || snapshot.rightEye != null;
  return (
    <Cd cls="col-span-4">
      <Hdr title="视力" to="/profile/vision" link="查看详情" />
      {hasData ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-5">
              {/* Left eye */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(96,165,250,0.12)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div>
                  <p className="text-[12px]" style={{ color: textMuted }}>左眼</p>
                  <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
                    {snapshot.leftEye ?? '--'}
                  </p>
                </div>
              </div>
              {/* Right eye */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(96,165,250,0.12)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div>
                  <p className="text-[12px]" style={{ color: textMuted }}>右眼</p>
                  <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
                    {snapshot.rightEye ?? '--'}
                  </p>
                </div>
              </div>
            </div>
            <span className="text-[12px]" style={{ color: '#64748b' }}>{snapshot.measuredLabel}</span>
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>还没有视力记录</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>记录一次视力检查后，这里会显示左右眼数据。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Milestone ── */

export function MilestoneTimelineCard({ summary }: { summary: MilestoneTimelineSummary }) {
  const hasAchieved = summary.recentlyAchieved.length > 0;
  const hasUpcoming = summary.upcoming.length > 0;
  return (
    <Cd cls="col-span-4">
      <Hdr title="里程碑" to="/profile/milestones" link="查看全部" />
      {hasAchieved ? (
        <div className="mb-4">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#4ECCA3' }}>最近达成</p>
          <div className="space-y-2">
            {summary.recentlyAchieved.map((item) => (
              <div key={item.milestoneId} className="flex items-center gap-3 rounded-[14px] px-4 py-3 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ background: 'rgba(78,204,163,0.15)', color: '#4ECCA3' }}>&#10003;</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                  <p className="text-[12px]" style={{ color: textMuted }}>{DOMAIN_LABELS[item.domain] ?? item.domain} · {item.achievedAt ? fmtRel(item.achievedAt) : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {hasUpcoming ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>接下来关注</p>
          <div className="space-y-2">
            {summary.upcoming.map((item) => (
              <div key={item.milestoneId} className="flex items-center gap-3 rounded-[14px] px-4 py-3 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px]" style={{ background: 'rgba(129,140,248,0.15)', color: '#818CF8' }}>&#9679;</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                  <p className="text-[12px]" style={{ color: textMuted }}>{DOMAIN_LABELS[item.domain] ?? item.domain} · 通常 {item.typicalAgeLabel}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!hasAchieved && !hasUpcoming ? (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>当前阶段暂无匹配的里程碑</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>随着孩子成长，新的发展里程碑会自动出现在这里。</p>
        </div>
      ) : null}
    </Cd>
  );
}

/* ── Observation Distribution ── */

export function ObservationDistributionCard({ summary }: { summary: ObservationDistributionSummary }) {
  const hasData = summary.items.length > 0;
  return (
    <Cd cls="col-span-4">
      <Hdr title="观察维度分布" to="/journal" link="查看记录" />
      {hasData ? (
        <>
          <p className="mb-5 text-[13px]" style={{ color: textMuted }}>近 30 天 · 共 {summary.totalEntries} 条有维度标记的记录</p>
          <div className="space-y-3.5">
            {summary.items.map((item) => (
              <div key={item.dimensionId}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-semibold" style={{ color: textMain }}>{item.displayName}</span>
                  <span className="text-[12px]" style={{ color: '#64748b' }}>{item.count} 条 · {Math.round(item.ratio * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(item.ratio * 100, 4)}%`, background: '#818CF8' }} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>还没有带维度标记的观察记录</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>在记录观察时选择一个维度，这里就会显示你关注的分布情况。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Monthly Report ── */

export function MonthlyReportCard({ report }: { report: MonthlyReportSummary }) {
  try {
    const content = parseReportContent(report.content);
    const teaser = content.version === 2 ? content.teaser : content.overview?.slice(0, 2).join(' ') ?? '';
    const actionText = content.version === 2 ? content.actionItems[0]?.text : null;
    return (
      <Cd cls="col-span-4">
        <Hdr title="本月成长摘要" to="/reports" link="查看完整报告" />
        <p className="text-[14px] leading-[1.8]" style={{ color: textMain }}>{teaser}</p>
        {actionText ? (
          <div className="mt-4 rounded-[14px] p-4 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: textMuted }}>本月待办</p>
            <p className="mt-1.5 text-[14px] font-medium" style={{ color: textMain }}>{actionText}</p>
          </div>
        ) : null}
      </Cd>
    );
  } catch { return null; }
}

/* ── Growth trends ── */
