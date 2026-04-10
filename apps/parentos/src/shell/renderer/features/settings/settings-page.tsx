import { Link } from 'react-router-dom';

/* ── design tokens (aligned with dashboard C) ──────────────── */

const C = {
  bg: '#E5ECEA', card: '#ffffff', text: '#1a2b4a', sub: '#8a8f9a',
  accent: '#94A533', blue: '#86AFDA',
  shadow: '0 2px 12px rgba(0,0,0,0.06)', radius: 'rounded-[18px]',
} as const;

/* ── section definitions ───────────────────────────────────── */

const sections = [
  { to: '/settings/children', emoji: '👶', label: '孩子管理', desc: '添加、编辑、删除孩子档案', color: '#ddedfb' },
  { to: '/settings/nurture-mode', emoji: '🌱', label: '养育模式', desc: '轻松养 / 均衡养 / 进阶养，可按领域混合配置', color: '#e2f0dc' },
  { to: '/settings/reminders', emoji: '⏱️', label: '提醒管理', desc: '查看和管理已自定义频率的提醒', color: '#f5f0e6' },
];

const infoCards = [
  { emoji: '🔒', label: '数据与隐私', desc: '所有数据存储在本地，不上传至云端', color: '#f5f3ef' },
  { emoji: '📱', label: '关于', desc: '成长底稿 v0.1.0 · AI 驱动的儿童成长操作系统', color: '#f5f3ef' },
];

/* ================================================================
   SETTINGS PAGE
   ================================================================ */

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 86 }}>

        {/* ── Header ─────────────────────────────────────── */}
        <h1 className="text-xl font-bold mb-6" style={{ color: C.text }}>设置</h1>

        {/* ── Main settings ──────────────────────────────── */}
        <div className="grid gap-3 mb-6">
          {sections.map((s) => (
            <Link key={s.to} to={s.to}
              className={`flex items-start gap-4 ${C.radius} p-5 transition-all duration-200 hover:scale-[1.01] hover:shadow-md`}
              style={{ background: C.card, boxShadow: C.shadow }}>
              <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center text-[22px] shrink-0" style={{ background: s.color }}>
                {s.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>{s.label}</h3>
                <p className="text-[12px] mt-0.5 leading-snug" style={{ color: C.sub }}>{s.desc}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sub} strokeWidth="2" strokeLinecap="round" className="shrink-0 mt-1.5"><path d="M9 18l6-6-6-6" /></svg>
            </Link>
          ))}
        </div>

        {/* ── Info cards ─────────────────────────────────── */}
        <p className="text-[12px] font-semibold mb-3" style={{ color: C.sub }}>其他</p>
        <div className="grid grid-cols-2 gap-3">
          {infoCards.map((c) => (
            <div key={c.label} className={`${C.radius} p-4`} style={{ background: C.card, boxShadow: C.shadow }}>
              <div className="w-[38px] h-[38px] rounded-[12px] flex items-center justify-center text-[18px] mb-3" style={{ background: c.color }}>
                {c.emoji}
              </div>
              <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>{c.label}</h3>
              <p className="text-[11px] mt-0.5 leading-snug" style={{ color: C.sub }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
