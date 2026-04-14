import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { parseReportContent } from '../reports/structured-report.js';
import {
  C,
  DOMAIN_ROUTES,
  buildQuickLinks,
  describeNurtureMode,
  fmtRel,
  formatAgeLabel,
  type DataGapAlertItem,
  type GrowthTrendItem,
  type MonthlyReportSummary,
  type RecentChangeItem,
  type RecentLineItem,
  type TimelineHomeViewModel,
} from './timeline-data.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';

export function Cd({
  children,
  cls = '',
  style,
}: {
  children: React.ReactNode;
  cls?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`bg-white ${C.radius} p-5 ${cls}`} style={{ boxShadow: C.shadow, ...style }}>
      {children}
    </div>
  );
}

export function Hdr({
  title,
  to,
  link = '查看全部',
}: {
  title: string;
  to?: string;
  link?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>
        {title}
      </h3>
      {to ? (
        <Link to={to} className="text-[11px] hover:underline" style={{ color: C.sub }}>
          {link}
        </Link>
      ) : null}
    </div>
  );
}

function ChildSwitchPopover({
  child,
  childList,
}: {
  child: ChildProfile;
  childList: ChildProfile[];
}) {
  const { setActiveChildId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openPicker = useCallback(() => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  }, []);

  const closePicker = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        closePicker();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mounted, closePicker]);

  if (childList.length <= 1) return null;

  return (
    <div ref={ref} className="absolute right-4 top-4 z-20">
      <button
        type="button"
        onClick={() => (open ? closePicker() : openPicker())}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-white/15 transition-colors hover:bg-white/25"
        title="切换孩子"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      </button>
      {mounted ? (
        <div
          className="absolute right-0 top-10 min-w-[200px] rounded-2xl p-1.5"
          onTransitionEnd={() => {
            if (!open) setMounted(false);
          }}
          style={{
            background: '#fff',
            boxShadow: '0 8px 28px rgba(20, 36, 64, 0.18)',
            opacity: open ? 1 : 0,
            transform: open ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.96)',
            transformOrigin: 'top right',
            transition: 'opacity 0.18s ease, transform 0.18s ease',
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
          {childList.map((item, index) => {
            const isActive = item.childId === child.childId;
            return (
              <button
                key={item.childId}
                type="button"
                onClick={() => {
                  setActiveChildId(item.childId);
                  closePicker();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[#f5f7f8]"
                style={{
                  background: isActive ? '#EEF3F1' : undefined,
                  opacity: open ? 1 : 0,
                  transform: open ? 'translateY(0)' : 'translateY(-4px)',
                  transition: `opacity 0.18s ease ${index * 0.03}s, transform 0.18s ease ${index * 0.03}s`,
                }}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ background: isActive ? C.cardProfile : '#dfe5e9', color: isActive ? '#fff' : C.text }}
                >
                  {item.displayName.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium" style={{ color: C.text }}>
                    {item.displayName}
                  </p>
                  <p className="text-[10px]" style={{ color: C.sub }}>
                    {formatAgeLabel(computeAgeMonths(item.birthDate))} · {item.gender === 'female' ? '女孩' : '男孩'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ChildContextCard({
  child,
  childList,
  ageMonths,
}: {
  child: ChildProfile;
  childList: ChildProfile[];
  ageMonths: number;
}) {
  return (
    <div className={`col-span-2 row-span-2 ${C.radius} relative overflow-hidden`} style={{ boxShadow: C.shadow }}>
      <div
        className="relative flex h-full flex-col items-center p-5 pt-12"
        style={{ background: 'linear-gradient(160deg, #80A9D5 0%, #6F96C3 54%, #6488B7 100%)' }}
      >
        <ChildSwitchPopover child={child} childList={childList} />

        {child.avatarPath ? (
          <img
            src={convertFileSrc(child.avatarPath)}
            alt=""
            className="h-20 w-20 rounded-full border-[3px] object-cover"
            style={{ borderColor: 'rgba(255,255,255,0.4)', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
          />
        ) : (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] text-[30px] font-bold text-white"
            style={{ borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
          >
            {child.displayName.charAt(0)}
          </div>
        )}

        <p className="mt-4 max-w-full truncate text-center text-[18px] font-bold text-white">
          {child.displayName}
        </p>
        <p className="mt-1 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {formatAgeLabel(ageMonths)} · {child.gender === 'female' ? '女孩' : '男孩'}
        </p>

        <span
          className="mt-3 rounded-full px-3 py-1 text-[10px] font-medium"
          style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}
        >
          {describeNurtureMode(child.nurtureMode)}
        </span>

        <Link
          to="/profile"
          className="mt-auto text-[11px] font-medium transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          查看完整档案 &rarr;
        </Link>
      </div>
    </div>
  );
}

export function RecentChangesHeroCard({ items }: { items: RecentChangeItem[] }) {
  const lead = items[0] ?? null;
  const secondary = items.slice(1);

  return (
    <Cd cls="col-span-6 row-span-2" style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f7fbf3 100%)' }}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.02em]" style={{ color: '#6a8d2c' }}>
            最近 7 天
          </p>
          <h2 className="mt-1 text-[20px] font-bold" style={{ color: C.text }}>
            最近变化
          </h2>
        </div>
        <Link to="/profile" className="text-[11px] hover:underline" style={{ color: C.sub }}>
          查看档案
        </Link>
      </div>

      {lead ? (
        <div className="grid grid-cols-5 gap-3">
          <Link
            to={lead.to}
            className="col-span-3 rounded-[18px] p-5 transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: '#eef6df' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="text-[22px]">{lead.icon}</span>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium" style={{ color: '#6a8d2c' }}>
                {lead.label}
              </span>
            </div>
            <p className="text-[19px] font-bold leading-snug" style={{ color: C.text }}>
              {lead.title}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: '#52606f' }}>
              {lead.detail}
            </p>
          </Link>
          <div className="col-span-2 space-y-3">
            {secondary.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                className="block rounded-[16px] p-4 transition-transform duration-200 hover:-translate-y-0.5"
                style={{ background: '#f5f7f8' }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[18px]">{item.icon}</span>
                  <span className="text-[10px] font-medium" style={{ color: C.sub }}>
                    {item.label}
                  </span>
                </div>
                <p className="text-[13px] font-semibold leading-snug" style={{ color: C.text }}>
                  {item.title}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
                  {item.detail}
                </p>
              </Link>
            ))}
            {secondary.length === 0 ? (
              <div className="rounded-[16px] p-4" style={{ background: '#f5f7f8' }}>
                <p className="text-[12px] font-medium" style={{ color: C.text }}>
                  再记录一点会更完整
                </p>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
                  继续补充睡眠、测量或观察后，这里会把最近变化串成更完整的脉络。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-[18px] p-6" style={{ background: '#f5f7f8' }}>
          <p className="text-[14px] font-semibold" style={{ color: C.text }}>
            最近 7 天还没有新的变化
          </p>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.sub }}>
            先记录一次测量、观察或睡眠数据，首页会在这里归纳最近的变化。
          </p>
          <Link to="/journal" className="mt-4 inline-flex text-[12px] font-medium hover:underline" style={{ color: '#6a8d2c' }}>
            去记录一条
          </Link>
        </div>
      )}
    </Cd>
  );
}

export function StageFocusCard({
  periods,
  reminders,
}: {
  periods: Array<{ periodId: string; title: string; observableSigns: string[]; ageRange: { peakMonths: number } }>;
  reminders: ActiveReminder[];
}) {
  return (
    <Cd cls="col-span-4">
      <Hdr title="当前阶段重点" to="/reminders" link="查看阶段提醒" />
      {periods.length > 0 ? (
        <div className="space-y-3">
          {periods.slice(0, 2).map((period) => (
            <div key={period.periodId} className="rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-600">敏感期</span>
                <p className="text-[13px] font-semibold" style={{ color: C.text }}>
                  {period.title}
                </p>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.sub }}>
                {period.observableSigns[0] ?? '这个阶段值得继续观察孩子最近的变化。'}
              </p>
              <Link
                to={`/journal?topic=${encodeURIComponent(period.title)}`}
                className="mt-2 inline-flex rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors hover:opacity-90"
                style={{ background: '#f5eedd', color: '#92780a' }}
              >
                去记录
              </Link>
            </div>
          ))}
          {reminders[0] ? (
            <div className="rounded-[14px] p-4" style={{ background: '#eef3fb' }}>
              <p className="text-[10px] font-medium" style={{ color: '#5b7fa6' }}>
                阶段提醒
              </p>
              <p className="mt-1 text-[13px] font-semibold" style={{ color: C.text }}>
                {reminders[0].rule.title}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
                {reminders[0].rule.description}
              </p>
              <Link
                to={`/journal?reminderRuleId=${encodeURIComponent(reminders[0].rule.ruleId)}&repeatIndex=${reminders[0].repeatIndex}`}
                className="mt-2 inline-flex rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors hover:opacity-90"
                style={{ background: '#dde8f5', color: '#4f7ca9' }}
              >
                去记录
              </Link>
            </div>
          ) : null}
        </div>
      ) : reminders.length > 0 ? (
        <div className="space-y-3">
          {reminders.slice(0, 2).map((reminder) => (
            <div key={`${reminder.rule.ruleId}-${reminder.repeatIndex}`} className="rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
              <p className="text-[13px] font-semibold" style={{ color: C.text }}>
                {reminder.rule.title}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
                {reminder.rule.description}
              </p>
              <Link
                to={`/journal?reminderRuleId=${encodeURIComponent(reminder.rule.ruleId)}&repeatIndex=${reminder.repeatIndex}`}
                className="mt-2 inline-flex rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors hover:opacity-90"
                style={{ background: '#eef5d8', color: '#6a8d2c' }}
              >
                去记录
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
          <p className="text-[13px] font-semibold" style={{ color: C.text }}>
            当前阶段相对平稳
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
            等下一批阶段提醒或敏感期命中后，这里会优先解释为什么值得关注。
          </p>
        </div>
      )}
    </Cd>
  );
}


export function QuickLinksStrip({ ageMonths }: { ageMonths: number }) {
  const links = buildQuickLinks(ageMonths);
  return (
    <Cd cls="col-span-8">
      <div>
        <p className="text-[13px] font-semibold" style={{ color: C.text }}>
          常用入口
        </p>
      </div>
      <div className="mt-4 grid grid-cols-6 gap-2">
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group rounded-[16px] px-3 py-3 transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: '#f5f7f8' }}
          >
            <div className="mb-2 text-[22px]">{item.emoji}</div>
            <p className="text-[11px] font-medium" style={{ color: C.text }}>
              {item.label}
            </p>
          </Link>
        ))}
      </div>
    </Cd>
  );
}

export function MonthlyReportCard({ report }: { report: MonthlyReportSummary }) {
  try {
    const content = parseReportContent(report.content);
    const teaser = content.version === 2 ? content.teaser : content.overview?.slice(0, 2).join(' ') ?? '';
    const actionText = content.version === 2 ? content.actionItems[0]?.text : null;

    return (
      <Cd cls="col-span-4">
        <Hdr title="本月成长摘要" to="/reports" link="查看完整报告" />
        <p className="text-[12px] leading-[1.8]" style={{ color: C.text }}>
          {teaser}
        </p>
        {actionText ? (
          <div className="mt-3 rounded-[14px] p-3" style={{ background: '#f5f7f8' }}>
            <p className="text-[10px] font-medium" style={{ color: C.sub }}>
              本月待办
            </p>
            <p className="mt-1 text-[12px]" style={{ color: C.text }}>
              {actionText}
            </p>
          </div>
        ) : null}
      </Cd>
    );
  } catch {
    return null;
  }
}

const TREND_COLORS: Record<string, { stroke: string; gradId: string; grad0: string }> = {
  height: { stroke: '#6a8d2c', gradId: 'heightGrad', grad0: '#6a8d2c' },
  weight: { stroke: '#4f7ca9', gradId: 'weightGrad', grad0: '#4f7ca9' },
};

function MiniTrendRow({ trend }: { trend: GrowthTrendItem }) {
  const colors = TREND_COLORS[trend.id] ?? TREND_COLORS.height!;
  const hasChart = trend.points.length >= 2;
  const hasDelta = trend.delta !== null;
  const isUp = hasDelta && trend.delta! > 0;
  const isDown = hasDelta && trend.delta! < 0;
  const deltaColor = isUp ? '#16a34a' : isDown ? '#dc2626' : C.sub;
  const deltaArrow = isUp ? '↑' : isDown ? '↓' : '';

  return (
    <div className="rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium" style={{ color: C.sub }}>{trend.label}</p>
          {hasDelta ? (
            <p className="mt-1 text-[10px] font-medium" style={{ color: deltaColor }}>
              {deltaArrow} {trend.delta! > 0 ? '+' : ''}{trend.delta}{trend.unit ? ` ${trend.unit}` : ''}
              {trend.deltaPercent !== null ? (
                <span className="ml-1 font-normal" style={{ color: C.sub }}>
                  ({trend.deltaPercent! > 0 ? '+' : ''}{trend.deltaPercent}%)
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <span className="text-[22px] font-bold leading-none" style={{ color: C.text }}>
            {trend.latestValue}
          </span>
          {trend.unit ? (
            <span className="ml-1 text-[10px] font-normal" style={{ color: C.sub }}>
              {trend.unit}
            </span>
          ) : null}
        </div>
      </div>
      {hasChart ? (
        <div className="mt-2">
          <ResponsiveContainer width="100%" height={64}>
            <AreaChart data={trend.points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id={colors.gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.grad0} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={colors.grad0} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis tick={{ fontSize: 9, fill: C.sub }} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={30} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={colors.stroke}
                strokeWidth={2}
                fill={`url(#${colors.gradId})`}
                dot={false}
                activeDot={{ r: 3, fill: colors.stroke }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

export function GrowthSnapshotCard({
  snapshot,
}: {
  snapshot: TimelineHomeViewModel['growthSnapshot'];
}) {
  return (
    <Cd cls="col-span-4">
      <Hdr title="成长快照" to="/profile/growth" link="查看曲线" />
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] font-medium" style={{ color: C.text }}>
          最近一次成长测量
        </p>
        <span className="text-[10px]" style={{ color: C.sub }}>
          {snapshot.updatedLabel}
        </span>
      </div>
      {snapshot.trends.length > 0 ? (
        <div className="space-y-3">
          {snapshot.trends.map((trend) => (
            <MiniTrendRow key={trend.id} trend={trend} />
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] p-4" style={{ background: '#f6f8f5' }}>
          <p className="text-[13px] font-semibold" style={{ color: C.text }}>
            还没有成长测量快照
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
            记录第一条身高或体重后，这里会自动显示趋势曲线。
          </p>
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
        <div className="grid grid-cols-4 gap-3">
          {lines.map((line) => (
            <Link key={line.id} to={line.to} className="rounded-[16px] p-4 transition-transform duration-200 hover:-translate-y-0.5" style={{ background: '#f5f3ef' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium" style={{ color: C.sub }}>
                  {line.badge}
                </span>
                <span className="text-[10px]" style={{ color: '#b4b7bd' }}>
                  {fmtRel(line.recordedAt)}
                </span>
              </div>
              <p className="mt-3 line-clamp-3 text-[12px] leading-relaxed" style={{ color: C.text }}>
                {line.title}
              </p>
              <p className="mt-2 text-[10px]" style={{ color: C.sub }}>
                {line.detail}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] p-4" style={{ background: '#f5f7f8' }}>
          <p className="text-[13px] font-semibold" style={{ color: C.text }}>
            最近还没有新的线索
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.sub }}>
            记录一条观察、日记或语音后，这里会自动显示最近留下的内容。
          </p>
        </div>
      )}
    </Cd>
  );
}
