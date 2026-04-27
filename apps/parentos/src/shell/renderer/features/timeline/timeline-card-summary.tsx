import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import type { OutdoorRecordRow } from '../../bridge/sqlite-bridge.js';
import { getWeekStart, computeWeekSummary, buildOutdoorMessage, fmtDate, DEFAULT_OUTDOOR_GOAL_MINUTES } from '../outdoor/outdoor-helpers.js';
import { fmtRel, type GrowthSnapshotMetric, type GrowthTrendItem, type RecentLineItem } from './timeline-data.js';
import { Cd, Hdr, textMain, textMuted } from './timeline-card-primitives.js';

const TREND_COLORS: Record<string, { stroke: string; gradId: string; grad0: string }> = {
  height: { stroke: '#818CF8', gradId: 'heightGrad', grad0: '#C4B5FD' },
  weight: { stroke: '#4ECCA3', gradId: 'weightGrad', grad0: '#A7F3D0' },
};

function MiniTrendRow({ trend }: { trend: GrowthTrendItem }) {
  const colors = TREND_COLORS[trend.id] ?? TREND_COLORS.height!;
  const hasChart = trend.points.length >= 2;
  const hasDelta = trend.delta !== null;
  const isUp = hasDelta && trend.delta! > 0;
  const isDown = hasDelta && trend.delta! < 0;
  const deltaColor = isUp ? '#22c55e' : isDown ? '#ef4444' : textMuted;
  const deltaArrow = isUp ? '↑' : isDown ? '↓' : '';

  return (
    <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium" style={{ color: textMuted }}>{trend.label}</p>
          {hasDelta ? (
            <p className="mt-1 text-[12px] font-semibold" style={{ color: deltaColor }}>
              {deltaArrow} {trend.delta! > 0 ? '+' : ''}{trend.delta}{trend.unit ? ` ${trend.unit}` : ''}
              {trend.deltaPercent !== null ? <span className="ml-1 font-normal" style={{ color: '#64748b' }}>({trend.deltaPercent! > 0 ? '+' : ''}{trend.deltaPercent}%)</span> : null}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <span className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain }}>{trend.latestValue}</span>
          {trend.unit ? <span className="ml-1 text-[12px]" style={{ color: '#64748b' }}>{trend.unit}</span> : null}
        </div>
      </div>
      {hasChart ? (
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={trend.points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id={colors.gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.grad0} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={colors.grad0} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={30} />
              <Area type="monotone" dataKey="value" stroke={colors.stroke} strokeWidth={2} fill={`url(#${colors.gradId})`} dot={false} activeDot={{ r: 3, fill: colors.stroke }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

export function GrowthSnapshotCard({ snapshot }: { snapshot: { updatedAt: string | null; updatedLabel: string; metrics: GrowthSnapshotMetric[]; trends: GrowthTrendItem[] } }) {
  return (
    <Cd cls="col-span-4">
      <Hdr title="成长快照" to="/profile/growth" link="查看曲线" />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[14px] font-semibold" style={{ color: textMain }}>最近一次成长测量</p>
        <span className="text-[12px]" style={{ color: '#64748b' }}>{snapshot.updatedLabel}</span>
      </div>
      {snapshot.trends.length > 0 ? (
        <div className="space-y-3">{snapshot.trends.map((trend) => <MiniTrendRow key={trend.id} trend={trend} />)}</div>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>还没有成长测量快照</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>记录第一条身高或体重后，这里会自动显示趋势曲线。</p>
        </div>
      )}
    </Cd>
  );
}

export function RecentLinesCard({ lines }: { lines: RecentLineItem[] }) {
  return (
    <Cd cls="col-span-8">
      <Hdr title="最近线索" to="/journal" link="查看全部记录" />
      {lines.length > 0 ? (
        <div className="grid grid-cols-4 gap-4">
          {lines.map((line) => (
            <Link key={line.id} to={line.to} className="rounded-[16px] p-5 transition-all duration-200 hover:-translate-y-1 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
              style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                  style={line.badgeTone === 'keepsake'
                    ? { background: 'rgba(245, 158, 11, 0.12)', color: '#b45309' }
                    : { background: 'rgba(255,255,255,0.6)', color: textMuted }}
                >
                  {line.badge}
                </span>
                <span className="text-[12px]" style={{ color: '#64748b' }}>{fmtRel(line.recordedAt)}</span>
              </div>
              <p className="mt-3 line-clamp-3 text-[14px] font-medium leading-relaxed" style={{ color: textMain }}>{line.title}</p>
              <p className="mt-2 text-[12px]" style={{ color: textMuted }}>{line.detail}</p>
              {line.tag ? <p className="mt-2 text-[12px] font-medium" style={{ color: '#b45309' }}>{line.tag}</p> : null}
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>最近还没有新的线索</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>记录一条观察、日记或语音后，这里会自动显示最近留下的内容。</p>
        </div>
      )}
    </Cd>
  );
}

export function OutdoorGoalCard({
  records,
  goalMinutes,
}: {
  records: OutdoorRecordRow[];
  goalMinutes: number | null;
}) {
  const effectiveGoal = goalMinutes ?? DEFAULT_OUTDOOR_GOAL_MINUTES;
  const todayStr = fmtDate(new Date());
  const weekStart = getWeekStart(new Date());
  const summary = computeWeekSummary(records, effectiveGoal, weekStart, todayStr);
  const message = buildOutdoorMessage(summary, false);
  const progressPercent = Math.min(100, Math.round((summary.totalMinutes / effectiveGoal) * 100));
  const barColor = summary.isComplete ? '#4ECCA3' : '#818CF8';

  if (goalMinutes === null) {
    return (
      <Cd cls="col-span-4">
        <Hdr title="每周户外目标" to="/profile/outdoor" link="设定目标" />
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>还没有设定户外目标</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>
            每天 2 小时以上的户外活动有助于保护视力。设定每周目标，追踪孩子的户外时间。
          </p>
        </div>
      </Cd>
    );
  }

  return (
    <Cd cls="col-span-4">
      <Hdr title="每周户外目标" to="/profile/outdoor" />
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <p className="text-[18px] font-bold tabular-nums" style={{ color: textMain }}>
            {summary.totalMinutes} <span className="text-[14px] font-normal" style={{ color: textMuted }}>/ {effectiveGoal} 分钟</span>
          </p>
          <span className="text-[14px] font-medium tabular-nums" style={{ color: barColor }}>{progressPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.5)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progressPercent}%`, background: barColor }} />
        </div>
        <p className="text-[14px]" style={{ color: textMuted }}>{message.primary}</p>
        {message.secondary ? <p className="text-[13px]" style={{ color: textMuted }}>{message.secondary}</p> : null}
      </div>
    </Cd>
  );
}
