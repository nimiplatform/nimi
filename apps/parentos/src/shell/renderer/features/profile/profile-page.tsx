import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, getVaccineRecords, getMilestoneRecords, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';

/* ── design tokens (same as dashboard) ───────────────────── */

const C = {
  bg: '#E5ECEA', text: '#1a2b4a', sub: '#8a8f9a',
  card: '#ffffff', accent: '#94A533', shadow: '0 2px 12px rgba(0,0,0,0.06)',
} as const;

/* ── section definitions ─────────────────────────────────── */

interface Section { to: string; emoji: string; label: string; desc: string; color: string }

function getSections(ageMonths: number): Section[] {
  return [
    { to: '/profile/growth', emoji: '📈', label: '生长曲线', desc: '身高、体重、头围的 WHO 百分位曲线', color: '#ede7fb' },
    ageMonths <= 72
      ? { to: '/profile/milestones', emoji: '🎯', label: '发育里程碑', desc: '追踪大运动、精细动作、语言等里程碑', color: '#fbe8d4' }
      : { to: '/profile/milestones', emoji: '📒', label: '早期发育记录', desc: '查看 0-6 岁发育里程碑的历史记录', color: '#fbe8d4' },
    { to: '/profile/vaccines', emoji: '💉', label: '疫苗记录', desc: '疫苗接种记录和接种计划', color: '#ddedfb' },
    { to: '/profile/vision', emoji: '👁️', label: '视力档案', desc: '验光单、眼轴单和视力变化趋势追踪', color: '#dde4f5' },
    { to: '/profile/dental', emoji: '🦷', label: '口腔发育', desc: '乳牙萌出、换牙和口腔检查记录', color: '#e2f0dc' },
    { to: '/profile/allergies', emoji: '🤧', label: '过敏记录', desc: '食物、药物和环境过敏原记录', color: '#f5dce8' },
    { to: '/profile/sleep', emoji: '😴', label: '睡眠记录', desc: '睡眠时长、作息规律和睡眠质量追踪', color: '#dde4f5' },
    { to: '/profile/medical-events', emoji: '🏥', label: '就医记录', desc: '门诊、住院、用药和检验报告', color: '#e5dcf5' },
    { to: '/profile/posture', emoji: '🧍', label: '体态档案', desc: '脊柱侧弯、足弓和身体姿态评估', color: '#e5f0dc' },
    ...(ageMonths >= 84 ? [{ to: '/profile/tanner', emoji: '🌱', label: '青春期发育', desc: 'Tanner 分期、骨龄和青春期发育追踪', color: '#e2f0dc' }] : []),
    { to: '/profile/fitness', emoji: '🏃', label: '体能测评', desc: '体能测试成绩和运动能力评估', color: '#fbe8d4' },
    { to: '/journal?filter=keepsake', emoji: '⭐', label: '高光时刻', desc: '珍藏的成长瞬间和重要里程碑', color: '#fef3c7' },
    { to: '/profile/report-upload', emoji: '🔍', label: '智能识别', desc: '上传医院报告，AI 自动提取数据生成记录', color: '#f4f7ea' },
  ];
}

/* ── helpers ─────────────────────────────────────────────── */

function latestByType(ms: MeasurementRow[]) {
  const m = new Map<string, MeasurementRow>();
  for (const r of ms) { const e = m.get(r.typeId); if (!e || r.measuredAt > e.measuredAt) m.set(r.typeId, r); }
  return m;
}

