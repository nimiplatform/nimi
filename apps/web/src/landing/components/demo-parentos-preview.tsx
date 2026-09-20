import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Baby,
  BellRing,
  BookText,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Home,
  Info,
  Languages,
  MessageCircle,
  Mic,
  Moon,
  Pencil,
  Plus,
  Ruler,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Square,
  Star,
  Syringe,
  TrendingUp,
  User,
  type LucideProps,
} from 'lucide-react';
import { AmbientBackground, Surface, cn } from '@nimiplatform/kit/ui';
import type { HeroDemoParentosPreview } from '../content/landing-content.js';

/**
 * Interactive replica of the ParentOS (成长底稿) shell
 * (nimiapp-parentos src/shell/renderer): the 62px icon sidebar with the child
 * menu, and the six routed pages composed the way the app composes them —
 * Tailwind utilities on kit `Surface`/`AmbientBackground`, with the app's
 * named rules ported in demo-parentos.css. Records are mock data from the
 * landing content; nothing is persisted.
 */

type ParentosRoute = 'timeline' | 'profile' | 'journal' | 'advisor' | 'reports' | 'settings';

const textMain = '#1e293b';
const textMuted = '#475569';
const textSoft = '#94a3b8';
const STREAM_TICK_MS = 28;
const STREAM_LEAD_MS = 700;
const NOTICE_MS = 5_000;

type IconComponent = (props: LucideProps) => ReactNode;

const NAV_ITEMS: ReadonlyArray<{ id: ParentosRoute; Icon: IconComponent }> = [
  { id: 'timeline', Icon: Home },
  { id: 'profile', Icon: User },
  { id: 'journal', Icon: BookText },
  { id: 'advisor', Icon: MessageCircle },
  { id: 'reports', Icon: TrendingUp },
  { id: 'settings', Icon: Settings },
];

const QUICK_LINK_ICONS: Record<string, { Icon: IconComponent; bg: string; fg: string }> = {
  growth: { Icon: Ruler, bg: 'rgba(78,204,163,0.14)', fg: '#059669' },
  vaccines: { Icon: Syringe, bg: 'rgba(251,191,36,0.14)', fg: '#d97706' },
  sleep: { Icon: Moon, bg: 'rgba(129,140,248,0.14)', fg: '#6366f1' },
  journal: { Icon: BookText, bg: 'rgba(167,139,250,0.12)', fg: '#7c3aed' },
  vision: { Icon: Eye, bg: 'rgba(96,165,250,0.14)', fg: '#2563eb' },
  dental: { Icon: Sparkles, bg: 'rgba(244,114,182,0.14)', fg: '#db2777' },
};

/* ── primitives (timeline-card-primitives.tsx) ────────────────────────── */

function Cd({ children, cls = '', style, material = 'glass-regular' }: {
  children: ReactNode;
  cls?: string;
  style?: CSSProperties;
  material?: 'glass-regular' | 'glass-thick';
}) {
  return (
    <Surface
      as="div"
      material={material}
      padding="none"
      tone="card"
      className={`max-md:col-span-8 p-5 transition-transform hover:-translate-y-0.5 sm:p-7 ${cls}`}
      style={style}
    >
      {children}
    </Surface>
  );
}

function Hdr({ title, link, onClick }: { title: string; link?: string; onClick?: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h3 className="text-[16px] font-semibold" style={{ color: textMain }}>{title}</h3>
      {link ? (
        <button type="button" onClick={onClick} className="text-[13px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }}>{link}</button>
      ) : null}
    </div>
  );
}

function ChildAvatar({ src, name, className }: { src: string; name: string; className?: string }) {
  return <img src={src} alt={name} className={className} draggable={false} />;
}

/* ── 首页 ─────────────────────────────────────────────────────────────── */

