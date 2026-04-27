import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import { getProfileSectionSummaries } from '../../bridge/sqlite-bridge.js';
import type { SectionSummary } from '../../bridge/sqlite-bridge.js';
import { ChildAvatar } from '../../shared/child-avatar.js';
import growthIcon from './assets/archive-icons/growth.png';
import visionIcon from './assets/archive-icons/vision.png';
import fitnessIcon from './assets/archive-icons/fitness.png';
import dentalIcon from './assets/archive-icons/dental.png';
import heightIcon from './assets/archive-icons/height.png';
import milestonesIcon from './assets/archive-icons/milestones.png';
import vaccinesIcon from './assets/archive-icons/vaccines.png';
import allergiesIcon from './assets/archive-icons/allergies.png';
import sleepIcon from './assets/archive-icons/sleep.png';
import medicalIcon from './assets/archive-icons/medical.png';
import postureIcon from './assets/archive-icons/posture.png';
import outdoorIcon from './assets/archive-icons/outdoor.png';
import keepsakeIcon from './assets/archive-icons/keepsake.png';
import smartScanIcon from './assets/archive-icons/smart-scan.png';

/* ── design tokens ──────────────────────────────────────── */

const C = {
  bg: '#f1f5f9', text: '#1e293b', sub: '#475569',
  card: '#ffffff', accent: '#1e293b',
  shadow: '0 8px 32px rgba(31,38,135,0.04)',
} as const;

/* ── section registry (archive routes only) ─────────────── */

interface ArchiveSection {
  sectionId: string;
  to: string;
  iconSrc: string;
  iconOffsetX?: number;
  iconScale?: number;
  label: string;
  desc: string;
  color: string;
  /** If set, only show when ageMonths meets condition */
  ageGate?: (ageMonths: number) => boolean;
  /** Alt label/desc for different age ranges */
  altLabel?: (ageMonths: number) => { label: string; desc: string } | null;
}

const ARCHIVE_SECTIONS: ArchiveSection[] = [
  { sectionId: 'growth', to: '/profile/growth', iconSrc: growthIcon, label: '生长曲线', desc: '身高、体重、头围的 WHO 百分位曲线', color: '#ede7fb' },
  {
    sectionId: 'milestones', to: '/profile/milestones', iconSrc: milestonesIcon, label: '发育里程碑', desc: '追踪大运动、精细动作、语言等里程碑', color: '#fbe8d4',
    altLabel: (age) => age > 72 ? { label: '早期发育记录', desc: '查看 0-6 岁发育里程碑的历史记录' } : null,
  },
  { sectionId: 'vaccines', to: '/profile/vaccines', iconSrc: vaccinesIcon, label: '疫苗记录', desc: '疫苗接种记录和接种计划', color: '#ddedfb' },
  { sectionId: 'vision', to: '/profile/vision', iconSrc: visionIcon, label: '视力档案', desc: '验光单、眼轴单和视力变化趋势追踪', color: '#dde4f5' },
  { sectionId: 'dental', to: '/profile/dental', iconSrc: dentalIcon, iconOffsetX: -2.5, iconScale: 1.2, label: '口腔发育', desc: '乳牙萌出、换牙和口腔检查记录', color: '#e2f0dc' },
  { sectionId: 'allergies', to: '/profile/allergies', iconSrc: allergiesIcon, iconOffsetX: -2, iconScale: 1.16, label: '过敏记录', desc: '食物、药物和环境过敏原记录', color: '#f5dce8' },
  { sectionId: 'sleep', to: '/profile/sleep', iconSrc: sleepIcon, label: '睡眠记录', desc: '睡眠时长、作息规律和睡眠质量追踪', color: '#dde4f5' },
  { sectionId: 'medical-events', to: '/profile/medical-events', iconSrc: medicalIcon, iconOffsetX: -2, iconScale: 1.16, label: '就医记录', desc: '门诊、住院、用药和检验报告', color: '#e5dcf5' },
  { sectionId: 'posture', to: '/profile/posture', iconSrc: postureIcon, iconScale: 1.14, label: '体态档案', desc: '脊柱侧弯、足弓和身体姿态评估', color: '#e5f0dc' },
  { sectionId: 'tanner', to: '/profile/tanner', iconSrc: heightIcon, iconOffsetX: -2.5, label: '青春期发育', desc: 'Tanner 分期、骨龄和青春期发育追踪', color: '#e2f0dc', ageGate: (age) => age >= 84 },
  { sectionId: 'fitness', to: '/profile/fitness', iconSrc: fitnessIcon, label: '体能测评', desc: '体能测试成绩和运动能力评估', color: '#fbe8d4' },
  { sectionId: 'outdoor', to: '/profile/outdoor', iconSrc: outdoorIcon, label: '每周户外目标', desc: '户外活动记录、每周进度和趋势追踪', color: '#dcf0e5' },
];