function pctComplete(child: { birthWeightKg: number | null; birthHeightCm: number | null; birthHeadCircCm: number | null; avatarPath: string | null; allergies: string[] | null; medicalNotes: string[] | null; recorderProfiles: Array<{ id: string; name: string }> | null }) {
  const f = [child.birthWeightKg, child.birthHeightCm, child.birthHeadCircCm, child.avatarPath, child.allergies, child.medicalNotes, child.recorderProfiles];
  return Math.round((f.filter((v) => v != null).length / f.length) * 100);
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function ProfilePage() {
  const activeChildId = useAppStore((s) => s.activeChildId);
  const children = useAppStore((s) => s.children);
  const activeChild = children.find((c) => c.childId === activeChildId);

  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [vaccineCount, setVaccineCount] = useState(0);
  const [milestoneCount, setMilestoneCount] = useState(0);
  const [sleepDays, setSleepDays] = useState(0);

  useEffect(() => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(() => {});
    getVaccineRecords(activeChildId).then((v) => setVaccineCount(v.length)).catch(() => {});
    getMilestoneRecords(activeChildId).then((m) => setMilestoneCount(m.filter((r) => r.achievedAt).length)).catch(() => {});
    getSleepRecords(activeChildId, 7).then((s) => setSleepDays(s.length)).catch(() => {});
  }, [activeChildId]);

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
  const sections = useMemo(() => getSections(ageMonths), [ageMonths]);
  const pct = pctComplete(activeChild);
  const latest = latestByType(measurements);
  const h = latest.get('height');
  const w = latest.get('weight');

  const quickStats = [
    { emoji: '📏', label: '身高', value: h ? `${h.value} cm` : '--' },
    { emoji: '⚖️', label: '体重', value: w ? `${w.value} kg` : '--' },
    { emoji: '💉', label: '疫苗', value: `${vaccineCount} 剂` },
    { emoji: '🎯', label: '里程碑', value: `${milestoneCount} 项` },
    { emoji: '😴', label: '近7天睡眠', value: sleepDays > 0 ? `${sleepDays}/7 天` : '--' },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 86 }}>

        {/* ── Profile header card ────────────────────────────── */}
        <div className="rounded-[18px] p-6 mb-6 relative overflow-hidden" style={{ background: '#86AFDA', boxShadow: C.shadow }}>
          <div className="flex items-center gap-5">
            {/* Avatar */}
            {activeChild.avatarPath ? (
              <img src={convertFileSrc(activeChild.avatarPath)} alt="" className="w-[72px] h-[72px] rounded-full object-cover border-[3px]" style={{ borderColor: 'rgba(255,255,255,0.5)' }} />
            ) : (
              <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center border-[3px]" style={{ background: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.5)' }}>
                <span className="text-2xl font-bold text-white">{activeChild.displayName.charAt(0)}</span>
              </div>
            )}
            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white">{activeChild.displayName}</h1>
              <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {ageY > 0 ? `${ageY}岁` : ''}{ageR > 0 ? `${ageR}个月` : ''} · {activeChild.gender === 'male' ? '男孩' : '女孩'} · 出生 {activeChild.birthDate}
              </p>
              {/* Profile completeness */}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.25)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#c8e64a' }} />
                </div>
                <span className="text-[10px] text-white/70">{pct}%</span>
              </div>
            </div>
            {/* Edit button */}
            <Link to="/settings/children" className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors hover:bg-white/30" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              编辑
            </Link>
          </div>
        </div>

        {/* ── Quick stats ────────────────────────────────────── */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {quickStats.map((s) => (
            <div key={s.label} className="rounded-[14px] p-3 text-center transition-colors hover:bg-[#f0f2ee]" style={{ background: C.card, boxShadow: C.shadow }}>
              <span className="text-[20px]">{s.emoji}</span>
              <p className="text-[14px] font-bold mt-1" style={{ color: C.text }}>{s.value}</p>
              <p className="text-[10px]" style={{ color: C.sub }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* ── Section grid ───────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-bold" style={{ color: C.text }}>健康档案</h2>
          <Link to="/profile/report-upload" className="group relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-medium text-white transition-all hover:opacity-90"
            style={{ background: C.accent, boxShadow: '0 2px 6px rgba(148,165,51,0.25)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M7 8h4M7 12h10M7 16h6" />
            </svg>
            智能识别
            <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-[10px] font-normal text-white opacity-0 transition-opacity group-hover:opacity-100 z-50"
              style={{ background: '#1a2b4a' }}>
              上传体检单，自动识别数据
            </span>
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {sections.map((s) => (
            <Link key={s.to} to={s.to}
              className="flex items-start gap-3 rounded-[14px] p-4 transition-all duration-200 hover:scale-[1.01] hover:shadow-md"
              style={{ background: C.card, boxShadow: C.shadow }}>
              <div className="w-[42px] h-[42px] rounded-[12px] flex items-center justify-center text-[20px] shrink-0" style={{ background: s.color }}>
                {s.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>{s.label}</h3>
                <p className="text-[11px] mt-0.5 leading-snug" style={{ color: C.sub }}>{s.desc}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-1"><path d="M9 18l6-6-6-6" /></svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