function ChildContextCard({ content, onOpenProfile }: { content: HeroDemoParentosPreview; onOpenProfile: () => void }) {
  const mesh = [
    'radial-gradient(at 22% 18%, rgba(255, 207, 226, 0.38) 0px, transparent 55%)',
    'radial-gradient(at 82% 22%, rgba(221, 214, 254, 0.32) 0px, transparent 55%)',
    'radial-gradient(at 30% 88%, rgba(255, 228, 240, 0.28) 0px, transparent 55%)',
    'radial-gradient(at 80% 85%, rgba(233, 213, 255, 0.22) 0px, transparent 55%)',
  ].join(', ');
  return (
    <div
      className="relative z-10 shrink-0"
      style={{ width: 'min(240px, 100%)', borderRadius: 24, background: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.04), 0 18px 36px rgba(15,23,42,0.04)' }}
    >
      <div className="relative flex h-full flex-col items-center overflow-hidden px-6 pb-6 pt-12" style={{ borderRadius: 24, isolation: 'isolate' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: mesh, filter: 'blur(24px)', zIndex: 0 }} />
        <div
          className="relative nimi-material-glass-regular border border-[var(--nimi-material-glass-regular-border)] bg-[var(--nimi-material-glass-regular-bg)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
          style={{ width: 120, height: 120, padding: 4, borderRadius: '50%', boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}
        >
          <ChildAvatar src={content.child.avatarSrc} name={content.child.name} className="h-full w-full rounded-full object-cover" />
        </div>
        <div className="relative mt-6 max-w-full text-center">
          <h2 className="truncate text-[24px] font-semibold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.3px' }}>{content.child.name}</h2>
          <p className="mt-1.5 text-[14px]" style={{ color: '#86868b' }}>{content.child.ageLabel} · {content.child.genderLabel}</p>
        </div>
        <div className="relative mt-auto flex w-full flex-col items-center gap-3 pt-6">
          <span className="inline-flex items-center rounded-full px-3 py-[5px] text-[13px] font-medium" style={{ background: 'rgba(52,199,89,0.12)', color: '#248a3d' }}>
            <span className="mr-1.5 inline-block h-[6px] w-[6px] rounded-full" style={{ background: '#34c759' }} />
            {content.child.nurtureMode}
          </span>
          <button type="button" onClick={onOpenProfile} className="flex w-full items-center justify-center whitespace-nowrap rounded-xl px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-black/[0.04]" style={{ color: '#1d1d1f' }}>
            {content.home.viewFullProfile}
            <ChevronRight size={14} className="ml-1 opacity-60" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StageInsightGroup({ title, items, overflow, overflowFormat }: { title: string; items: ReadonlyArray<{ id: string; title: string; description: string }>; overflow: number; overflowFormat: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="dashboard-inset rounded-[18px] p-5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: textSoft }}>{title}</p>
      <div className="mt-3 space-y-1">
        {items.map((item) => {
          const open = expanded === item.id;
          return (
            <div key={item.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : item.id)}
                className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[rgba(15,23,42,0.04)]"
              >
                <span className="text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</span>
                <ChevronDown size={15} strokeWidth={2} aria-hidden="true" className={`shrink-0 transition-transform duration-200${open ? ' rotate-180' : ''}`} style={{ color: textMuted }} />
              </button>
              {open ? <p className="px-2 pb-2 pt-0.5 text-[13px] leading-relaxed" style={{ color: textMuted }}>{item.description}</p> : null}
            </div>
          );
        })}
      </div>
      {overflow > 0 ? (
        <span className="mt-4 inline-block text-[13px] font-medium" style={{ color: textMuted }}>{overflowFormat.replace('{{count}}', String(overflow))}</span>
      ) : null}
    </div>
  );
}

function MiniTrend({ points, stroke, fill }: { points: ReadonlyArray<number>; stroke: string; fill: string }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((value, index) => ({
    x: 4 + (index * 292) / Math.max(points.length - 1, 1),
    y: 52 - ((value - min) / range) * 44,
  }));
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]?.x ?? 0},60 L${coords[0]?.x ?? 0},60 Z`;
  const id = `demo-parentos-grad-${stroke.replace('#', '')}`;
  return (
    <svg viewBox="0 0 300 60" className="mt-3 h-[60px] w-full" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={fill} stopOpacity={0.4} />
          <stop offset="95%" stopColor={fill} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

function TimelinePage({ content, navigate, notice }: { content: HeroDemoParentosPreview; navigate: (route: ParentosRoute) => void; notice: (text: string) => void }) {
  const home = content.home;
  const outdoorPercent = Math.min(100, Math.round((home.outdoor.minutes / home.outdoor.goal) * 100));
  const outdoorColor = outdoorPercent >= 100 ? '#4ECCA3' : '#818CF8';
  return (
    <div className="relative flex h-full min-w-0" style={{ background: 'transparent' }}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        style={{
          backgroundImage: [
            'radial-gradient(at 18% 12%, rgba(186,230,253,0.35) 0px, transparent 52%)',
            'radial-gradient(at 82% 18%, rgba(255,207,226,0.28) 0px, transparent 52%)',
            'radial-gradient(at 48% 96%, rgba(221,214,254,0.26) 0px, transparent 55%)',
          ].join(', '),
          filter: 'blur(28px)',
        }}
      />
      <div className="hide-scrollbar relative z-[1] min-w-0 flex-1 overflow-y-auto px-3 pb-8 sm:px-6" style={{ paddingTop: 28 }}>
        <div className="mb-4 flex min-w-0 flex-col gap-4 lg:mb-6 lg:flex-row lg:gap-6">
          <ChildContextCard content={content} onOpenProfile={() => navigate('profile')} />
          <Cd cls="min-w-0 flex-1" material="glass-thick">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium tracking-[0.08em]" style={{ color: textSoft }}>{home.stageFocusTitle}</p>
                <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{content.child.ageLabel}</h2>
              </div>
              <button type="button" className="text-[13px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }} onClick={() => notice(content.notices.hostOnly)}>{home.viewAllReminders}</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <StageInsightGroup title={home.healthGroup} items={home.health} overflow={home.healthOverflow} overflowFormat={home.overflowFormat} />
              <StageInsightGroup title={home.devGroup} items={home.development} overflow={0} overflowFormat={home.overflowFormat} />
            </div>
          </Cd>
        </div>
        <div className="grid auto-rows-min grid-cols-8 gap-4 md:gap-6">
          <Cd cls="col-span-8">
            <Hdr title={home.quickLinksTitle} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
              {home.quickLinks.map((item) => {
                const meta = QUICK_LINK_ICONS[item.id] ?? QUICK_LINK_ICONS.growth!;
                const Icon = meta.Icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id === 'journal' ? 'journal' : 'profile')}
                    className="dashboard-quick-link group flex flex-col items-center rounded-[20px] px-3 py-5 transition-all duration-200 hover:-translate-y-1"
                  >
                    <div className="mb-3 flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl transition-transform duration-200 group-hover:scale-110" style={{ background: meta.bg, color: meta.fg, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }} aria-hidden="true">
                      <Icon size={22} strokeWidth={1.75} />
                    </div>
                    <p className="text-[13px] font-semibold" style={{ color: textMain }}>{item.label}</p>
                  </button>
                );
              })}
            </div>
          </Cd>

          <div className="col-span-8 flex min-w-0 flex-col gap-4 lg:flex-row lg:gap-6">
            <div className="min-w-0 flex-1 [&>div]:h-full">
              <Cd cls="col-span-4 flex flex-col">
                <Hdr title={home.growthSnapshotTitle} link={home.viewCurves} onClick={() => navigate('profile')} />
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-[14px] font-semibold" style={{ color: textMain }}>{home.latestMeasurement}</p>
                  <span className="text-[12px]" style={{ color: '#64748b' }}>{home.updatedLabel}</span>
                </div>
                <div className="flex flex-1 flex-col gap-3">
                  {home.trends.map((trend) => {
                    const colors = trend.id === 'height' ? { stroke: '#818CF8', fill: '#C4B5FD' } : { stroke: '#4ECCA3', fill: '#A7F3D0' };
                    return (
                      <div key={trend.id} className="dashboard-inset flex flex-1 flex-col justify-center rounded-[16px] p-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[13px] font-medium" style={{ color: textMuted }}>{trend.label}</p>
                            <p className="mt-1 text-[12px] font-semibold" style={{ color: '#22c55e' }}>
                              ↑ {trend.delta} {trend.unit}
                              <span className="ml-1 font-normal" style={{ color: '#64748b' }}>({trend.deltaPercent})</span>
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain }}>{trend.latestValue}</span>
                            <span className="ml-1 text-[12px]" style={{ color: '#64748b' }}>{trend.unit}</span>
                          </div>
                        </div>
                        <MiniTrend points={trend.points} stroke={colors.stroke} fill={colors.fill} />
                      </div>
                    );
                  })}
                </div>
              </Cd>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4 lg:gap-6">
              <div className="flex-1 [&>div]:h-full">
                <Cd cls="col-span-4">
                  <Hdr title={home.sleepTitle} link={home.viewDetails} onClick={() => navigate('profile')} />
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{home.sleep.average}</p>
                      <p className="mt-2 text-[13px]" style={{ color: textMuted }}>{home.sleep.averageLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px]" style={{ color: textMuted }}>{home.sleep.bedtimeLabel} <span className="font-semibold" style={{ color: textMain }}>{home.sleep.bedtime}</span></p>
                      <p className="mt-0.5 text-[13px]" style={{ color: textMuted }}>{home.sleep.wakeLabel} <span className="font-semibold" style={{ color: textMain }}>{home.sleep.wake}</span></p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-end gap-2">
                    {home.sleep.points.map((point) => {
                      const max = Math.max(...home.sleep.points.map((entry) => entry.minutes));
                      const min = Math.min(...home.sleep.points.map((entry) => entry.minutes));
                      const height = Math.max(((point.minutes - min) / (max - min || 1)) * 56 + 16, 16);
                      return (
                        <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${point.date}: ${Math.floor(point.minutes / 60)}h${point.minutes % 60}m`}>
                          <div className="w-full rounded-lg" style={{ height, background: '#818CF8' }} />
                          <span className="whitespace-nowrap text-[10px] font-medium" style={{ color: '#64748b' }}>{point.date.replace('-', '/')}</span>
                        </div>
                      );
                    })}
                  </div>
                </Cd>
              </div>
              <div className="flex-1 [&>div]:h-full">
                <Cd cls="col-span-4">
                  <Hdr title={home.visionTitle} link={home.viewDetails} onClick={() => navigate('profile')} />
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-5">
                      {[{ label: home.vision.leftLabel, value: home.vision.left }, { label: home.vision.rightLabel, value: home.vision.right }].map((eye) => (
                        <div key={eye.label} className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(96,165,250,0.12)', color: '#60A5FA' }}>
                            <Eye size={18} strokeWidth={1.8} aria-hidden="true" />
                          </div>
                          <div>
                            <p className="text-[12px]" style={{ color: textMuted }}>{eye.label}</p>
                            <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{eye.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <span className="text-[12px]" style={{ color: '#64748b' }}>{home.vision.measured}</span>
                  </div>
                </Cd>
              </div>
            </div>
          </div>

          <Cd cls="col-span-4">
            <Hdr title={home.outdoorTitle} />
            <div className="space-y-3">
              <div className="flex items-end justify-between">
                <p className="text-[18px] font-bold tabular-nums" style={{ color: textMain }}>
                  {home.outdoor.minutes} <span className="text-[14px] font-normal" style={{ color: textMuted }}>/ {home.outdoor.goal} {home.outdoor.unit}</span>
                </p>
                <span className="text-[14px] font-medium tabular-nums" style={{ color: outdoorColor }}>{outdoorPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.5)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${outdoorPercent}%`, background: outdoorColor }} />
              </div>
              <p className="text-[14px]" style={{ color: textMuted }}>{home.outdoor.primary}</p>
              <p className="text-[13px]" style={{ color: textMuted }}>{home.outdoor.secondary}</p>
            </div>
          </Cd>

          <Cd cls="col-span-4">
            <Hdr title={home.stageFocusTitle} link={home.viewAllReminders} onClick={() => notice(content.notices.hostOnly)} />
            <div className="space-y-4">
              {home.periods.map((period) => (
                <div key={period.title} className="dashboard-inset rounded-[16px] p-5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-600">{home.sensitiveBadge}</span>
                    <p className="text-[14px] font-semibold" style={{ color: textMain }}>{period.title}</p>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed" style={{ color: textMuted }}>{period.sign}</p>
                  <button type="button" onClick={() => navigate('journal')} className="mt-3 inline-flex rounded-full px-4 py-1.5 text-[13px] font-medium text-white hover:-translate-y-0.5" style={{ background: textMain, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>{home.recordAction}</button>
                </div>
              ))}
            </div>
          </Cd>

          <Cd cls="col-span-4">
            <Hdr title={home.milestoneTitle} link={home.viewAll} onClick={() => navigate('profile')} />
            <div className="mb-4">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#4ECCA3' }}>{home.recentlyAchieved}</p>
              <div className="space-y-2">
                {home.milestones.achieved.map((item) => (
                  <div key={item.title} className="dashboard-inset flex items-center gap-3 rounded-[14px] px-4 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ background: 'rgba(78,204,163,0.15)', color: '#4ECCA3' }}>✓</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                      <p className="text-[12px]" style={{ color: textMuted }}>{item.meta}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: '#818CF8' }}>{home.upcoming}</p>
              <div className="space-y-2">
                {home.milestones.upcoming.map((item) => (
                  <div key={item.title} className="dashboard-inset flex items-center gap-3 rounded-[14px] px-4 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px]" style={{ background: 'rgba(129,140,248,0.15)', color: '#818CF8' }}>●</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</p>
                      <p className="text-[12px]" style={{ color: textMuted }}>{item.meta}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Cd>

          <Cd cls="col-span-8">
            <Hdr title={home.recentLinesTitle} link={home.viewAllRecords} onClick={() => navigate('journal')} />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {home.lines.map((line) => (
                <button key={line.title} type="button" onClick={() => navigate('journal')} className="dashboard-inset dashboard-inset--interactive rounded-[16px] p-5 text-left transition-all duration-200 hover:-translate-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full px-2 py-0.5 text-[12px] font-medium" style={line.keepsake ? { background: 'rgba(245, 158, 11, 0.12)', color: '#b45309' } : { background: 'rgba(255,255,255,0.6)', color: textMuted }}>{line.badge}</span>
                    <span className="text-[12px]" style={{ color: '#64748b' }}>{line.when}</span>
                  </div>
                  <p className="mt-3 line-clamp-3 text-[14px] font-medium leading-relaxed" style={{ color: textMain }}>{line.title}</p>
                  <p className="mt-2 text-[12px]" style={{ color: textMuted }}>{line.detail}</p>
                  {line.tag ? <p className="mt-2 text-[12px] font-medium" style={{ color: '#b45309' }}>{line.tag}</p> : null}
                </button>
              ))}
            </div>
          </Cd>

          <Cd cls="col-span-4">
            <Hdr title={home.observationTitle} link={home.viewRecords} onClick={() => navigate('journal')} />
            <p className="mb-5 text-[13px]" style={{ color: textMuted }}>{home.last30.replace('{{count}}', String(home.observations.reduce((sum, item) => sum + item.count, 0)))}</p>
            <div className="space-y-3.5">
              {home.observations.map((item) => (
                <div key={item.name}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[13px] font-semibold" style={{ color: textMain }}>{item.name}</span>
                    <span className="text-[12px]" style={{ color: '#64748b' }}>{item.count} 条 · {Math.round(item.ratio * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(item.ratio * 100, 4)}%`, background: '#818CF8' }} />
                  </div>
                </div>
              ))}
            </div>
          </Cd>

          <Cd cls="col-span-4">
            <Hdr title={home.monthlyReportTitle} link={home.viewFullReport} onClick={() => navigate('reports')} />
            <p className="text-[14px] leading-[1.8]" style={{ color: textMain }}>{home.teaser}</p>
            <div className="dashboard-inset mt-4 rounded-[14px] p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: textMuted }}>{home.todoTitle}</p>
              <p className="mt-1.5 text-[14px] font-medium" style={{ color: textMain }}>{home.actionText}</p>
            </div>
          </Cd>
        </div>
      </div>

      <div className="relative z-[1] hidden xl:block">
        <ReminderPanel content={content} navigate={navigate} />
      </div>
    </div>
  );
}