/* ── tool routes (non-archive) ──────────────────────────── */

interface ToolEntry { to: string; iconSrc: string; iconOffsetX?: number; iconScale?: number; label: string; desc: string }

const TOOL_ENTRIES: ToolEntry[] = [
  { to: '/profile/report-upload', iconSrc: smartScanIcon, label: '智能识别', desc: '上传体检单，自动识别数据' },
];

/* ── cross-link routes (non-archive, non-tool) ──────────── */

const CROSS_LINKS: ToolEntry[] = [
  { to: '/journal?filter=keepsake', iconSrc: keepsakeIcon, label: '高光时刻', desc: '珍藏的成长瞬间和重要里程碑' },
];

/* ── age-adaptive ordering (PO-PROF-024) ────────────────── */

const AGE_TIERS: Array<{ maxAge: number; topIds: string[] }> = [
  { maxAge: 12, topIds: ['growth', 'milestones', 'vaccines', 'sleep', 'medical-events'] },
  { maxAge: 36, topIds: ['growth', 'milestones', 'vaccines', 'dental', 'sleep'] },
  { maxAge: 72, topIds: ['growth', 'dental', 'vision', 'vaccines', 'fitness'] },
  { maxAge: 120, topIds: ['vision', 'growth', 'fitness', 'dental', 'tanner'] },
  { maxAge: Infinity, topIds: ['vision', 'fitness', 'growth', 'tanner', 'dental'] },
];

function orderSections(sections: ArchiveSection[], ageMonths: number): ArchiveSection[] {
  const tier = AGE_TIERS.find((t) => ageMonths <= t.maxAge)!;
  const topSet = new Set(tier.topIds);
  const top: ArchiveSection[] = [];
  const rest: ArchiveSection[] = [];
  // First pass: collect top-tier in tier order
  for (const id of tier.topIds) {
    const s = sections.find((sec) => sec.sectionId === id);
    if (s) top.push(s);
  }
  // Second pass: remaining in registration order
  for (const s of sections) {
    if (!topSet.has(s.sectionId)) rest.push(s);
  }
  return [...top, ...rest];
}

/* ── helpers ─────────────────────────────────────────────── */

