import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { Bone, BookOpen, Eye, Mic, Moon, Ruler, Sparkles, Syringe, Trophy } from 'lucide-react';
import { useAppStore, computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import { ChildAvatar } from '../../shared/child-avatar.js';
import {
  buildQuickLinks,
  describeNurtureMode,
  formatAgeLabel,
  type RecentChangeIconName,
  type RecentChangeItem,
} from './timeline-data.js';
import { Cd, Hdr, textMain, textMuted, textSoft } from './timeline-card-primitives.js';
import growthIcon from '../profile/assets/archive-icons/growth.png';
import visionIcon from '../profile/assets/archive-icons/vision.png';
import fitnessIcon from '../profile/assets/archive-icons/fitness.png';
import dentalIcon from '../profile/assets/archive-icons/dental.png';
import heightIcon from '../profile/assets/archive-icons/height.png';
import milestonesIcon from '../profile/assets/archive-icons/milestones.png';
import vaccinesIcon from '../profile/assets/archive-icons/vaccines.png';
import allergiesIcon from '../profile/assets/archive-icons/allergies.png';
import sleepIcon from '../profile/assets/archive-icons/sleep.png';
import medicalIcon from '../profile/assets/archive-icons/medical.png';
import postureIcon from '../profile/assets/archive-icons/posture.png';
import outdoorIcon from '../profile/assets/archive-icons/outdoor.png';
import smartScanIcon from '../profile/assets/archive-icons/smart-scan.png';
import journalQuickLinkIcon from './assets/journal-quick-link.png';

const ICON_BY_DOMAIN: Record<RecentChangeIconName, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
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

const _ICON_TINT: Record<string, string> = {
  '📏': 'rgba(78,204,163,0.12)',
  '💉': 'rgba(251,191,36,0.10)',
  '😴': 'rgba(129,140,248,0.12)',
  '📝': 'rgba(251,146,60,0.10)',
  '📄': 'rgba(129,140,248,0.10)',
  '🏥': 'rgba(248,113,113,0.10)',
  '🎯': 'rgba(78,204,163,0.12)',
  '👁️': 'rgba(96,165,250,0.12)',
  '🦷': 'rgba(251,191,36,0.10)',
  '🏃': 'rgba(251,146,60,0.10)',
  '🌱': 'rgba(78,204,163,0.12)',
  '🧍': 'rgba(244,114,182,0.10)',
};

const QUICK_LINK_ICON_META: Record<string, { src: string; offsetX?: number; scale?: number; bg?: string }> = {
  growth: { src: growthIcon },
  vaccines: { src: vaccinesIcon, offsetX: -2 },
  sleep: { src: sleepIcon },
  journal: { src: journalQuickLinkIcon, offsetX: -3, scale: 1.18, bg: 'rgba(167, 139, 250, 0.12)' },
  reports: { src: smartScanIcon },
  medical: { src: medicalIcon, offsetX: -2, scale: 1.16 },
  milestones: { src: milestonesIcon },
  outdoor: { src: outdoorIcon },
  vision: { src: visionIcon },
  dental: { src: dentalIcon, offsetX: -4, scale: 1.2 },
  fitness: { src: fitnessIcon },
  tanner: { src: heightIcon, offsetX: -2.5 },
  posture: { src: postureIcon, scale: 1.14 },
  allergies: { src: allergiesIcon, offsetX: -2, scale: 1.16 },
};

const DEFAULT_QUICK_LINK_ICON_META: { src: string; offsetX?: number; scale?: number; bg?: string } = { src: smartScanIcon };

function QuickLinkIcon({ src, offsetX = 0, scale = 1, bg }: { src: string; offsetX?: number; scale?: number; bg?: string }) {
  return (
    <div
      className="mb-3 h-11 w-11 overflow-hidden rounded-xl transition-transform duration-200 group-hover:scale-110"
      style={{ background: bg, boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}
      aria-hidden="true"
    >
      <img
        src={src}
        alt=""
        className="block h-full w-full object-cover"
        style={{ transform: `translateX(${offsetX}px) scale(${scale})` }}
      />
    </div>
  );
}

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
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full"
                  style={{ outline: isActive ? '2px solid #4ECCA3' : '1px solid rgba(226, 232, 240, 0.95)' }}
                >
                  <ChildAvatar child={item} className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold" style={{ color: isActive ? '#2F7D6B' : textMain }}>{item.displayName}</p>
                  <p className="text-[12px]" style={{ color: textMuted }}>{formatAgeLabel(computeAgeMonths(item.birthDate))} · {item.gender === 'female' ? '女孩' : '男孩'}</p>
                </div>
              </button>
            );
          })}
        </Surface>
      ) : null}
    </div>
  );
}

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
      <div className="relative flex h-full flex-col items-center overflow-hidden px-6 pb-6 pt-12" style={{ borderRadius: 24, isolation: 'isolate' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: meshBackground, filter: 'blur(24px)', zIndex: 0 }} />
        <div
          className="relative nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
          style={{ width: 120, height: 120, padding: 4, borderRadius: '50%', boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}
          data-nimi-material="glass-regular"
          data-nimi-tone="card"
        >
          <ChildAvatar child={child} ageMonths={ageMonths} className="h-full w-full rounded-full object-cover" />
        </div>
        <div className="relative mt-6 max-w-full text-center">
          <h2 className="truncate text-[24px] font-semibold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.3px' }}>
            {child.displayName}
          </h2>
          <p className="mt-1.5 text-[14px]" style={{ color: '#86868b' }}>
            {formatAgeLabel(ageMonths)} · {child.gender === 'female' ? '女孩' : '男孩'}
          </p>
        </div>
        <div className="relative mt-auto flex w-full flex-col items-center gap-3">
          <span className="inline-flex items-center rounded-full px-3 py-[5px] text-[13px] font-medium" style={{ background: 'rgba(52,199,89,0.12)', color: '#248a3d' }}>
            <span className="mr-1.5 inline-block h-[6px] w-[6px] rounded-full" style={{ background: '#34c759' }} />
            {describeNurtureMode(child.nurtureMode)}
          </span>
          <Link to="/profile" className="flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-[14px] font-medium transition-colors hover:bg-black/[0.04]" style={{ color: '#1d1d1f' }}>
            查看完整档案
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 opacity-60">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
      <ChildSwitchPopover child={child} childList={childList} />
    </div>
  );
}

