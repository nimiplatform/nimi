import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { Bone, BookOpen, Eye, Mic, Moon, Ruler, Sparkles, Syringe, Trophy } from 'lucide-react';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { parseReportContent } from '../reports/structured-report.js';
import {
  buildQuickLinks,
  describeNurtureMode,
  fmtRel,
  formatAgeLabel,
  type GrowthSnapshotMetric,
  type GrowthTrendItem,
  type MilestoneTimelineSummary,
  type MonthlyReportSummary,
  type ObservationDistributionSummary,
  type RecentChangeIconName,
  type RecentChangeItem,
  type RecentLineItem,
  type SleepTrendSummary,
  type VisionSnapshotSummary,
} from './timeline-data.js';
import type { OutdoorRecordRow } from '../../bridge/sqlite-bridge.js';
import { getWeekStart, computeWeekSummary, buildOutdoorMessage, fmtDate, DEFAULT_OUTDOOR_GOAL_MINUTES } from '../outdoor/outdoor-helpers.js';

const textMain = '#1e293b';
const textMuted = '#475569';
const textSoft = '#94a3b8';

/* Frosted inner panel — white translucency + faint ring + soft elevation.
 * Used to replace hard #F0F4F8 + #E2E8F0 inner frames across timeline cards.
 */
const softPanelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(255,255,255,0.55)',
  boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
};

const softPanelSubtleStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.45)',
  border: '1px solid rgba(255,255,255,0.5)',
};

const ICON_BY_DOMAIN: Record<RecentChangeIconName, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  moon: Moon,
  book: BookOpen,
  mic: Mic,
  sparkle: Sparkles,
  trophy: Trophy,
  syringe: Syringe,
  ruler: Ruler,
  eye: Eye,
  bone: Bone,
};

const ICON_TONE: Record<RecentChangeIconName, { bg: string; fg: string }> = {
  moon: { bg: 'rgba(129,140,248,0.14)', fg: '#6366f1' },
  book: { bg: 'rgba(251,146,60,0.14)', fg: '#ea580c' },
  mic: { bg: 'rgba(244,114,182,0.14)', fg: '#db2777' },
  sparkle: { bg: 'rgba(251,191,36,0.16)', fg: '#d97706' },
  trophy: { bg: 'rgba(78,204,163,0.16)', fg: '#059669' },
  syringe: { bg: 'rgba(251,191,36,0.14)', fg: '#d97706' },
  ruler: { bg: 'rgba(78,204,163,0.14)', fg: '#059669' },
  eye: { bg: 'rgba(96,165,250,0.14)', fg: '#2563eb' },
  bone: { bg: 'rgba(148,163,184,0.18)', fg: '#475569' },
};

function RecentChangeIcon({ item, size = 18 }: { item: RecentChangeItem; size?: number }) {
  const key = item.iconName ?? 'book';
  const Icon = ICON_BY_DOMAIN[key] ?? BookOpen;
  const tone = ICON_TONE[key] ?? ICON_TONE.book;
  const box = size + 18;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: box, height: box, background: tone.bg, color: tone.fg }}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={1.75} />
    </span>
  );
}

/* ── Glass Bento Card ── */

export function Cd({
  children,
  cls = '',
  style,
  material = 'glass-regular',
}: {
  children: React.ReactNode;
  cls?: string;
  style?: React.CSSProperties;
  material?: 'glass-regular' | 'glass-thick';
}) {
  return (
    <Surface
      as="div"
      material={material}
      padding="none"
      tone="card"
      className={`p-7 transition-transform hover:-translate-y-0.5 ${cls}`}
      style={style}
    >
      {children}
    </Surface>
  );
}