/* ── right rail (timeline-page-panels.tsx) ────────────────────────────── */

const ACTION_PILL_CLASS = 'inline-flex h-7 min-h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-full border-0 px-3 no-underline [appearance:none] transition-colors';
const ACTION_LABEL_CLASS = 'block text-[13px] leading-none font-medium tracking-[0.01em]';

function ReminderRow({ item, tone, onPrimary, scheduleLabel, completeLabel, onComplete }: {
  item: { id: string; title: string; status: string; primary: string };
  tone: { border: string; text: string };
  onPrimary: () => void;
  scheduleLabel: string;
  completeLabel: string;
  onComplete: () => void;
}) {
  return (
    <div className="group flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors hover:bg-white">
      <button
        type="button"
        title={completeLabel}
        onClick={onComplete}
        className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all hover:bg-white"
        style={{ borderColor: tone.border }}
      >
        <Check size={9} strokeWidth={3} className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: tone.border }} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-snug" style={{ color: '#1e293b' }}>{item.title}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: tone.text }}>{item.status}</p>
        <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onPrimary} className={ACTION_PILL_CLASS} style={{ background: '#1e293b', color: '#fff' }}>
            <span className={ACTION_LABEL_CLASS}>{item.primary}</span>
          </button>
          <button type="button" className={ACTION_PILL_CLASS} style={{ background: '#f1f5f9', color: '#475569' }}>
            <span className={ACTION_LABEL_CLASS}>{scheduleLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ReminderPanel({ content, navigate }: { content: HeroDemoParentosPreview; navigate: (route: ParentosRoute) => void }) {
  const panel = content.panel;
  const [tab, setTab] = useState<'today' | 'upcoming'>('today');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [overdueOpen, setOverdueOpen] = useState(true);
  const [todos, setTodos] = useState(panel.todos);
  const [composerOpen, setComposerOpen] = useState(false);
  const [todoDraft, setTodoDraft] = useState('');
  const items = (tab === 'today' ? panel.reminders : panel.upcoming).filter((item) => !done[item.id]);
  const primaryRoute = (kind: string): ParentosRoute => (kind === 'consult' ? 'advisor' : kind === 'task' ? 'profile' : 'journal');
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l px-3 pb-6 pt-7" style={{ borderColor: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.32)' }} aria-label={panel.title}>
      <p className="mb-4 px-3 text-[18px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>{panel.title}</p>
      <div className="mx-2 mb-3 flex gap-1 rounded-full bg-white/60 p-1">
        {(['today', 'upcoming'] as const).map((key) => {
          const count = (key === 'today' ? panel.reminders : panel.upcoming).filter((item) => !done[item.id]).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[13px] font-medium transition-colors', tab === key ? 'bg-[#1e293b] text-white' : 'text-[#475569] hover:bg-white')}
            >
              {key === 'today' ? panel.todayTab : panel.upcomingTab}
              <span className={cn('rounded-full px-1.5 text-[11px]', tab === key ? 'bg-white/20' : 'bg-slate-200/80')}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="mx-1">
        {items.map((item) => (
          <ReminderRow
            key={item.id}
            item={item}
            tone={{ border: '#1e293b', text: '#475569' }}
            scheduleLabel={panel.schedule}
            completeLabel={panel.markComplete}
            onComplete={() => setDone((current) => ({ ...current, [item.id]: true }))}
            onPrimary={() => navigate(primaryRoute(item.kind))}
          />
        ))}
      </div>

      <div className="mx-2 mt-4">
        <button type="button" onClick={() => setOverdueOpen((value) => !value)} className="flex w-full items-center gap-1.5 text-left">
          <ChevronRight size={10} strokeWidth={2.5} style={{ color: '#d97706' }} className={`transition-transform ${overdueOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
          <span className="text-[12px] font-semibold" style={{ color: '#d97706' }}>{panel.overdueSummary}</span>
          <span className="rounded-full px-1.5 py-[1px] text-[12px] font-medium" style={{ background: '#fef3c7', color: '#b45309' }}>{panel.overdue.filter((item) => !done[item.id]).length}</span>
        </button>
        {overdueOpen ? panel.overdue.filter((item) => !done[item.id]).map((item) => (
          <ReminderRow
            key={item.id}
            item={item}
            tone={{ border: '#f59e0b', text: '#f59e0b' }}
            scheduleLabel={panel.schedule}
            completeLabel={panel.markComplete}
            onComplete={() => setDone((current) => ({ ...current, [item.id]: true }))}
            onPrimary={() => navigate('profile')}
          />
        )) : null}
      </div>

      <div className="mx-2 mt-6 space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white">
            <button type="button" onClick={() => setTodos((current) => current.filter((entry) => entry.id !== todo.id))} className="mt-[2px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px] hover:bg-white" style={{ borderColor: '#94a3b8' }} title={panel.markComplete}>
              <Check size={8} strokeWidth={3} className="opacity-0 group-hover:opacity-100" style={{ color: '#94a3b8' }} aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-snug" style={{ color: '#1e293b' }}>{todo.title}</p>
              <p className="text-[11.5px]" style={{ color: '#94a3b8' }}>{todo.due}</p>
            </div>
          </div>
        ))}
        {composerOpen ? (
          <form
            className="mt-2 rounded-[12px] bg-white/80 p-2"
            style={{ animation: 'customTodoSlideDown 160ms ease both' }}
            onSubmit={(event) => {
              event.preventDefault();
              const title = todoDraft.trim();
              if (!title) return;
              setTodos((current) => [...current, { id: `todo-${Date.now()}`, title, due: '今天' }]);
              setTodoDraft('');
              setComposerOpen(false);
            }}
          >
            <textarea value={todoDraft} onChange={(event) => setTodoDraft(event.target.value)} placeholder={panel.customTodoTitlePlaceholder} rows={2} className="w-full resize-none rounded-[8px] border-0 bg-transparent px-2 py-1 text-[13px] outline-none" />
            <div className="flex justify-end gap-2 px-1">
              <button type="submit" className="rounded-full px-3 py-1 text-[12px] font-medium text-white" style={{ background: '#1e293b' }}>{panel.add}</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setComposerOpen(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] transition-colors hover:bg-white" style={{ color: '#94a3b8' }}>
            <Plus size={14} aria-hidden="true" />
            {panel.customTodoPlaceholder}
          </button>
        )}
      </div>

      <div className="mt-8 pt-2">
        <p className="mb-5 px-3 text-[18px] font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>{panel.observationNudges}</p>
        {panel.nudges.map((nudge) => (
          <div key={nudge.text} className="group flex items-start gap-2.5 rounded-[12px] px-3 py-3 transition-colors hover:bg-white">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium leading-snug" style={{ color: '#1e293b' }}>{nudge.text}</p>
              <p className="mt-0.5 text-[12px]" style={{ color: '#475569' }}>{nudge.question}</p>
            </div>
            <button type="button" onClick={() => navigate('journal')} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium text-white opacity-0 transition-all group-hover:opacity-100 hover:-translate-y-0.5" style={{ background: '#1e293b', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>{panel.observe}</button>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ── 顾问 ─────────────────────────────────────────────────────────────── */

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
      : <span key={`${part}-${index}`}>{part}</span>
  ));
}

function AdvisorContent({ content }: { content: string }) {
  const blocks = content.replace(/\r/g, '').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const isBullet = (line: string) => /^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
  return (
    <div className="advisor-message-content">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length > 0 && lines.every(isBullet)) {
          return (
            <ul key={blockIndex} className="my-2 list-disc space-y-1.5 pl-5">
              {lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^\s*[-*]\s+/, '').replace(/^\s*\d+[.)]\s+/, ''))}</li>)}
            </ul>
          );
        }
        return (
          <p key={blockIndex} className="my-2 whitespace-pre-wrap">
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>{lineIndex > 0 ? <br /> : null}{renderInline(line)}</span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type AdvisorMessage = { id: string; role: 'user' | 'assistant'; content: string };
type AdvisorConversation = { id: string; title: string; when: string; messages: AdvisorMessage[] };

function AdvisorPage({ content, notice }: { content: HeroDemoParentosPreview; notice: (text: string) => void }) {
  const advisor = content.advisor;
  const [conversations, setConversations] = useState<AdvisorConversation[]>(() => advisor.conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message, index) => ({ id: `${conversation.id}-${index}`, ...message })),
  })));
  const [activeId, setActiveId] = useState<string | null>(advisor.conversations[0]?.id ?? null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<{ conversationId: string; text: string } | null>(null);
  const replyCursor = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const clearTimer = useCallback(() => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null; }, []);
  useEffect(() => () => clearTimer(), [clearTimer]);

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const isStreaming = streaming !== null && streaming.conversationId === activeId;

  useEffect(() => {
    const root = transcriptRef.current;
    if (root) root.scrollTop = root.scrollHeight;
  }, [active?.messages.length, streaming?.text]);

  const appendMessage = (conversationId: string, message: AdvisorMessage) => {
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId ? { ...conversation, messages: [...conversation.messages, message] } : conversation
    )));
  };

  const finish = (conversationId: string, text: string) => {
    clearTimer();
    setStreaming(null);
    if (text.trim()) appendMessage(conversationId, { id: `a-${Date.now()}`, role: 'assistant', content: text });
  };

  const send = (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body || streaming) return;
    let conversationId = activeId;
    if (!conversationId) {
      conversationId = `c-${Date.now()}`;
      setConversations((current) => [{ id: conversationId!, title: body.slice(0, 24), when: '刚刚', messages: [] }, ...current]);
      setActiveId(conversationId);
    }
    const id = conversationId;
    appendMessage(id, { id: `u-${Date.now()}`, role: 'user', content: body });
    setDraft('');
    const reply = advisor.replies[replyCursor.current % advisor.replies.length] ?? '';
    replyCursor.current += 1;
    setStreaming({ conversationId: id, text: '' });
    let offset = 0;
    const tick = () => {
      offset += 3;
      if (offset >= reply.length) { finish(id, reply); return; }
      setStreaming({ conversationId: id, text: reply.slice(0, offset) });
      timerRef.current = setTimeout(tick, STREAM_TICK_MS);
    };
    timerRef.current = setTimeout(tick, STREAM_LEAD_MS);
  };

  return (
    <div className="advisor-page-shell flex h-full min-w-0 gap-4 p-4">
      <aside className="advisor-sidebar-panel flex w-64 shrink-0 flex-col self-stretch p-3">
        <button
          type="button"
          onClick={() => { setActiveId(null); setDraft(''); }}
          className="mb-3 flex min-h-10 w-full items-center justify-center gap-2 parentos-radius-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_86%,var(--nimi-surface-panel))] px-3 text-[14px] font-semibold text-[var(--nimi-text-primary)] transition-all hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))] hover:shadow-[var(--nimi-elevation-base)]"
        >
          <Plus size={15} aria-hidden="true" />
          {advisor.newConversation}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setActiveId(conversation.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 parentos-radius-lg px-3 py-3 text-left transition-all hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,transparent)]',
                    isActive && 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_9%,var(--nimi-surface-card))] shadow-[var(--nimi-elevation-base)]',
                  )}
                >
                  <p className={cn('w-full truncate text-[14px] text-[var(--nimi-text-secondary)]', isActive && 'font-semibold text-[var(--nimi-text-primary)]')}>{conversation.title}</p>
                  <span className="text-[11px] text-[var(--nimi-text-muted)]">{conversation.when}</span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
      <div className="advisor-main-panel flex min-w-0 flex-1 flex-col overflow-hidden">
        {active ? (
          <div ref={transcriptRef} className="advisor-transcript min-h-0 flex-1 overflow-y-auto px-6 pt-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-4">
              {active.messages.map((message) => (
                <div key={message.id} className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <article className={cn('advisor-message-card', message.role === 'user' ? 'advisor-message-card--user' : 'advisor-message-card--assistant')}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[12px] font-semibold text-[var(--nimi-text-muted)]">{message.role === 'user' ? advisor.user : advisor.assistant}</span>
                    </div>
                    <AdvisorContent content={message.content} />
                  </article>
                </div>
              ))}
              {isStreaming && streaming ? (
                <div className="flex w-full justify-start">
                  <article className="advisor-message-card advisor-message-card--assistant">
                    <div className="mb-2 text-[12px] font-semibold text-[var(--nimi-text-muted)]">{advisor.assistant}</div>
                    {streaming.text ? <AdvisorContent content={streaming.text} /> : (
                      <div className="flex items-center gap-2 text-[13px] text-[var(--nimi-text-muted)]">
                        <span className="advisor-thinking-dot" aria-hidden="true" />
                        {advisor.thinking}
                      </div>
                    )}
                    <button type="button" onClick={() => finish(streaming.conversationId, streaming.text)} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-white/70 px-3 py-1 text-[12px] font-medium text-[var(--nimi-text-secondary)]">
                      <Square size={11} aria-hidden="true" />
                      {advisor.stop}
                    </button>
                  </article>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{advisor.emptyEyebrow}</p>
            <h2 className="mt-2 text-[22px] font-semibold text-[var(--nimi-text-primary)]">{advisor.emptyTitle}</h2>
            <p className="mt-2 text-[14px] text-[var(--nimi-text-secondary)]">{advisor.emptyDescription}</p>
          </div>
        )}
        <div className="shrink-0 px-5 pb-2 pt-2">
          <div className="mx-auto max-w-2xl">
            <div className="flex flex-wrap gap-1.5">
              {advisor.suggestions.map((suggestion) => (
                <button key={suggestion} type="button" disabled={Boolean(streaming)} onClick={() => send(suggestion)} className="rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-[14px] text-slate-600 transition-all hover:border-emerald-300 hover:bg-emerald-50/70 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="advisor-composer-shell shrink-0 px-6 pb-5 pt-3">
          <div className="mx-auto max-w-3xl">
            <div className="mb-2">
              <button type="button" onClick={() => notice(content.notices.hostOnly)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-white/70 px-3 py-1 text-[12px] font-medium text-[var(--nimi-text-secondary)]">
                <Plus size={14} aria-hidden="true" />
                {advisor.recordData}
              </button>
            </div>
            <div className="advisor-composer-box">
              <div className="flex items-end gap-2 p-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder={advisor.placeholder}
                  disabled={Boolean(streaming)}
                  rows={1}
                  className="advisor-composer-textarea min-h-[48px] max-h-32 min-w-0 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-3 py-3 text-[14px] leading-[1.6] text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                />
                {streaming ? (
                  <button type="button" onClick={() => finish(streaming.conversationId, streaming.text)} aria-label={advisor.stop} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-text-primary)] text-white">
                    <Square size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" onClick={() => send()} disabled={!draft.trim()} aria-label={advisor.send} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-white transition-opacity disabled:opacity-40">
                    <Send size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 成长随记 ─────────────────────────────────────────────────────────── */

function JournalPage({ content, notice }: { content: HeroDemoParentosPreview; notice: (text: string) => void }) {
  const journal = content.journal;
  const [entries, setEntries] = useState(journal.entries);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [text, setText] = useState('');
  const [keepsake, setKeepsake] = useState(false);
  const [filter, setFilter] = useState<'all' | 'keepsake'>('all');
  const counts = {
    thisMonth: journal.counts.thisMonth + (entries.length - journal.entries.length),
    total: journal.counts.total + (entries.length - journal.entries.length),
    keepsake: journal.counts.keepsake + entries.filter((entry) => entry.keepsake).length - journal.entries.filter((entry) => entry.keepsake).length,
  };
  const visible = filter === 'all' ? entries : entries.filter((entry) => entry.keepsake);
  const grouped = visible.reduce<Array<{ label: string; items: typeof visible }>>((groups, entry) => {
    const group = groups.find((candidate) => candidate.label === entry.dateLabel);
    if (group) group.items = [...group.items, entry];
    else groups.push({ label: entry.dateLabel, items: [entry] });
    return groups;
  }, []);

  const save = () => {
    const body = text.trim();
    if (!body) return;
    const now = new Date();
    setEntries((current) => [{
      id: `j-${Date.now()}`,
      dateLabel: '今天',
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      text: body,
      dimension: null,
      keepsake,
      recorder: '你',
    }, ...current]);
    setText('');
    setKeepsake(false);
  };

  return (
    <div className="hide-scrollbar h-full overflow-y-auto px-6 pb-10 pt-8 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 flex-1">
            <h1 className="parentos-journal-hero-title parentos-journal-hero-title__bold text-[44px] leading-[1.05] tracking-tight text-[var(--nimi-text-primary)]">
              {journal.heroLead}
              <span className="parentos-journal-hero-title__tail">
                {journal.heroTail}
                <span className="parentos-journal-hero-title__dot" aria-hidden="true" />
              </span>
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed">
              <span className="font-semibold text-[var(--nimi-text-primary)]">{journal.subtitleLead}</span>
              <span className="text-[var(--nimi-text-muted)]">{journal.subtitleTail}</span>
            </p>
          </div>
          <dl className="flex shrink-0 items-end gap-7">
            {[[journal.stats.thisMonth, counts.thisMonth], [journal.stats.total, counts.total], [journal.stats.keepsake, counts.keepsake]].map(([label, value]) => (
              <div key={String(label)} className="text-right">
                <dd className="text-[28px] font-semibold leading-none tracking-tight text-[var(--nimi-text-primary)]">{value}</dd>
                <dt className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">{label}</dt>
              </div>
            ))}
          </dl>
        </header>

        <div className="relative mb-8">
          <div aria-hidden="true" className="journal-capture-glow pointer-events-none absolute inset-0 rounded-[24px]" />
          <Surface as="section" material="glass-thick" tone="card" padding="none" className="journal-capture-surface relative rounded-[24px] p-5 sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              {(['text', 'voice'] as const).map((key) => (
                <button key={key} type="button" onClick={() => setMode(key)} className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', mode === key ? 'bg-[var(--nimi-text-primary)] text-white' : 'bg-white/70 text-[var(--nimi-text-secondary)] hover:bg-white')}>
                  {key === 'text' ? <Pencil size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
                  {key === 'text' ? journal.captureText : journal.captureVoice}
                </button>
              ))}
            </div>
            {mode === 'text' ? (
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder={journal.placeholder} className="w-full resize-none rounded-[16px] border border-[var(--nimi-border-subtle)] bg-white/70 px-4 py-3 text-[15px] leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)]" />
            ) : (
              <button type="button" onClick={() => notice(content.notices.hostOnly)} className="flex w-full flex-col items-center justify-center gap-3 rounded-[16px] border border-dashed border-[var(--nimi-border-subtle)] bg-white/50 py-8 text-[13px] text-[var(--nimi-text-muted)]">
                <span className="flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ background: 'linear-gradient(135deg, #45B8D6 0%, #5fbf9a 100%)', boxShadow: '0 10px 30px rgba(69,184,214,0.34)' }}><Mic size={22} aria-hidden="true" /></span>
                点击开始录音，说完自动转写
              </button>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setKeepsake((value) => !value)} aria-pressed={keepsake} className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors', keepsake ? 'bg-amber-100 text-amber-700' : 'bg-white/70 text-[var(--nimi-text-secondary)] hover:bg-white')}>
                <Star size={13} aria-hidden="true" />
                {journal.keepsakeToggle}
              </button>
              <button type="button" onClick={save} disabled={mode !== 'text' || !text.trim()} className="rounded-full px-5 py-2 text-[14px] font-medium text-white transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40" style={{ background: textMain, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>{journal.save}</button>
            </div>
          </Surface>
        </div>

        <div className="mb-4 flex items-center gap-2">
          {(['all', 'keepsake'] as const).map((key) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', filter === key ? 'bg-[var(--nimi-text-primary)] text-white' : 'bg-white/60 text-[var(--nimi-text-secondary)] hover:bg-white')}>
              {key === 'all' ? journal.filterAll : journal.filterKeepsake}
            </button>
          ))}
        </div>
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.label}>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: textSoft }}>{group.label}</p>
              <div className="space-y-2">
                {group.items.map((entry) => (
                  <Surface key={entry.id} as="article" material="glass-regular" tone="card" padding="none" className="rounded-[18px] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[12px]" style={{ color: textMuted }}>
                        <span className="tabular-nums">{entry.time}</span>
                        {entry.dimension ? <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[#0f6b80]">{entry.dimension}</span> : null}
                        {entry.keepsake ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"><Star size={10} aria-hidden="true" />{journal.keepsakeBadge}</span> : null}
                      </div>
                      <span className="text-[12px]" style={{ color: textSoft }}>{entry.recorder}</span>
                    </div>
                    <p className="mt-2 text-[14px] leading-relaxed" style={{ color: textMain }}>{entry.text}</p>
                  </Surface>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 档案 / 报告 / 设置 ───────────────────────────────────────────────── */

function ProfilePage({ content, notice }: { content: HeroDemoParentosPreview; notice: (text: string) => void }) {
  const profile = content.profile;
  return (
    <div className="hide-scrollbar h-full overflow-y-auto px-6 pb-10 pt-8 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <Surface as="section" material="glass-thick" tone="card" padding="none" className="mb-6 flex flex-wrap items-center gap-6 rounded-[24px] p-6">
          <ChildAvatar src={content.child.avatarSrc} name={content.child.name} className="h-24 w-24 rounded-full object-cover ring-4 ring-white/80" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: textSoft }}>{profile.title}</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{content.child.name}</h1>
            <p className="mt-1 text-[14px]" style={{ color: textMuted }}>{content.child.ageLabel} · {content.child.genderLabel} · {profile.recordSummary}</p>
            <div className="mt-4 max-w-sm">
              <div className="mb-1.5 flex items-center justify-between text-[12px]" style={{ color: textMuted }}>
                <span>{profile.completenessLabel}</span>
                <span className="font-semibold" style={{ color: textMain }}>{profile.completeness}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(148,163,184,0.16)' }}>
                <div className="h-full rounded-full" style={{ width: `${profile.completeness}%`, background: '#4ECCA3' }} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => notice(content.notices.hostOnly)} className="rounded-full px-5 py-2.5 text-[14px] font-medium text-white" style={{ background: textMain, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>{profile.addData}</button>
            <button type="button" onClick={() => notice(content.notices.hostOnly)} className="rounded-full border border-[var(--nimi-border-subtle)] bg-white/70 px-5 py-2.5 text-[14px] font-medium" style={{ color: textMain }}>{profile.editChild}</button>
          </div>
        </Surface>
        <h2 className="mb-4 text-[18px] font-semibold" style={{ color: textMain }}>{profile.archiveTitle}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profile.groups.map((group) => (
            <Surface key={group.id} as="section" material="glass-regular" tone="card" padding="none" className="rounded-[20px] p-5 transition-transform hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold" style={{ color: textMain }}>{group.name}</h3>
                <button type="button" className="text-[12px] font-medium" style={{ color: textMuted }} onClick={() => notice(content.notices.hostOnly)}>查看全部</button>
              </div>
              <p className="mt-1 text-[12px]" style={{ color: textMuted }}>{group.summary}</p>
              <dl className="mt-4 space-y-2">
                {group.metrics.map((metric) => (
                  <div key={metric.label} className="flex items-center justify-between text-[13px]">
                    <dt style={{ color: textMuted }}>{metric.label}</dt>
                    <dd className="font-semibold" style={{ color: textMain }}>{metric.value}</dd>
                  </div>
                ))}
              </dl>
            </Surface>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportsPage({ content, notice }: { content: HeroDemoParentosPreview; notice: (text: string) => void }) {
  const reports = content.reports;
  const [preset, setPreset] = useState(0);
  return (
    <div className="hide-scrollbar h-full overflow-y-auto px-6 pb-10 pt-8 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{reports.title}</h1>
            <p className="mt-1 text-[14px]" style={{ color: textMuted }}>{reports.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reports.presets.map((label, index) => (
              <button key={label} type="button" onClick={() => setPreset(index)} className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors', preset === index ? 'bg-[var(--nimi-text-primary)] text-white' : 'bg-white/60 text-[var(--nimi-text-secondary)] hover:bg-white')}>{label}</button>
            ))}
            <button type="button" onClick={() => notice(content.notices.hostOnly)} className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white" style={{ background: '#45B8D6' }}>{reports.generate}</button>
          </div>
        </header>
        <Surface as="article" material="glass-thick" tone="card" padding="none" className="rounded-[24px] p-7 sm:p-9">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-700"><Star size={12} aria-hidden="true" />{reports.letter.badge}</span>
            <span className="text-[12px]" style={{ color: textMuted }}>{reports.letter.period}</span>
          </div>
          <p className="parentos-journal-hero-title mt-6 text-[20px] font-semibold" style={{ color: textMain }}>{reports.letter.greeting}</p>
          <div className="mt-4 space-y-4">
            {reports.letter.paragraphs.map((paragraph) => <p key={paragraph} className="text-[15px] leading-[1.9]" style={{ color: textMain }}>{paragraph}</p>)}
          </div>
          <div className="dashboard-inset mt-6 rounded-[16px] bg-white/50 p-5">
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: textMuted }}>{reports.letter.actionsTitle}</p>
            <ol className="mt-3 space-y-2">
              {reports.letter.actions.map((action, index) => (
                <li key={action} className="flex items-start gap-3 text-[14px]" style={{ color: textMain }}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: 'rgba(78,204,163,0.16)', color: '#059669' }}>{index + 1}</span>
                  {action}
                </li>
              ))}
            </ol>
          </div>
        </Surface>
      </div>
    </div>
  );
}

const SETTINGS_ICONS: Record<string, { Icon: IconComponent; className: string }> = {
  children: { Icon: Baby, className: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]' },
  nurture: { Icon: Sprout, className: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]' },
  reminders: { Icon: BellRing, className: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]' },
  ai: { Icon: Bot, className: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]' },
};

function SettingsPage({ content, notice }: { content: HeroDemoParentosPreview; notice: (text: string) => void }) {
  const settings = content.settings;
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  return (
    <div className="hide-scrollbar h-full overflow-y-auto px-6 pb-10 pt-8 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-[28px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>{settings.title}</h1>
        <Surface as="section" material="glass-regular" tone="card" padding="none" className="mb-6 flex items-center gap-4 rounded-[20px] p-5">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#2fc79a] to-[#22cce7] text-[16px] font-bold text-slate-950">{Array.from(settings.account.name)[0]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold" style={{ color: textMain }}>{settings.account.name}</p>
            <p className="text-[12px]" style={{ color: textMuted }}>{settings.account.note}</p>
          </div>
        </Surface>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: textSoft }}>{settings.general}</p>
        <Surface as="section" material="glass-regular" tone="card" padding="none" className="mb-6 rounded-[20px]">
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]"><Languages size={18} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold" style={{ color: textMain }}>{settings.languageTitle}</p>
              <p className="text-[12px]" style={{ color: textMuted }}>{settings.languageDesc}</p>
            </div>
            <div className="flex rounded-full bg-white/70 p-1">
              {(['zh', 'en'] as const).map((key) => (
                <button key={key} type="button" onClick={() => setLanguage(key)} className={cn('rounded-full px-3 py-1 text-[12px] font-medium', language === key ? 'bg-[var(--nimi-text-primary)] text-white' : 'text-[var(--nimi-text-secondary)]')}>{key === 'zh' ? '中文' : 'English'}</button>
              ))}
            </div>
          </div>
          {settings.sections.map((section) => {
            const meta = SETTINGS_ICONS[section.id] ?? SETTINGS_ICONS.children!;
            const Icon = meta.Icon;
            return (
              <button key={section.id} type="button" onClick={() => notice(content.notices.hostOnly)} className="flex w-full items-center gap-4 border-t border-[var(--nimi-border-subtle)] px-5 py-4 text-left transition-colors hover:bg-white/50">
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', meta.className)}><Icon size={18} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold" style={{ color: textMain }}>{section.label}</p>
                  <p className="text-[12px]" style={{ color: textMuted }}>{section.desc}</p>
                </div>
                <ChevronRight size={16} style={{ color: textSoft }} aria-hidden="true" />
              </button>
            );
          })}
        </Surface>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: textSoft }}>{settings.other}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {settings.info.map((card, index) => (
            <Surface key={card.label} as="section" material="glass-regular" tone="card" padding="none" className="flex items-start gap-3 rounded-[18px] p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70" style={{ color: textMuted }}>{index === 0 ? <ShieldCheck size={17} aria-hidden="true" /> : <Info size={17} aria-hidden="true" />}</span>
              <div>
                <p className="text-[14px] font-semibold" style={{ color: textMain }}>{card.label}</p>
                <p className="mt-0.5 text-[12px]" style={{ color: textMuted }}>{card.desc}</p>
              </div>
            </Surface>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── shell (shell-layout.tsx) ─────────────────────────────────────────── */

function ChildAppMenu({ content, onNavigate, onNotice }: { content: HeroDemoParentosPreview; onNavigate: (route: ParentosRoute) => void; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeChild, setActiveChild] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const escHandler = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escHandler); };
  }, [open]);
  const children = [{ name: content.child.name, ageLabel: content.child.ageLabel }, ...content.child.siblings];
  return (
    <div ref={ref} className="relative z-40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={content.childMenuLabel}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-[var(--nimi-elevation-base)] ring-1 ring-[var(--nimi-border-subtle)] transition-all hover:-translate-y-0.5"
      >
        <ChildAvatar src={content.child.avatarSrc} name={content.child.name} className="h-full w-full object-cover" />
      </button>
      {open ? (
        <Surface
          as="div"
          material="glass-thick"
          padding="none"
          tone="card"
          role="menu"
          className="absolute bottom-12 left-0 z-50 w-64 origin-bottom-left overflow-y-auto rounded-xl border-[var(--nimi-material-glass-thick-border)] py-2 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="px-3.5 pb-1 pt-1 text-[12px] font-medium text-[var(--nimi-text-muted)]">{content.childSwitcherLabel}</div>
          <div className="px-1.5">
            {children.map((child, index) => {
              const isActive = index === activeChild;
              return (
                <button
                  key={child.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => { setActiveChild(index); setOpen(false); if (index !== 0) onNotice(content.notices.hostOnly); }}
                  className={cn('flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]', isActive && 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)]')}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full', isActive ? 'ring-2 ring-[var(--nimi-action-primary-bg)]' : 'ring-1 ring-[var(--nimi-border-subtle)]')}>
                      {index === 0 ? <ChildAvatar src={content.child.avatarSrc} name={child.name} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center bg-sky-100 text-[12px] font-semibold text-sky-700">{Array.from(child.name)[0]}</span>}
                    </span>
                    <div className="min-w-0">
                      <span className={cn('block truncate text-[14px] font-semibold', isActive ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]')}>{child.name}</span>
                      <span className="block text-[12px] text-[var(--nimi-text-muted)]">{child.ageLabel}</span>
                    </div>
                  </div>
                  {isActive ? <Check size={16} strokeWidth={2.2} className="text-[var(--nimi-action-primary-bg)]" aria-hidden="true" /> : null}
                </button>
              );
            })}
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onNavigate('settings'); }} className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--nimi-border-strong)] text-[var(--nimi-text-muted)] transition-colors group-hover:border-[var(--nimi-action-primary-bg)] group-hover:text-[var(--nimi-action-primary-bg)]">
                <Plus size={16} strokeWidth={1.8} aria-hidden="true" className="transition-transform duration-300 ease-out group-hover:rotate-90" />
              </span>
              <span className="text-[14px] font-medium text-[var(--nimi-text-muted)] transition-colors group-hover:text-[var(--nimi-action-primary-bg)]">{content.addFamilyMember}</span>
            </button>
          </div>
          <div className="mx-3 my-1 border-t border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]" />
          <div className="px-1.5 py-1.5">
            {([['profile', User], ['settings', Settings]] as const).map(([route, Icon]) => (
              <button key={route} type="button" role="menuitem" onClick={() => { setOpen(false); onNavigate(route); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[var(--nimi-text-secondary)] transition-all hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]">
                <Icon size={18} strokeWidth={1.8} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
                {content.nav[route]}
              </button>
            ))}
          </div>
        </Surface>
      ) : null}
    </div>
  );
}

export function DemoParentosPreview({ content }: { content: HeroDemoParentosPreview }) {
  const [route, setRoute] = useState<ParentosRoute>('timeline');
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  const page = useMemo(() => {
    switch (route) {
      case 'timeline': return <TimelinePage content={content} navigate={setRoute} notice={showNotice} />;
      case 'profile': return <ProfilePage content={content} notice={showNotice} />;
      case 'journal': return <JournalPage content={content} notice={showNotice} />;
      case 'advisor': return <AdvisorPage content={content} notice={showNotice} />;
      case 'reports': return <ReportsPage content={content} notice={showNotice} />;
      case 'settings': return <SettingsPage content={content} notice={showNotice} />;
    }
  }, [content, route, showNotice]);

  return (
    <div className="demo-parentos-root" data-demo-parentos-root="true" data-demo-owns-scroll="true" data-demo-interactive="true" data-parentos-route={route}>
      <AmbientBackground variant="mesh" className="isolate flex h-full overflow-hidden">
        <nav className="relative z-30 flex w-[62px] shrink-0 flex-col items-center overflow-visible bg-transparent pb-5 pt-6" aria-label={content.appName}>
          <div className="flex h-[60px] w-full shrink-0 items-center justify-center">
            <img src="/demo/parentos-icon.png" alt={content.logoAlt} className="h-7 w-7 shrink-0 rounded-[7px] object-contain" />
          </div>
          <div className="flex flex-1 flex-col items-center gap-1 pt-4">
            {NAV_ITEMS.map((item) => {
              const label = content.nav[item.id];
              const isActive = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setRoute(item.id)}
                  className={`group relative flex h-[40px] w-[40px] items-center justify-center rounded-xl transition-all duration-150 ${isActive ? 'bg-[var(--nimi-text-primary)] text-[var(--nimi-text-inverse)] shadow-[var(--nimi-elevation-base)]' : 'text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]'}`}
                >
                  <item.Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                  <span className="nimi-material-glass-thick pointer-events-none absolute left-[52px] z-50 whitespace-nowrap rounded-2xl border border-[var(--nimi-material-glass-thick-border)] bg-[var(--nimi-material-glass-thick-bg)] px-3 py-1.5 text-[13px] font-medium text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] transition-opacity duration-100 group-hover:opacity-100">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto">
            <ChildAppMenu content={content} onNavigate={setRoute} onNotice={showNotice} />
          </div>
        </nav>
        <div className="relative flex min-w-0 flex-1 flex-col">
          {notice ? (
            <div className="demo-parentos-notice" role="status" data-demo-parentos-notice="true">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)}>{content.notices.dismiss}</button>
            </div>
          ) : null}
          <main className="relative z-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="h-full">{page}</div>
          </main>
        </div>
      </AmbientBackground>
    </div>
  );
}
