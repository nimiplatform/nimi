import { Button, OverlayShell, Surface, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect, useMemo } from 'react';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import type { MilestoneDomain } from '../../knowledge-base/gen/milestone-catalog.gen.js';
import { getMilestoneRecords, upsertMilestoneRecord } from '../../bridge/sqlite-bridge.js';
import type { MilestoneRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import { ProfileDatePicker } from './profile-date-picker.js';

/* ── domain config ───────────────────────────────────────── */

const DOMAINS: Array<{ key: MilestoneDomain; label: string; emoji: string; toneClass: string }> = [
  { key: 'gross-motor', label: '大运动', emoji: '🏃', toneClass: 'bg-[var(--nimi-surface-active)]' },
  { key: 'fine-motor', label: '精细动作', emoji: '✋', toneClass: 'bg-[var(--nimi-surface-muted)]' },
  { key: 'language', label: '语言', emoji: '💬', toneClass: 'bg-[var(--nimi-surface-active)]' },
  { key: 'cognitive', label: '认知', emoji: '🧠', toneClass: 'bg-[var(--nimi-surface-muted)]' },
  { key: 'social-emotional', label: '社交情绪', emoji: '🤝', toneClass: 'bg-[var(--nimi-surface-muted)]' },
  { key: 'self-care', label: '自理', emoji: '🪥', toneClass: 'bg-[var(--nimi-surface-active)]' },
];
const DOMAIN_MAP = new Map(DOMAINS.map((d) => [d.key, d]));

type AgeBucket = {
  startMonth: number;
  endMonth: number;
  label: string;
  milestones: typeof MILESTONE_CATALOG;
};

function formatAchievedDate(achievedAt: string | null | undefined) {
  return achievedAt?.split('T')[0] ?? '已记录';
}

/* ================================================================
   RADAR CHART (pure SVG)
   ================================================================ */

function RadarChart({ data }: { data: Array<{ label: string; pct: number }> }) {
  const n = data.length;
  const cx = 100, cy = 100, r = 70;
  const angleStep = (2 * Math.PI) / n;

  const pointAt = (i: number, radius: number) => {
    const a = -Math.PI / 2 + i * angleStep;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };

  // Grid rings
  const rings = [0.25, 0.5, 0.75, 1];
  // Axis lines
  const axes = Array.from({ length: n }, (_, i) => pointAt(i, r));
  // Data polygon
  const dataPts = data.map((d, i) => pointAt(i, r * Math.min(1, d.pct / 100)));

  return (
    <svg width="200" height="200" viewBox="0 0 200 200" className="mx-auto">
      {/* Grid rings */}
      {rings.map((s) => (
        <polygon key={s} points={Array.from({ length: n }, (_, i) => pointAt(i, r * s).join(',')).join(' ')}
          fill="none" stroke="var(--nimi-border-subtle)" strokeWidth="0.5" />
      ))}
      {/* Axes */}
      {axes.map(([x, y], i) => (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--nimi-border-subtle)" strokeWidth="0.5" />
      ))}
      {/* Data polygon */}
      <polygon points={dataPts.map((p) => p.join(',')).join(' ')}
        fill={'var(--nimi-action-primary-bg)'} fillOpacity="0.15" stroke={'var(--nimi-action-primary-bg)'} strokeWidth="1.5" />
      {/* Data dots */}
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={'var(--nimi-action-primary-bg)'} />
      ))}
      {/* Labels */}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, r + 18);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fontWeight="600" fill={'var(--nimi-text-primary)'}>{d.label}</text>
        );
      })}
    </svg>
  );
}

/* ================================================================
   RECORD DETAIL MODAL
   ================================================================ */