export function Hdr({ title, to, link = '查看全部' }: { title: string; to?: string; link?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h3 className="text-[15px] font-semibold" style={{ color: textMain }}>{title}</h3>
      {to ? <Link to={to} className="text-[11px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }}>{link}</Link> : null}
    </div>
  );
}

/* ── Faint icon tints ── */
/* Micro-warmth macaron tints — cold/warm contrast per icon */
const ICON_TINT: Record<string, string> = {
  '📏': 'rgba(78,204,163,0.12)',   /* mint — growth */
  '💉': 'rgba(251,191,36,0.10)',   /* warm amber — vaccines */
  '😴': 'rgba(129,140,248,0.12)',  /* periwinkle — sleep */
  '📝': 'rgba(251,146,60,0.10)',   /* peach orange — journal */
  '📄': 'rgba(129,140,248,0.10)',  /* periwinkle — reports */
  '🏥': 'rgba(248,113,113,0.10)',  /* soft coral — medical */
  '🎯': 'rgba(78,204,163,0.12)',   /* mint — milestones */
  '👁️': 'rgba(96,165,250,0.12)',   /* sky blue — vision */
  '🦷': 'rgba(251,191,36,0.10)',   /* warm amber — dental */
  '🏃': 'rgba(251,146,60,0.10)',   /* peach orange — fitness */
  '🌱': 'rgba(78,204,163,0.12)',   /* mint — tanner */
  '🧍': 'rgba(244,114,182,0.10)',  /* rose pink — posture */
};

function ChildSwitchPopover({ child, childList }: { child: ChildProfile; childList: ChildProfile[] }) {
  const { setActiveChildId } = useAppStore();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openPicker = useCallback(() => { setMounted(true); requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true))); }, []);
  const closePicker = useCallback(() => { setOpen(false); }, []);

  useEffect(() => {
    if (!mounted) return;
    const onMouseDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) closePicker(); };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mounted, closePicker]);

  if (childList.length <= 1) return null;

  return (
    <div ref={ref} className="absolute right-5 top-5 z-20">
      <button type="button" onClick={() => (open ? closePicker() : openPicker())}
        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5" title="切换孩子" style={{ color: textMuted }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      </button>
      {mounted ? (
        <Surface as="div" material="glass-thick" padding="none" tone="card" className="absolute right-0 top-9 min-w-[200px] p-1.5"
          onTransitionEnd={() => { if (!open) setMounted(false); }}
          style={{ opacity: open ? 1 : 0, transform: open ? 'translateY(0)' : 'translateY(4px) scale(0.98)', transformOrigin: 'top right', transition: 'opacity 0.15s ease, transform 0.15s ease', pointerEvents: open ? 'auto' : 'none' }}>
          {childList.map((item, index) => {
            const isActive = item.childId === child.childId;
            return (
              <button key={item.childId} type="button" onClick={() => { setActiveChildId(item.childId); closePicker(); }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/60"
                style={{ ...(isActive ? { background: 'rgba(78,204,163,0.1)' } : undefined), opacity: open ? 1 : 0, transform: open ? 'translateY(0)' : 'translateY(3px)', transition: `opacity 0.15s ease ${index * 0.03}s, transform 0.15s ease ${index * 0.03}s` }}>
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: isActive ? '#4ECCA3' : '#E2E8F0', color: isActive ? '#fff' : textMain }}>{item.displayName.charAt(0)}</div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold" style={{ color: isActive ? '#2F7D6B' : textMain }}>{item.displayName}</p>
                  <p className="text-[10px]" style={{ color: textMuted }}>{formatAgeLabel(computeAgeMonths(item.birthDate))} · {item.gender === 'female' ? '女孩' : '男孩'}</p>
                </div>
              </button>
            );
          })}
        </Surface>
      ) : null}
    </div>
  );
}

/* ── Profile Card — Linear/Vercel/Apple-inspired, mesh-gradient accent ── */

/**
 * Gender-tinted mesh gradient for the profile card background.
 * Palette is pulled from the page-level ambient (blue / pink / lavender) so the card
 * reads as a more saturated patch of the same wash instead of a foreign color island.
 * - female → pink-dominant with lavender + soft rose highlight
 * - male   → blue-dominant with lavender + soft cyan highlight
 */
function getProfileMeshBackground(gender: ChildProfile['gender']): string {
  if (gender === 'female') {
    return [
      'radial-gradient(at 22% 18%, rgba(255, 207, 226, 0.38) 0px, transparent 55%)',
      'radial-gradient(at 82% 22%, rgba(221, 214, 254, 0.32) 0px, transparent 55%)',
      'radial-gradient(at 30% 88%, rgba(255, 228, 240, 0.28) 0px, transparent 55%)',
      'radial-gradient(at 80% 85%, rgba(233, 213, 255, 0.22) 0px, transparent 55%)',
    ].join(', ');
  }
  return [
    'radial-gradient(at 22% 18%, rgba(186, 230, 253, 0.38) 0px, transparent 55%)',
    'radial-gradient(at 82% 22%, rgba(221, 214, 254, 0.30) 0px, transparent 55%)',
    'radial-gradient(at 30% 88%, rgba(207, 232, 252, 0.28) 0px, transparent 55%)',
    'radial-gradient(at 80% 85%, rgba(224, 231, 255, 0.22) 0px, transparent 55%)',
  ].join(', ');
}