function RecentChangeLeadCell({ item }: { item: RecentChangeItem }) {
  return (
    <Link
      to={item.to}
      className="col-span-3 flex flex-col rounded-[22px] p-6 transition-all duration-200 hover:-translate-y-0.5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card"
    >
      <div className="flex items-center gap-3">
        <RecentChangeIcon item={item} size={20} />
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: textSoft }}>
          {item.label}
        </span>
      </div>
      <p className="mt-5 text-[16px] font-semibold leading-snug" style={{ color: textMain, letterSpacing: '-0.1px' }}>{item.title}</p>
      {item.metric ? (
        <p className="mt-2 text-[48px] font-semibold leading-none tabular-nums" style={{ color: textMain, letterSpacing: '-1.4px' }}>
          {item.metric.value}
          {item.metric.unit ? <span className="ml-1.5 text-[18px] font-medium" style={{ color: textMuted }}>{item.metric.unit}</span> : null}
        </p>
      ) : null}
      {item.summary ? (
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {item.summary}
        </p>
      ) : null}
      <p className="mt-auto pt-4 text-[13px] font-medium tabular-nums" style={{ color: textSoft }}>{item.subtitle ?? item.detail}</p>
    </Link>
  );
}

function RecentChangeSecondaryCell({ item }: { item: RecentChangeItem }) {
  return (
    <Link
      to={item.to}
      className="block rounded-[18px] p-4 transition-all duration-200 hover:-translate-y-0.5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card"
    >
      <div className="flex items-start gap-3">
        <RecentChangeIcon item={item} size={16} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold" style={{ color: textMain }}>{item.title}</p>
          {item.summary ? <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.summary}</p> : null}
          <p className="mt-1.5 text-[12px] tabular-nums" style={{ color: textSoft }}>{item.subtitle ?? item.detail}</p>
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
          <p className="text-[13px] font-medium tracking-[0.08em]" style={{ color: textSoft }}>最近 7 天</p>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
            最近变化
          </h2>
        </div>
        <Link to="/profile" className="text-[13px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }}>
          查看档案
        </Link>
      </div>

      {lead ? (
        <div className="grid grid-cols-5 gap-4">
          <RecentChangeLeadCell item={lead} />
          <div className="col-span-2 space-y-3">
            {secondary.map((item) => <RecentChangeSecondaryCell key={item.id} item={item} />)}
            {secondary.length === 0 ? (
              <div className="rounded-[18px] p-4 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
                <p className="text-[14px] font-semibold" style={{ color: textMain }}>再记录一点会更完整</p>
                <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>
                  继续补充睡眠、测量或观察后，这里会把最近变化串成更完整的脉络。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-[22px] p-7 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[16px] font-semibold" style={{ color: textMain }}>最近 7 天还没有新的变化</p>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: textMuted }}>
            先记录一次测量、观察或睡眠数据，首页会在这里归纳最近的变化。
          </p>
          <Link to="/journal" className="mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-medium text-white transition-all hover:-translate-y-0.5" style={{ background: textMain, boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
            去记录一条 <span>→</span>
          </Link>
        </div>
      )}
    </Cd>
  );
}

export function StageFocusCard({ periods }: { periods: Array<{ periodId: string; title: string; observableSigns: string[]; ageRange: { peakMonths: number } }> }) {
  return (
    <Cd cls="col-span-4">
      <Hdr title="当前发展阶段" to="/reminders" link="查看全部提醒" />
      {periods.length > 0 ? (
        <div className="space-y-4">
          {periods.slice(0, 2).map((period) => (
            <div key={period.periodId} className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-600">敏感期</span>
                <p className="text-[14px] font-semibold" style={{ color: textMain }}>{period.title}</p>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: textMuted }}>{period.observableSigns[0] ?? '这个阶段值得继续观察孩子最近的变化。'}</p>
              <Link to={`/journal?topic=${encodeURIComponent(period.title)}`}
                className="mt-3 inline-flex rounded-full px-4 py-1.5 text-[13px] font-medium text-white hover:-translate-y-0.5"
                style={{ background: textMain, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>去记录</Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[16px] p-5 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]" style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
          <p className="text-[14px] font-semibold" style={{ color: textMain }}>当前阶段相对平稳</p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: textMuted }}>下一个敏感期命中后，这里会解释为什么值得关注。</p>
        </div>
      )}
    </Cd>
  );
}

export function QuickLinksStrip({ ageMonths }: { ageMonths: number }) {
  const links = buildQuickLinks(ageMonths);
  return (
    <Cd cls="col-span-8">
      <Hdr title="常用入口" />
      <div className="grid grid-cols-6 gap-4">
        {links.map((item) => (
          (() => {
            const iconMeta = QUICK_LINK_ICON_META[item.id] ?? DEFAULT_QUICK_LINK_ICON_META;
            return (
              <Link key={item.to} to={item.to}
                className="group flex flex-col items-center rounded-[20px] px-3 py-5 transition-all duration-200 hover:-translate-y-1 nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
                style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }} data-nimi-material="glass-regular" data-nimi-tone="card">
                <QuickLinkIcon src={iconMeta.src} offsetX={iconMeta.offsetX} scale={iconMeta.scale} bg={iconMeta.bg} />
                <p className="text-[13px] font-semibold" style={{ color: textMain }}>{item.label}</p>
              </Link>
            );
          })()
        ))}
      </div>
    </Cd>
  );
}