function RecordModal({ milestone, record, childId, ageMonths, onSave, onClose }: {
  milestone: typeof MILESTONE_CATALOG[number];
  record: MilestoneRecordRow | undefined;
  childId: string; ageMonths: number;
  onSave: () => void; onClose: () => void;
}) {
  const [date, setDate] = useState(record?.achievedAt?.split('T')[0] ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [photoPreview, setPhotoPreview] = useState<string | null>(record?.photoPath ?? null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertMilestoneRecord({
        recordId: record?.recordId ?? ulid(),
        childId,
        milestoneId: milestone.milestoneId,
        achievedAt: date ? new Date(date).toISOString() : isoNow(),
        ageMonthsWhenAchieved: ageMonths,
        notes: [notes.trim() || null, photoPreview ? `photo:${photoPreview}` : null].filter(Boolean).join('\n') || null,
        photoPath: null,
        now: isoNow(),
      });
      onSave();
      onClose();
    } catch { /* bridge unavailable */ }
    setSaving(false);
  };

  const handlePhoto = async (file: File | null) => {
    if (!file) { setPhotoPreview(null); return; }
    try { setPhotoPreview(await readImageFileAsDataUrl(file)); } catch { /* ignore */ }
  };

  const dm = DOMAIN_MAP.get(milestone.domain as MilestoneDomain);

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      panelClassName="w-[420px] rounded-3xl"
      title={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">{dm?.emoji ?? '🎯'}</span>
            <h2 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">{milestone.title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-muted)]">✕</button>
        </div>
      }
      contentClassName="space-y-4"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} tone="ghost" size="md">取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving} tone="primary" size="md">
            {saving ? '保存中...' : '✅ 记录达成'}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] text-[var(--nimi-text-muted)]">{milestone.description}</p>
      <div>
        <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">达成日期</label>
        <ProfileDatePicker value={date} onChange={setDate} />
      </div>
      <div>
        <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">记录小故事 ✏️</label>
        <TextareaField value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="例如：第一次找到藏起来的球，开心地咯咯笑..."
          className="w-full" rows={3} />
      </div>
      <div>
        <label className="text-[13px] mb-1 block text-[var(--nimi-text-muted)]">添加照片 📷</label>
        <input type="file" accept="image/*" className="text-[14px]"
          onChange={(e) => void handlePhoto(e.target.files?.[0] ?? null)} />
        {photoPreview && <img src={photoPreview} alt="" className="mt-2 h-24 rounded-2xl object-cover" />}
      </div>
    </OverlayShell>
  );
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function MilestonePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<MilestoneRecordRow[]>([]);
  const [editingMilestone, setEditingMilestone] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'radar'>('timeline');
  const [pastExpanded, setPastExpanded] = useState(false);

  useEffect(() => {
    if (activeChildId) getMilestoneRecords(activeChildId).then(setRecords).catch(catchLog('milestone', 'action:load-milestone-records-failed'));
  }, [activeChildId]);

  if (!child) {
    return (
      <ProfileDetailShell title="发育里程碑">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const isArchive = ageMonths > 72; // 6+ years: read-only archive view
  const recordMap = new Map(records.map((r) => [r.milestoneId, r]));
  const achievedCount = records.filter((r) => r.achievedAt).length;

  const reload = () => { getMilestoneRecords(child.childId).then(setRecords).catch(catchLog('milestone', 'action:reload-milestone-records-failed')); };

  const handleQuickCheck = async (milestoneId: string) => {
    const existing = recordMap.get(milestoneId);
    try {
      await upsertMilestoneRecord({
        recordId: existing?.recordId ?? ulid(),
        childId: child.childId, milestoneId,
        achievedAt: isoNow(),
        ageMonthsWhenAchieved: ageMonths,
        notes: existing?.notes ?? null,
        photoPath: existing?.photoPath ?? null,
        now: isoNow(),
      });
      reload();
    } catch { /* bridge unavailable */ }
  };

  const handleUnachieve = async (milestoneId: string) => {
    const rec = recordMap.get(milestoneId);
    if (!rec) return;
    try {
      await upsertMilestoneRecord({
        recordId: rec.recordId, childId: child.childId, milestoneId,
        achievedAt: null, ageMonthsWhenAchieved: null, notes: null, photoPath: null, now: isoNow(),
      });
      reload();
    } catch { /* bridge unavailable */ }
  };

  /* ── Radar data ─────────────────────────────────────────── */
  const radarData = useMemo(() => DOMAINS.map((d) => {
    const ms = MILESTONE_CATALOG.filter((m) => m.domain === d.key);
    const achieved = ms.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
    return { label: d.label, pct: ms.length > 0 ? Math.round((achieved / ms.length) * 100) : 0 };
  }), [recordMap]);

  /* ── Timeline: group milestones by age buckets ──────────── */
  const ageBuckets = useMemo(() => {
    const buckets: AgeBucket[] = [];
    const ranges = [[0, 3, '0-3 个月'], [4, 6, '4-6 个月'], [7, 9, '7-9 个月'], [10, 12, '10-12 个月'],
      [13, 18, '13-18 个月'], [19, 24, '19-24 个月'], [25, 36, '2-3 岁'], [37, 48, '3-4 岁'],
      [49, 60, '4-5 岁'], [61, 72, '5-6 岁'], [73, 96, '6-8 岁'], [97, 120, '8-10 岁'],
      [121, 144, '10-12 岁'], [145, 180, '12-15 岁'], [181, 216, '15-18 岁']] as const;
    for (const [s, e, lbl] of ranges) {
      const ms = MILESTONE_CATALOG.filter((m) => m.typicalAge.medianMonths >= s && m.typicalAge.medianMonths <= e);
      if (ms.length > 0) buckets.push({ startMonth: s, endMonth: e, label: lbl, milestones: ms });
    }
    return buckets;
  }, []);

  /* ── Split buckets into past / current / future ─────────── */
  const { pastBuckets, currentBucket, futureBuckets } = useMemo(() => {
    const past: typeof ageBuckets = [];
    let cur: typeof ageBuckets[number] | null = null;
    const future: typeof ageBuckets = [];
    for (const b of ageBuckets) {
      if (ageMonths > b.endMonth) past.push(b);
      else if (ageMonths >= b.startMonth && ageMonths <= b.endMonth) cur = b;
      else future.push(b);
    }
    return { pastBuckets: past, currentBucket: cur, futureBuckets: future };
  }, [ageBuckets, ageMonths]);

  const pastSummary = useMemo(() => {
    const totalMs = pastBuckets.reduce((n, b) => n + b.milestones.length, 0);
    const achievedMs = pastBuckets.reduce((n, b) => n + b.milestones.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length, 0);
    return { total: totalMs, achieved: achievedMs };
  }, [pastBuckets, recordMap]);
  const pastPendingCount = Math.max(0, pastSummary.total - pastSummary.achieved);

  /* ── Upcoming milestones (±3 months from current age) ──── */
  const upcoming = useMemo(() =>
    MILESTONE_CATALOG.filter((m) => {
      if (recordMap.get(m.milestoneId)?.achievedAt) return false;
      return ageMonths >= m.typicalAge.rangeStart - 3 && ageMonths <= m.typicalAge.rangeEnd + 3;
    }).slice(0, 5),
  [ageMonths, recordMap]);

  const editTarget = editingMilestone ? MILESTONE_CATALOG.find((m) => m.milestoneId === editingMilestone) : null;

  return (
    <ProfileDetailShell
      title={
        <span className="flex items-center gap-2">
          <span>{isArchive ? '早期发育记录' : '发育里程碑'}</span>
          <span className="group relative inline-flex">
            <span className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center cursor-help transition-colors hover:bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-muted)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </span>
            <Surface
              tone="overlay"
              material="glass-thick"
              elevation="floating"
              padding="none"
              className="pointer-events-none absolute left-0 top-7 z-50 w-[340px] rounded-xl p-4 text-[13px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
            >
              <p className="text-[14px] font-semibold text-[var(--nimi-text-primary)] mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">大运动 · 精细动作 · 语言 · 认知</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">CDC Developmental Milestones (2022 updated).</span>
                  <span className="block text-[12px] text-[var(--nimi-text-subtle)]">Zubler JM, et al. Evidence-Informed Milestones for Developmental Surveillance. MMWR 2022;71(1):1-4</span>
                </li>
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">社交情绪 · 自理能力</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">Ages &amp; Stages Questionnaires (ASQ-3), 3rd Edition.</span>
                  <span className="block text-[12px] text-[var(--nimi-text-subtle)]">Squires J, Bricker D. Paul H. Brookes Publishing, 2009</span>
                </li>
                <li>
                  <span className="text-[var(--nimi-action-primary-bg)] font-medium">中国儿童发育参考</span>
                  <span className="block text-[12px] text-[var(--nimi-text-muted)] mt-0.5">国家卫生健康委员会.《0-6岁儿童健康管理技术规范》· 首都儿科研究所《0-6岁儿童发育行为评估量表》</span>
                </li>
              </ul>
              <p className="text-[12px] mt-2.5 pt-2 border-t border-[var(--nimi-border-subtle)] text-[var(--nimi-text-subtle)]">每项标注中位月龄和正常范围 · 超过警示月龄未达成建议咨询专业人士</p>
            </Surface>
          </span>
        </span>
      }
      actions={
        <span className="text-[14px] px-3 py-1 rounded-full bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
          已达成 {achievedCount}/{MILESTONE_CATALOG.length}
        </span>
      }
      aiSummary={
        <AISummaryCard domain="milestone" childName={child.displayName} childId={child.childId}
          ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
          dataContext={achievedCount > 0
            ? `已达成 ${achievedCount}/${MILESTONE_CATALOG.length} 个里程碑。${DOMAINS.map((d) => {
              const ms = MILESTONE_CATALOG.filter((m) => m.domain === d.key);
              const ac = ms.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
              return `${d.label}: ${ac}/${ms.length}`;
            }).join(', ')}`
            : ''} />
      }
    >
      {/* ── 4. Upcoming milestones (主动推送, hidden in archive mode) ── */}
      {!isArchive && upcoming.length > 0 && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="mb-5 rounded-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[16px]">🔔</span>
            <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">即将到来的里程碑</h3>
          </div>
          <div className="space-y-2">
            {upcoming.map((m) => {
              const rec = recordMap.get(m.milestoneId);
              const achieved = !!rec?.achievedAt;
              return (
                <div
                  key={m.milestoneId}
                  className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors hover:bg-[var(--nimi-surface-active)] ${
                    achieved
                      ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]'
                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-muted)]'
                  }`}
                >
                  {/* Check circle — quick toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); void (achieved ? handleUnachieve(m.milestoneId) : handleQuickCheck(m.milestoneId)); }}
                    className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                      achieved
                        ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                        : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                    }`}
                    title={achieved ? '撤销达成' : '标记已达成'}>
                    {achieved && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-medium ${achieved ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>{m.title}</p>
                    <p className="text-[12px] text-[var(--nimi-text-muted)]">
                      {achieved ? `${formatAchievedDate(rec?.achievedAt)} 达成` : `典型 ${formatAge(m.typicalAge.rangeStart)}-${formatAge(m.typicalAge.rangeEnd)} · ${m.description.slice(0, 30)}...`}
                    </p>
                  </div>
                  <button onClick={() => setEditingMilestone(m.milestoneId)}
                    className="text-[12px] shrink-0 rounded-full border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                    📝 {achieved ? '补个故事' : '记录'}
                  </button>
                </div>
              );
            })}
          </div>
        </Surface>
      )}

      {/* ── View toggle: Timeline / Radar ────────────────────── */}
      <div className="flex gap-1 rounded-full bg-[var(--nimi-surface-muted)] p-1 mb-5 w-fit">
        {([['timeline', '📋 时间轴'], ['radar', '📊 雷达图']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-all ${
              activeTab === k
                ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-sm'
                : 'text-[var(--nimi-text-muted)]'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── 3. Radar chart view ──────────────────────────────── */}
      {activeTab === 'radar' && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="mb-5 rounded-3xl">
          <h3 className="text-[14px] font-semibold mb-2 text-center text-[var(--nimi-text-primary)]">发展轮廓总览</h3>
          <RadarChart data={radarData} />
          <div className="grid grid-cols-3 gap-2 mt-4">
            {radarData.map((d) => (
              <div key={d.label} className="flex items-center gap-2 rounded-2xl bg-[var(--nimi-surface-muted)] p-2">
                <div className="w-2 h-2 rounded-full bg-[var(--nimi-action-primary-bg)]" />
                <span className="text-[13px] text-[var(--nimi-text-primary)]">{d.label}</span>
                <span className="text-[13px] font-bold ml-auto text-[var(--nimi-text-primary)]">{d.pct}%</span>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* ── 1. Timeline view ─────────────────────────────────── */}
      {activeTab === 'timeline' && isArchive && (
        <div className="relative">
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px] bg-[var(--nimi-border-subtle)]" />
          {ageBuckets.map((bucket) => {
            const bucketAchieved = bucket.milestones.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
            return (
              <div key={bucket.label} className="relative pl-10 pb-6">
                <div
                  className={`absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center bg-[var(--nimi-surface-card)] ${
                    bucketAchieved > 0 ? 'border-[var(--nimi-action-primary-bg)]' : 'border-[var(--nimi-border-subtle)]'
                  }`}
                >
                  {bucketAchieved > 0 && <div className="w-[6px] h-[6px] rounded-full bg-[var(--nimi-action-primary-bg)]" />}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{bucket.label}</span>
                  <span className="text-[12px] px-2 py-0.5 rounded-full bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)]">
                    {bucketAchieved}/{bucket.milestones.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {bucket.milestones.map((m) => {
                    const rec = recordMap.get(m.milestoneId);
                    const achieved = !!rec?.achievedAt;
                    return (
                      <div
                        key={m.milestoneId}
                        className={`flex items-center gap-2.5 rounded-2xl border p-2.5 ${
                          achieved
                            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]'
                            : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                        }`}
                      >
                        {/* Static icon — no toggle in archive mode */}
                        {achieved ? (
                          <div className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                          </div>
                        ) : (
                          <div className="w-[20px] h-[20px] rounded-full border-[1.5px] border-[var(--nimi-border-subtle)] shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[14px] font-medium ${achieved ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'}`}>{m.title}</p>
                          <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">
                            {achieved ? `${formatAchievedDate(rec?.achievedAt)} 达成` : '未记录'}
                          </p>
                        </div>
                        <button
                          onClick={() => setEditingMilestone(m.milestoneId)}
                          className="text-[12px] shrink-0 rounded-full border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                          📝 {achieved ? '补个故事' : '补记'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'timeline' && !isArchive && (
        <div className="space-y-5">
          {pastBuckets.length > 0 && (
            <Surface as="section" tone="card" material="glass-regular" elevation="raised" padding="md" className="rounded-3xl">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-surface-active)] text-[16px]"
                    >
                      🗂️
                    </span>
                    <span className="text-[14px] font-semibold tracking-[0.08em] text-[var(--nimi-action-primary-bg)]">
                      成长档案
                    </span>
                  </div>
                  <h3 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">
                    已走过的阶段
                  </h3>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--nimi-text-muted)]">
                    {pastBuckets[0]!.label} ~ {pastBuckets[pastBuckets.length - 1]!.label} 的成长足迹，随时可以回顾和补记
                  </p>
                </div>

                <Button
                  onClick={() => setPastExpanded(!pastExpanded)}
                  tone="secondary"
                  size="sm"
                  className="gap-2"
                >
                  {pastExpanded ? '收起成长档案' : '展开成长档案'}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className={`shrink-0 transition-transform duration-200 ${pastExpanded ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-full bg-[var(--nimi-surface-active)] px-3 py-1 text-[12px] font-medium text-[var(--nimi-action-primary-bg)]">
                  已走过 {pastBuckets.length} 个阶段
                </div>
                <div className="rounded-full bg-[var(--nimi-surface-muted)] px-3 py-1 text-[12px] font-medium text-[var(--nimi-text-primary)]">
                  已记录 {pastSummary.achieved}/{pastSummary.total} 项
                </div>
                <div className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] px-3 py-1 text-[12px] font-medium text-[var(--nimi-status-warning)]">
                  {pastPendingCount} 项可补记
                </div>
              </div>

              {pastExpanded && (
                <div className="mt-5 space-y-3">
                  {pastBuckets.slice().reverse().map((bucket) => {
                    const bucketAchieved = bucket.milestones.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
                    const bucketPending = bucket.milestones.length - bucketAchieved;

                    return (
                      <Surface
                        key={bucket.label}
                        tone="card"
                        material="solid"
                        elevation="base"
                        padding="md"
                        className={`rounded-2xl border ${
                          bucketPending === 0
                            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]'
                            : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
                              {bucket.label}
                            </span>
                            <span
                              className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-[12px] font-medium text-[var(--nimi-text-primary)]"
                            >
                              已记录 {bucketAchieved}/{bucket.milestones.length}
                            </span>
                            {bucketPending > 0 && (
                              <span
                                className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--nimi-status-warning)]"
                              >
                                待补记 {bucketPending} 项
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] leading-5 text-[var(--nimi-text-muted)]">
                            {bucketPending > 0 ? '还有未记录的项目，可以补上哦' : '所有里程碑都已记录'}
                          </p>
                        </div>

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {bucket.milestones.map((m) => {
                            const rec = recordMap.get(m.milestoneId);
                            const achieved = !!rec?.achievedAt;
                            const dm = DOMAIN_MAP.get(m.domain as MilestoneDomain);
                            return (
                              <div
                                key={m.milestoneId}
                                className={`group flex items-center gap-3 rounded-2xl border p-3 transition-all duration-150 ${
                                  achieved
                                    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)]'
                                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-muted)]'
                                }`}
                              >
                                {/* Check circle — quick toggle */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); void (achieved ? handleUnachieve(m.milestoneId) : handleQuickCheck(m.milestoneId)); }}
                                  className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                                    achieved
                                      ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                                      : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                                  }`}
                                  title={achieved ? '撤销达成' : '标记已达成'}>
                                  {achieved && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                                </button>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className={`text-[14px] font-medium ${achieved ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
                                      {m.title}
                                    </p>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[12px] font-medium text-[var(--nimi-text-primary)] ${dm?.toneClass ?? 'bg-[var(--nimi-surface-muted)]'}`}
                                    >
                                      {dm?.label ?? '里程碑'}
                                    </span>
                                  </div>
                                  <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-[var(--nimi-text-muted)]">
                                    {achieved ? `${formatAchievedDate(rec?.achievedAt)} 达成` : m.description}
                                  </p>
                                </div>

                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingMilestone(m.milestoneId); }}
                                  className="text-[12px] shrink-0 rounded-full border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                                  📝 {achieved ? '补个故事' : '记录'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </Surface>
                    );
                  })}
                </div>
              )}
            </Surface>
          )}

          {(currentBucket || futureBuckets.length > 0) && (
            <div className="relative">
              <div className="absolute left-[18px] top-0 bottom-0 w-[2px] bg-[var(--nimi-border-subtle)]" />

              {/* ── Current stage ───────────────────────────────── */}
              {currentBucket && (
                <div className="relative pl-10 pb-6">
                  <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]" />
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[14px] font-bold text-[var(--nimi-action-primary-bg)]">{currentBucket.label}</span>
                    <span className="text-[12px] px-2 py-0.5 rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">当前阶段</span>
                  </div>
                  <div className="space-y-1.5">
                    {currentBucket.milestones.map((m) => {
                      const rec = recordMap.get(m.milestoneId);
                      const achieved = !!rec?.achievedAt;
                      return (
                        <div
                          key={m.milestoneId}
                          className={`group flex items-center gap-2.5 rounded-2xl border p-2.5 transition-all duration-150 hover:shadow-sm ${
                            achieved
                              ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-active)]'
                              : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                          }`}
                        >
                          {/* Check circle — quick toggle */}
                          <button
                            onClick={(e) => { e.stopPropagation(); void (achieved ? handleUnachieve(m.milestoneId) : handleQuickCheck(m.milestoneId)); }}
                            className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                              achieved
                                ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                                : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]'
                            }`}
                            title={achieved ? '撤销达成' : '标记已达成'}>
                            {achieved && <svg viewBox="0 0 12 12" className="w-2.5 h-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                          </button>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-[14px] font-medium ${achieved ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>{m.title}</p>
                            <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">
                              {achieved ? `${formatAchievedDate(rec?.achievedAt)} 达成` : m.description}
                            </p>
                          </div>
                          {/* Detail record button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingMilestone(m.milestoneId); }}
                            className="text-[12px] shrink-0 rounded-full border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                            📝 {achieved ? '补个故事' : '记录'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Future stages ───────────────────────────────── */}
              {futureBuckets.map((bucket) => (
                <div key={bucket.label} className="relative pl-10 pb-6 opacity-40">
                  <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-muted)]" />
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{bucket.label}</span>
                  </div>
                  <div className="space-y-1.5">
                    {bucket.milestones.map((m) => {
                      const dm = DOMAIN_MAP.get(m.domain as MilestoneDomain);
                      return (
                        <div key={m.milestoneId}
                          className="flex items-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-2.5">
                          <div className={`w-[28px] h-[28px] rounded-lg flex items-center justify-center text-[16px] shrink-0 ${dm?.toneClass ?? 'bg-[var(--nimi-surface-muted)]'}`}>
                            {dm?.emoji ?? '🎯'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{m.title}</p>
                            <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">{m.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Record modal ─────────────────────────────────────── */}
      {editTarget && (
        <RecordModal
          milestone={editTarget}
          record={recordMap.get(editTarget.milestoneId)}
          childId={child.childId}
          ageMonths={ageMonths}
          onSave={reload}
          onClose={() => setEditingMilestone(null)}
        />
      )}
    </ProfileDetailShell>
  );
}