function pctComplete(child: { birthWeightKg: number | null; birthHeightCm: number | null; birthHeadCircCm: number | null; avatarPath: string | null; allergies: string[] | null; medicalNotes: string[] | null; recorderProfiles: Array<{ id: string; name: string }> | null }) {
  const f = [child.birthWeightKg, child.birthHeightCm, child.birthHeadCircCm, child.avatarPath, child.allergies, child.medicalNotes, child.recorderProfiles];
  return Math.round((f.filter((v) => v != null).length / f.length) * 100);
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function ProfilePage() {
  const activeChildId = useAppStore((s) => s.activeChildId);
  const children = useAppStore((s) => s.children);
  const activeChild = children.find((c) => c.childId === activeChildId);

  const [summaries, setSummaries] = useState<SectionSummary[]>([]);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback((childId: string) => {
    setLoading(true);
    setSummaryError(null);
    getProfileSectionSummaries(childId)
      .then((sumData) => { setSummaries(sumData); setLoading(false); })
      .catch((e) => { setSummaryError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!activeChildId) return;
    loadData(activeChildId);
  }, [activeChildId, loadData]);

  if (!activeChild) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: C.sub }}>
        请先添加孩子档案
      </div>
    );
  }

  const ageMonths = computeAgeMonths(activeChild.birthDate);
  const ageY = Math.floor(ageMonths / 12);
  const ageR = ageMonths % 12;
  const pct = pctComplete(activeChild);

  // Build summary lookup
  const summaryMap = useMemo(() => {
    const m = new Map<string, SectionSummary>();
    for (const s of summaries) m.set(s.sectionId, s);
    return m;
  }, [summaries]);

  // Filter visible archive sections and apply age-adaptive ordering
  const orderedSections = useMemo(() => {
    const visible = ARCHIVE_SECTIONS.filter((s) => !s.ageGate || s.ageGate(ageMonths));
    return orderSections(visible, ageMonths);
  }, [ageMonths]);

  return (
    <div className="h-full overflow-y-auto hide-scrollbar" style={{ background: 'transparent' }}>
      <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 16 }}>

        {/* ── Profile header card ────────────────────────────── */}
        <Surface as="div" material="glass-thick" padding="none" tone="card" className="relative overflow-hidden p-6 mb-6 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
          <div className="flex items-center gap-5">
            {/* Avatar */}
            <ChildAvatar
              child={activeChild}
              ageMonths={ageMonths}
              className="w-[72px] h-[72px] rounded-full object-cover border-2"
              style={{ borderColor: 'rgba(226,232,240,0.3)', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
            />
            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold tracking-tight" style={{ color: '#1e293b', letterSpacing: '-0.3px' }}>{activeChild.displayName}</h1>
              <p className="text-[14px] mt-0.5" style={{ color: '#475569' }}>
                {ageY > 0 ? `${ageY}岁` : ''}{ageR > 0 ? `${ageR}个月` : ''} · {activeChild.gender === 'male' ? '男孩' : '女孩'} · 出生 {activeChild.birthDate}
              </p>
              {/* Profile completeness */}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: '#F0F4F8' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#4ECCA3' }} />
                </div>
                <span className="text-[12px]" style={{ color: '#475569' }}>{pct}%</span>
              </div>
            </div>
            {/* Edit button */}
            <Link to="/settings/children" className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-medium text-white transition-all hover:-translate-y-0.5" style={{ background: '#1e293b', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              编辑
            </Link>
          </div>
        </Surface>

        {/* ── Summary load error ─────────────────────────────── */}
        {summaryError && (
          <div className="rounded-[14px] p-4 mb-4 flex items-center justify-between" style={{ background: '#f5f5f4', border: '1px solid #e7e5e4' }}>
            <p className="text-[14px]" style={{ color: '#78716c' }}>档案摘要暂时无法加载</p>
            <button onClick={() => activeChildId && loadData(activeChildId)} className="text-[13px] px-3 py-1 rounded-full" style={{ background: '#e7e5e4', color: '#57534e' }}>
              重试
            </button>
          </div>
        )}

        {/* ── Section grid (archive only) ───────────────────── */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[16px] font-bold" style={{ color: C.text }}>健康档案</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {orderedSections.map((s) => {
            const summary = summaryMap.get(s.sectionId);
            const alt = s.altLabel?.(ageMonths);
            const label = alt?.label ?? s.label;
            const desc = alt?.desc ?? s.desc;

            return (
              <Surface key={s.to} as={Link} to={s.to} material="glass-regular" padding="none" tone="card"
                className="flex items-start gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
                <ArchiveCardIcon src={s.iconSrc} offsetX={s.iconOffsetX} scale={s.iconScale} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>{label}</h3>
                  {/* Section summary line */}
                  {!loading && summary && (
                    <SectionStatusLine summary={summary} />
                  )}
                  <p className="text-[13px] mt-0.5 leading-snug" style={{ color: C.sub }}>{desc}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-1"><path d="M9 18l6-6-6-6" /></svg>
              </Surface>
            );
          })}
        </div>

        {/* ── Cross links ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {CROSS_LINKS.map((t) => (
            <Surface key={t.to} as={Link} to={t.to} material="glass-regular" padding="none" tone="card"
              className="flex items-center gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
              <ArchiveCardIcon src={t.iconSrc} offsetX={t.iconOffsetX} scale={t.iconScale} />
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>{t.label}</h3>
                <p className="text-[13px] mt-0.5" style={{ color: C.sub }}>{t.desc}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" className="shrink-0"><path d="M9 18l6-6-6-6" /></svg>
            </Surface>
          ))}
        </div>

        {/* ── Tool area (separated per PO-PROF-023) ─────────── */}
        {TOOL_ENTRIES.length > 0 && (
          <>
            <div className="flex items-center mb-3 mt-6">
              <h2 className="text-[16px] font-bold" style={{ color: C.text }}>工具</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TOOL_ENTRIES.map((t) => (
                <Surface key={t.to} as={Link} to={t.to} material="glass-regular" padding="none" tone="card"
                  className="flex items-center gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]"
                  style={{ borderLeft: `3px solid ${C.accent}` }}>
                  <ArchiveCardIcon src={t.iconSrc} offsetX={t.iconOffsetX} scale={t.iconScale} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>{t.label}</h3>
                    <p className="text-[13px] mt-0.5" style={{ color: C.sub }}>{t.desc}</p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" className="shrink-0"><path d="M9 18l6-6-6-6" /></svg>
                </Surface>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Section status line component ──────────────────────── */

function ArchiveCardIcon({ src, offsetX = 0, scale = 1 }: { src: string; offsetX?: number; scale?: number }) {
  return (
    <div className="w-[42px] h-[42px] rounded-[12px] overflow-hidden shrink-0 shadow-[0_4px_12px_rgba(148,163,184,0.12)]">
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="block w-full h-full object-cover"
        style={{ transform: `translateX(${offsetX}px) scale(${scale})` }}
      />
    </div>
  );
}

function SectionStatusLine({ summary }: { summary: SectionSummary }) {
  if (summary.state === 'error') {
    return (
      <p className="text-[12px] mt-0.5" style={{ color: C.sub }}>
        点击重试
      </p>
    );
  }
  if (summary.state === 'empty') {
    return null;
  }
  return (
    <p className="text-[12px] mt-0.5" style={{ color: '#16a34a' }}>
      {summary.recordCount} 条{summary.lastUpdatedAt ? ` · ${formatRelativeDate(summary.lastUpdatedAt)}` : ''}
    </p>
  );
}
