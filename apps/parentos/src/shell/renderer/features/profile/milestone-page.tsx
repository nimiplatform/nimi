import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { MILESTONE_CATALOG } from '../../knowledge-base/index.js';
import type { MilestoneDomain } from '../../knowledge-base/gen/milestone-catalog.gen.js';
import { getMilestoneRecords, upsertMilestoneRecord } from '../../bridge/sqlite-bridge.js';
import type { MilestoneRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';

/* ── domain config ───────────────────────────────────────── */

const DOMAINS: Array<{ key: MilestoneDomain; label: string; emoji: string; color: string }> = [
  { key: 'gross-motor', label: '大运动', emoji: '🏃', color: '#e8f5e9' },
  { key: 'fine-motor', label: '精细动作', emoji: '✋', color: '#fff3e0' },
  { key: 'language', label: '语言', emoji: '💬', color: '#e3f2fd' },
  { key: 'cognitive', label: '认知', emoji: '🧠', color: '#f3e5f5' },
  { key: 'social-emotional', label: '社交情绪', emoji: '🤝', color: '#fce4ec' },
  { key: 'self-care', label: '自理', emoji: '🪥', color: '#e0f7fa' },
];
const DOMAIN_MAP = new Map(DOMAINS.map((d) => [d.key, d]));

/* ================================================================
   RADAR CHART (pure SVG)
   ================================================================ */

function RadarChart({ data }: { data: Array<{ label: string; pct: number; color: string }> }) {
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
          fill="none" stroke="#e8e5e0" strokeWidth="0.5" />
      ))}
      {/* Axes */}
      {axes.map(([x, y], i) => (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e8e5e0" strokeWidth="0.5" />
      ))}
      {/* Data polygon */}
      <polygon points={dataPts.map((p) => p.join(',')).join(' ')}
        fill={S.accent} fillOpacity="0.15" stroke={S.accent} strokeWidth="1.5" />
      {/* Data dots */}
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={S.accent} />
      ))}
      {/* Labels */}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, r + 18);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fontWeight="600" fill={S.text}>{d.label}</text>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={onClose}>
      <div className={`w-[420px] ${S.radius} p-6 shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[20px]">{dm?.emoji ?? '🎯'}</span>
            <h2 className="text-[15px] font-bold" style={{ color: S.text }}>{milestone.title}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>
        <p className="text-[12px] mb-4" style={{ color: S.sub }}>{milestone.description}</p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>达成日期</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className={`w-full ${S.radiusSm} px-3 py-1.5 text-sm`}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>记录小故事 ✏️</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="例如：第一次找到藏起来的球，开心地咯咯笑..."
              className={`w-full ${S.radiusSm} px-3 py-2 text-[12px] resize-none`} rows={3}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>添加照片 📷</label>
            <input type="file" accept="image/*" className="text-[12px]"
              onChange={(e) => void handlePhoto(e.target.files?.[0] ?? null)} />
            {photoPreview && <img src={photoPreview} alt="" className={`mt-2 h-24 ${S.radiusSm} object-cover`} />}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => void handleSave()} disabled={saving}
            className={`flex-1 py-2 text-[13px] font-medium text-white ${S.radiusSm} disabled:opacity-50`}
            style={{ background: S.accent }}>
            {saving ? '保存中...' : '✅ 记录达成'}
          </button>
          <button onClick={onClose}
            className={`px-4 py-2 text-[13px] ${S.radiusSm}`}
            style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
        </div>
      </div>
    </div>
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

  useEffect(() => {
    if (activeChildId) getMilestoneRecords(activeChildId).then(setRecords).catch(() => {});
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const recordMap = new Map(records.map((r) => [r.milestoneId, r]));
  const achievedCount = records.filter((r) => r.achievedAt).length;

  const reload = () => { getMilestoneRecords(child.childId).then(setRecords).catch(() => {}); };

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
    return { label: d.label, pct: ms.length > 0 ? Math.round((achieved / ms.length) * 100) : 0, color: d.color };
  }), [recordMap]);

  /* ── Timeline: group milestones by age buckets ──────────── */
  const ageBuckets = useMemo(() => {
    const buckets: Array<{ startMonth: number; endMonth: number; label: string; milestones: typeof MILESTONE_CATALOG }> = [];
    const ranges = [[0, 3, '0-3 个月'], [4, 6, '4-6 个月'], [7, 9, '7-9 个月'], [10, 12, '10-12 个月'],
      [13, 18, '13-18 个月'], [19, 24, '19-24 个月'], [25, 36, '2-3 岁'], [37, 48, '3-4 岁'],
      [49, 60, '4-5 岁'], [61, 72, '5-6 岁'], [73, 96, '6-8 岁'], [97, 120, '8-10 岁'],
      [121, 144, '10-12 岁'], [145, 180, '12-15 岁'], [181, 216, '15-18 岁']] as const;
    for (const [s, e, lbl] of ranges) {
      const ms = MILESTONE_CATALOG.filter((m) => m.typicalAge.medianMonths >= s && m.typicalAge.medianMonths <= e);
      if (ms.length > 0) buckets.push({ startMonth: s, endMonth: e, label: lbl, milestones: ms });
    }
    return buckets.reverse();
  }, []);

  /* ── Upcoming milestones (±3 months from current age) ──── */
  const upcoming = useMemo(() =>
    MILESTONE_CATALOG.filter((m) => {
      if (recordMap.get(m.milestoneId)?.achievedAt) return false;
      return ageMonths >= m.typicalAge.rangeStart - 3 && ageMonths <= m.typicalAge.rangeEnd + 3;
    }).slice(0, 5),
  [ageMonths, recordMap]);

  const editTarget = editingMilestone ? MILESTONE_CATALOG.find((m) => m.milestoneId === editingMilestone) : null;

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>发育里程碑</h1>
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[340px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1a2b4a', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[12px] font-semibold text-white mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[#c8e64a] font-medium">大运动 · 精细动作 · 语言 · 认知</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">CDC Developmental Milestones (2022 updated).</span>
                  <span className="block text-[10px] text-[#7a8090]">Zubler JM, et al. Evidence-Informed Milestones for Developmental Surveillance. MMWR 2022;71(1):1-4</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">社交情绪 · 自理能力</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">Ages &amp; Stages Questionnaires (ASQ-3), 3rd Edition.</span>
                  <span className="block text-[10px] text-[#7a8090]">Squires J, Bricker D. Paul H. Brookes Publishing, 2009</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">中国儿童发育参考</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">国家卫生健康委员会.《0-6岁儿童健康管理技术规范》· 首都儿科研究所《0-6岁儿童发育行为评估量表》</span>
                </li>
              </ul>
              <p className="text-[9px] mt-2.5 pt-2 border-t border-white/10 text-[#808890]">每项标注中位月龄和正常范围 · 超过警示月龄未达成建议咨询专业人士</p>
            </div>
          </div>
        </div>
        <span className="text-[12px] px-3 py-1 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>
          已达成 {achievedCount}/{MILESTONE_CATALOG.length}
        </span>
      </div>
      <p className="text-[12px] mb-5" style={{ color: S.sub }}>
        {child.displayName}，{Math.floor(ageMonths / 12)}岁{ageMonths % 12}个月
      </p>

      {/* AI Summary */}
      <AISummaryCard domain="milestone" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={achievedCount > 0
          ? `已达成 ${achievedCount}/${MILESTONE_CATALOG.length} 个里程碑。${DOMAINS.map((d) => {
            const ms = MILESTONE_CATALOG.filter((m) => m.domain === d.key);
            const ac = ms.filter((m) => recordMap.get(m.milestoneId)?.achievedAt).length;
            return `${d.label}: ${ac}/${ms.length}`;
          }).join(', ')}`
          : ''} />

      {/* ── 4. Upcoming milestones (主动推送) ────────────────── */}
      {upcoming.length > 0 && (
        <div className={`${S.radius} p-5 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[16px]">🔔</span>
            <h3 className="text-[13px] font-semibold" style={{ color: S.text }}>即将到来的里程碑</h3>
          </div>
          <div className="space-y-2">
            {upcoming.map((m) => {
              const dm = DOMAIN_MAP.get(m.domain as MilestoneDomain);
              return (
                <div key={m.milestoneId} className={`flex items-center gap-3 p-3 ${S.radiusSm} transition-colors hover:bg-[#f4f7ea]/50`}
                  style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
                  <div className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[14px] shrink-0" style={{ background: dm?.color ?? '#f0f0ec' }}>
                    {dm?.emoji ?? '🎯'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: S.text }}>{m.title}</p>
                    <p className="text-[10px]" style={{ color: S.sub }}>
                      典型 {formatAge(m.typicalAge.rangeStart)}-{formatAge(m.typicalAge.rangeEnd)} · {m.description.slice(0, 30)}...
                    </p>
                  </div>
                  <button onClick={() => setEditingMilestone(m.milestoneId)}
                    className={`px-3 py-1 text-[11px] font-medium text-white ${S.radiusSm} transition-colors hover:opacity-90`}
                    style={{ background: S.accent }}>记录</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── View toggle: Timeline / Radar ────────────────────── */}
      <div className="flex gap-1 rounded-full p-1 mb-5 w-fit" style={{ background: '#eceeed' }}>
        {([['timeline', '📋 时间轴'], ['radar', '📊 雷达图']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            className="px-4 py-1.5 text-[11px] font-medium rounded-full transition-all"
            style={activeTab === k
              ? { background: S.card, color: S.text, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
              : { color: S.sub }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── 3. Radar chart view ──────────────────────────────── */}
      {activeTab === 'radar' && (
        <div className={`${S.radius} p-5 mb-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <h3 className="text-[13px] font-semibold mb-2 text-center" style={{ color: S.text }}>发展轮廓总览</h3>
          <RadarChart data={radarData} />
          <div className="grid grid-cols-3 gap-2 mt-4">
            {radarData.map((d) => (
              <div key={d.label} className={`flex items-center gap-2 p-2 ${S.radiusSm}`} style={{ background: '#f9faf7' }}>
                <div className="w-2 h-2 rounded-full" style={{ background: S.accent }} />
                <span className="text-[11px]" style={{ color: S.text }}>{d.label}</span>
                <span className="text-[11px] font-bold ml-auto" style={{ color: S.text }}>{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 1. Timeline view ─────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

          {ageBuckets.map((bucket) => {
            const isCurrent = ageMonths >= bucket.startMonth && ageMonths <= bucket.endMonth;
            const isPast = ageMonths > bucket.endMonth;
            const isFuture = ageMonths < bucket.startMonth;

            return (
              <div key={bucket.label} className={`relative pl-10 pb-6 ${isFuture ? 'opacity-40' : ''}`}>
                {/* Timeline dot */}
                <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                  style={{
                    background: isCurrent ? S.accent : isPast ? S.card : '#eceeed',
                    borderColor: isCurrent ? S.accent : isPast ? S.accent : S.border,
                  }}>
                  {isPast && <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />}
                </div>

                {/* Age label */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: isCurrent ? S.accent : S.text }}>{bucket.label}</span>
                  {isCurrent && <span className="text-[9px] px-2 py-0.5 rounded-full text-white" style={{ background: S.accent }}>当前阶段</span>}
                </div>

                {/* Milestone cards */}
                <div className="space-y-1.5">
                  {bucket.milestones.map((m) => {
                    const rec = recordMap.get(m.milestoneId);
                    const achieved = !!rec?.achievedAt;
                    const dm = DOMAIN_MAP.get(m.domain as MilestoneDomain);

                    return (
                      <div key={m.milestoneId}
                        className={`flex items-center gap-2.5 p-2.5 ${S.radiusSm} transition-all duration-150 cursor-pointer hover:shadow-sm`}
                        style={{ background: achieved ? '#f4f7ea' : S.card, border: `1px solid ${achieved ? S.accent + '40' : S.border}` }}
                        onClick={() => achieved ? undefined : setEditingMilestone(m.milestoneId)}>
                        {/* Check / domain icon */}
                        {achieved ? (
                          <div className="w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0"
                            style={{ background: S.accent, color: '#fff' }}>
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                          </div>
                        ) : (
                          <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[14px] shrink-0"
                            style={{ background: dm?.color ?? '#f0f0ec' }}>
                            {dm?.emoji ?? '🎯'}
                          </div>
                        )}
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium" style={{ color: achieved ? S.accent : S.text }}>{m.title}</p>
                          <p className="text-[10px] truncate" style={{ color: S.sub }}>
                            {achieved && rec?.achievedAt ? `${rec.achievedAt.split('T')[0]} 达成` : m.description}
                          </p>
                        </div>
                        {/* Actions */}
                        {achieved ? (
                          <button onClick={(e) => { e.stopPropagation(); void handleUnachieve(m.milestoneId); }}
                            className="text-[10px] shrink-0 opacity-0 group-hover:opacity-100 px-2 py-1 rounded-full hover:bg-[#f0f0ec]"
                            style={{ color: S.sub }}>撤销</button>
                        ) : (
                          <span className="text-[10px] shrink-0" style={{ color: S.sub }}>点击记录</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
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
    </div>
  );
}