export function ChildContextCard({ child, childList, ageMonths }: { child: ChildProfile; childList: ChildProfile[]; ageMonths: number }) {
  const meshBackground = getProfileMeshBackground(child.gender);
  return (
    <div
      className="col-span-2 row-span-2 relative z-10"
      style={{
        borderRadius: 24,
        background: '#ffffff',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.04), 0 18px 36px rgba(15,23,42,0.04)',
      }}
    >
      {/* Clipped visual layer — mesh gradient + content. Switcher sits outside so its popover can overflow. */}
      <div
        className="relative flex h-full flex-col items-center overflow-hidden px-6 pb-6 pt-12"
        style={{ borderRadius: 24, isolation: 'isolate' }}
      >
        {/* Diffuse gender-tinted mesh gradient (ambient accent only) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: meshBackground, filter: 'blur(24px)', zIndex: 0 }}
        />

        {/* Avatar — 120px, white semi-transparent ring with soft halo */}
        <div
          className="relative"
          style={{
            width: 120,
            height: 120,
            padding: 4,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.6)',
            boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          {child.avatarPath ? (
            <img
              src={convertFileSrc(child.avatarPath)}
              alt=""
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center rounded-full text-[40px] font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)' }}
            >
              {child.displayName.charAt(0)}
            </div>
          )}
        </div>

        {/* Name + subtitle */}
        <div className="relative mt-6 max-w-full text-center">
          <h2
            className="truncate text-[22px] font-semibold tracking-tight"
            style={{ color: '#1d1d1f', letterSpacing: '-0.3px' }}
          >
            {child.displayName}
          </h2>
          <p className="mt-1.5 text-[12px]" style={{ color: '#86868b' }}>
            {formatAgeLabel(ageMonths)} · {child.gender === 'female' ? '女孩' : '男孩'}
          </p>
        </div>

        {/* Action area pinned to the bottom */}
        <div className="relative mt-auto flex w-full flex-col items-center gap-3">
          {/* Status badge — pale green + dot */}
          <span
            className="inline-flex items-center rounded-full px-3 py-[5px] text-[11px] font-medium"
            style={{ background: 'rgba(52,199,89,0.12)', color: '#248a3d' }}
          >
            <span
              className="mr-1.5 inline-block h-[6px] w-[6px] rounded-full"
              style={{ background: '#34c759' }}
            />
            {describeNurtureMode(child.nurtureMode)}
          </span>

          {/* Ghost button — transparent default, faint gray on hover */}
          <Link
            to="/profile"
            className="flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-black/[0.04]"
            style={{ color: '#1d1d1f' }}
          >
            查看完整档案
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ml-1 opacity-60"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Switcher lives outside the clip so its dropdown can overflow the card */}
      <ChildSwitchPopover child={child} childList={childList} />
    </div>
  );
}

/* ── Recent Changes Hero ── */

function RecentChangeLeadCell({ item }: { item: RecentChangeItem }) {
  return (
    <Link
      to={item.to}
      className="col-span-3 flex flex-col rounded-[22px] p-6 transition-all duration-200 hover:-translate-y-0.5"
      style={softPanelStyle}
    >
      <div className="flex items-center gap-3">
        <RecentChangeIcon item={item} size={20} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: textSoft }}>
          {item.label}
        </span>
      </div>

      <p className="mt-5 text-[15px] font-semibold leading-snug" style={{ color: textMain, letterSpacing: '-0.1px' }}>
        {item.title}
      </p>

      {item.metric ? (
        <p className="mt-2 text-[44px] font-semibold leading-none tabular-nums" style={{ color: textMain, letterSpacing: '-1.4px' }}>
          {item.metric.value}
          {item.metric.unit ? (
            <span className="ml-1.5 text-[18px] font-medium" style={{ color: textMuted }}>{item.metric.unit}</span>
          ) : null}
        </p>
      ) : null}

      {item.summary ? (
        <p
          className="mt-3 text-[13px] leading-relaxed"
          style={{ color: textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {item.summary}
        </p>
      ) : null}

      <p className="mt-auto pt-4 text-[11px] font-medium tabular-nums" style={{ color: textSoft }}>
        {item.subtitle ?? item.detail}
      </p>
    </Link>
  );
}

function RecentChangeSecondaryCell({ item }: { item: RecentChangeItem }) {
  return (
    <Link
      to={item.to}
      className="block rounded-[18px] p-4 transition-all duration-200 hover:-translate-y-0.5"
      style={softPanelStyle}
    >
      <div className="flex items-start gap-3">
        <RecentChangeIcon item={item} size={16} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold" style={{ color: textMain }}>{item.title}</p>
          {item.summary ? (
            <p
              className="mt-1 text-[11px] leading-relaxed"
              style={{ color: textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {item.summary}
            </p>
          ) : null}
          <p className="mt-1.5 text-[10px] tabular-nums" style={{ color: textSoft }}>
            {item.subtitle ?? item.detail}
          </p>
        </div>
      </div>
    </Link>
  );
}

export function RecentChangesHeroCard({ items }: { items: RecentChangeItem[] }) {
  const lead = items[0] ?? null;
  const secondary = items.slice(1);

  return (
    <Cd cls="col-span-6 row-span-2" material="glass-thick">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.08em]" style={{ color: textSoft }}>最近 7 天</p>
          <h2 className="mt-1.5 text-[22px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
            最近变化
          </h2>
        </div>
        <Link to="/profile" className="text-[11px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }}>
          查看档案
        </Link>
      </div>

      {lead ? (
        <div className="grid grid-cols-5 gap-4">
          <RecentChangeLeadCell item={lead} />
          <div className="col-span-2 space-y-3">
            {secondary.map((item) => (
              <RecentChangeSecondaryCell key={item.id} item={item} />
            ))}
            {secondary.length === 0 ? (
              <div className="rounded-[18px] p-4" style={softPanelStyle}>
                <p className="text-[12px] font-semibold" style={{ color: textMain }}>再记录一点会更完整</p>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>
                  继续补充睡眠、测量或观察后，这里会把最近变化串成更完整的脉络。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-[22px] p-7" style={softPanelStyle}>
          <p className="text-[15px] font-semibold" style={{ color: textMain }}>最近 7 天还没有新的变化</p>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: textMuted }}>
            先记录一次测量、观察或睡眠数据，首页会在这里归纳最近的变化。
          </p>
          <Link
            to="/journal"
            className="mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all hover:-translate-y-0.5"
            style={{ background: textMain, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}
          >
            去记录一条 <span>→</span>
          </Link>
        </div>
      )}
    </Cd>
  );
}

/* ── Stage Focus ── */

export function StageFocusCard({ periods }: { periods: Array<{ periodId: string; title: string; observableSigns: string[]; ageRange: { peakMonths: number } }> }) {
  return (
    <Cd cls="col-span-4">
      <Hdr title="当前发展阶段" to="/reminders" link="查看全部提醒" />
      {periods.length > 0 ? (
        <div className="space-y-4">
          {periods.slice(0, 2).map((period) => (
            <div key={period.periodId} className="rounded-[16px] p-5" style={softPanelStyle}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600">敏感期</span>
                <p className="text-[13px] font-semibold" style={{ color: textMain }}>{period.title}</p>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed" style={{ color: textMuted }}>{period.observableSigns[0] ?? '这个阶段值得继续观察孩子最近的变化。'}</p>
              <Link to={`/journal?topic=${encodeURIComponent(period.title)}`}
                className="mt-3 inline-flex rounded-full px-4 py-1.5 text-[11px] font-medium text-white hover:-translate-y-0.5"
                style={{ background: textMain, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>去记录</Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>当前阶段相对平稳</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>下一个敏感期命中后，这里会解释为什么值得关注。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Quick Links — white micro-cards with tiny icon tint ── */

export function QuickLinksStrip({ ageMonths }: { ageMonths: number }) {
  const links = buildQuickLinks(ageMonths);
  return (
    <Cd cls="col-span-8">
      <Hdr title="常用入口" />
      <div className="grid grid-cols-6 gap-4">
        {links.map((item) => (
          <Link key={item.to} to={item.to}
            className="group flex flex-col items-center rounded-[20px] px-3 py-5 transition-all duration-200 hover:-translate-y-1"
            style={softPanelStyle}>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-[20px] transition-transform duration-200 group-hover:scale-110"
              style={{ background: ICON_TINT[item.emoji] ?? 'rgba(0,0,0,0.03)', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}>
              {item.emoji}
            </div>
            <p className="text-[11px] font-semibold" style={{ color: textMain }}>{item.label}</p>
          </Link>
        ))}
      </div>
    </Cd>
  );
}

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
              <p className="text-[28px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
                {summary.avgDurationMinutes != null ? fmtDuration(summary.avgDurationMinutes) : '--'}
              </p>
              <p className="mt-2 text-[11px]" style={{ color: textMuted }}>近两周平均时长</p>
            </div>
            <div className="text-right">
              {summary.latestBedtime ? <p className="text-[11px]" style={{ color: textMuted }}>最近入睡 <span className="font-semibold" style={{ color: textMain }}>{summary.latestBedtime}</span></p> : null}
              {summary.latestWakeTime ? <p className="mt-0.5 text-[11px]" style={{ color: textMuted }}>最近起床 <span className="font-semibold" style={{ color: textMain }}>{summary.latestWakeTime}</span></p> : null}
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
                  <span className="text-[9px] font-medium" style={{ color: '#64748b' }}>{point.date.slice(5).replace('-', '/')}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>还没有睡眠记录</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>记录第一条睡眠数据后，这里会显示近两周的睡眠趋势。</p>
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
                  <p className="text-[10px]" style={{ color: textMuted }}>左眼</p>
                  <p className="text-[22px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
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
                  <p className="text-[10px]" style={{ color: textMuted }}>右眼</p>
                  <p className="text-[22px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
                    {snapshot.rightEye ?? '--'}
                  </p>
                </div>
              </div>
            </div>
            <span className="text-[10px]" style={{ color: '#64748b' }}>{snapshot.measuredLabel}</span>
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>还没有视力记录</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>记录一次视力检查后，这里会显示左右眼数据。</p>
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
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#4ECCA3' }}>最近达成</p>
          <div className="space-y-2">
            {summary.recentlyAchieved.map((item) => (
              <div key={item.milestoneId} className="flex items-center gap-3 rounded-[14px] px-4 py-3" style={softPanelStyle}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]" style={{ background: 'rgba(78,204,163,0.15)', color: '#4ECCA3' }}>&#10003;</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                  <p className="text-[10px]" style={{ color: textMuted }}>{DOMAIN_LABELS[item.domain] ?? item.domain} · {item.achievedAt ? fmtRel(item.achievedAt) : ''}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {hasUpcoming ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>接下来关注</p>
          <div className="space-y-2">
            {summary.upcoming.map((item) => (
              <div key={item.milestoneId} className="flex items-center gap-3 rounded-[14px] px-4 py-3" style={softPanelStyle}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px]" style={{ background: 'rgba(129,140,248,0.15)', color: '#818CF8' }}>&#9679;</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                  <p className="text-[10px]" style={{ color: textMuted }}>{DOMAIN_LABELS[item.domain] ?? item.domain} · 通常 {item.typicalAgeLabel}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {!hasAchieved && !hasUpcoming ? (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>当前阶段暂无匹配的里程碑</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>随着孩子成长，新的发展里程碑会自动出现在这里。</p>
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
          <p className="mb-5 text-[11px]" style={{ color: textMuted }}>近 30 天 · 共 {summary.totalEntries} 条有维度标记的记录</p>
          <div className="space-y-3.5">
            {summary.items.map((item) => (
              <div key={item.dimensionId}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold" style={{ color: textMain }}>{item.displayName}</span>
                  <span className="text-[10px]" style={{ color: '#64748b' }}>{item.count} 条 · {Math.round(item.ratio * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(item.ratio * 100, 4)}%`, background: '#818CF8' }} />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>还没有带维度标记的观察记录</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>在记录观察时选择一个维度，这里就会显示你关注的分布情况。</p>
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
        <p className="text-[13px] leading-[1.8]" style={{ color: textMain }}>{teaser}</p>
        {actionText ? (
          <div className="mt-4 rounded-[14px] p-4" style={softPanelStyle}>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: textMuted }}>本月待办</p>
            <p className="mt-1.5 text-[12px] font-medium" style={{ color: textMain }}>{actionText}</p>
          </div>
        ) : null}
      </Cd>
    );
  } catch { return null; }
}

/* ── Growth trends ── */

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
    <div className="rounded-[16px] p-5" style={softPanelStyle}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-medium" style={{ color: textMuted }}>{trend.label}</p>
          {hasDelta ? (
            <p className="mt-1 text-[10px] font-semibold" style={{ color: deltaColor }}>
              {deltaArrow} {trend.delta! > 0 ? '+' : ''}{trend.delta}{trend.unit ? ` ${trend.unit}` : ''}
              {trend.deltaPercent !== null ? <span className="ml-1 font-normal" style={{ color: '#64748b' }}>({trend.deltaPercent! > 0 ? '+' : ''}{trend.deltaPercent}%)</span> : null}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <span className="text-[22px] font-semibold leading-none tracking-tight" style={{ color: textMain }}>{trend.latestValue}</span>
          {trend.unit ? <span className="ml-1 text-[10px]" style={{ color: '#64748b' }}>{trend.unit}</span> : null}
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
        <p className="text-[12px] font-semibold" style={{ color: textMain }}>最近一次成长测量</p>
        <span className="text-[10px]" style={{ color: '#64748b' }}>{snapshot.updatedLabel}</span>
      </div>
      {snapshot.trends.length > 0 ? (
        <div className="space-y-3">{snapshot.trends.map((trend) => <MiniTrendRow key={trend.id} trend={trend} />)}</div>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>还没有成长测量快照</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>记录第一条身高或体重后，这里会自动显示趋势曲线。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Recent Lines ── */

export function RecentLinesCard({ lines }: { lines: RecentLineItem[] }) {
  return (
    <Cd cls="col-span-8">
      <Hdr title="最近线索" to="/journal" link="查看全部记录" />
      {lines.length > 0 ? (
        <div className="grid grid-cols-4 gap-4">
          {lines.map((line) => (
            <Link key={line.id} to={line.to} className="rounded-[16px] p-5 transition-all duration-200 hover:-translate-y-1"
              style={softPanelStyle}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={line.badgeTone === 'keepsake'
                    ? { background: 'rgba(245, 158, 11, 0.12)', color: '#b45309' }
                    : { background: 'rgba(255,255,255,0.6)', color: textMuted }}
                >
                  {line.badge}
                </span>
                <span className="text-[10px]" style={{ color: '#64748b' }}>{fmtRel(line.recordedAt)}</span>
              </div>
              <p className="mt-3 line-clamp-3 text-[12px] font-medium leading-relaxed" style={{ color: textMain }}>{line.title}</p>
              <p className="mt-2 text-[10px]" style={{ color: textMuted }}>{line.detail}</p>
              {line.tag ? (
                <p className="mt-2 text-[10px] font-medium" style={{ color: '#b45309' }}>
                  {line.tag}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>最近还没有新的线索</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>记录一条观察、日记或语音后，这里会自动显示最近留下的内容。</p>
        </div>
      )}
    </Cd>
  );
}

/* ── Outdoor Goal Card ── */

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
        <div className="rounded-[16px] p-5" style={softPanelStyle}>
          <p className="text-[13px] font-semibold" style={{ color: textMain }}>还没有设定户外目标</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: textMuted }}>
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
            {summary.totalMinutes} <span className="text-[12px] font-normal" style={{ color: textMuted }}>/ {effectiveGoal} 分钟</span>
          </p>
          <span className="text-[12px] font-medium tabular-nums" style={{ color: barColor }}>{progressPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.5)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${progressPercent}%`, background: barColor }} />
        </div>
        <p className="text-[12px]" style={{ color: textMuted }}>{message.primary}</p>
        {message.secondary && <p className="text-[11px]" style={{ color: textMuted }}>{message.secondary}</p>}
      </div>
    </Cd>
  );
}
