import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';
import { clearAuthSession as clearPersistedAuthSession } from '../../bridge/index.js';
import { seedMockData, type SeedProgress } from '../../infra/mock-seed.js';

/* ── design tokens (aligned with dashboard C) ──────────────── */

const C = {
  bg: '#f1f5f9', card: '#ffffff', text: '#1e293b', sub: '#475569',
  accent: '#1e293b', blue: '#BDE0F5', danger: '#e25555',
  shadow: '0 2px 12px rgba(0,0,0,0.06)', radius: 'rounded-[18px]',
} as const;

/* ── section definitions ───────────────────────────────────── */

const sections = [
  { to: '/settings/children', emoji: '👶', label: '孩子管理', desc: '添加、编辑、删除孩子档案', color: '#ddedfb' },
  { to: '/settings/nurture-mode', emoji: '🌱', label: '养育模式', desc: '轻松养 / 均衡养 / 进阶养，可按领域混合配置', color: '#e2f0dc' },
  { to: '/settings/reminders', emoji: '⏱️', label: '提醒管理', desc: '查看和管理已自定义频率的提醒', color: '#f5f0e6' },
  { to: '/settings/ai', emoji: '🤖', label: 'AI 模型设置', desc: '配置对话、语音转写等 AI 能力使用的模型', color: '#e8e0f5' },
];

const infoCards = [
  { emoji: '🔒', label: '数据与隐私', desc: '所有数据存储在本地，不上传至云端', color: '#f5f3ef' },
  { emoji: '📱', label: '关于', desc: '成长底稿 v0.1.0 · AI 驱动的儿童成长操作系统', color: '#f5f3ef' },
];

/* ================================================================
   SETTINGS PAGE
   ================================================================ */

export default function SettingsPage() {
  const authUser = useAppStore((s) => s.auth.user);
  const authStatus = useAppStore((s) => s.auth.status);
  const clearAuth = useAppStore((s) => s.clearAuthSession);
  const [loggingOut, setLoggingOut] = useState(false);
  const [seedStatus, setSeedStatus] = useState<'idle' | 'seeding' | 'done' | 'error'>('idle');
  const [seedLabel, setSeedLabel] = useState('');
  const [seedResult, setSeedResult] = useState('');

  const handleSeedMock = async () => {
    setSeedStatus('seeding');
    setSeedLabel('');
    setSeedResult('');
    const result = await seedMockData((p: SeedProgress) => {
      setSeedLabel(`${p.label} ${p.done}/${p.total}`);
    });
    setSeedStatus(result.ok ? 'done' : 'error');
    setSeedResult(result.summary);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await clearPersistedAuthSession();
    } catch {
      // best-effort clear
    }
    clearAuth();
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className="max-w-3xl mx-auto px-6 pb-6" style={{ paddingTop: 86 }}>

        {/* ── Header ─────────────────────────────────────── */}
        <h1 className="text-xl font-bold mb-6" style={{ color: C.text }}>设置</h1>

        {/* ── Account ────────────────────────────────────── */}
        {authStatus === 'authenticated' && authUser ? (
          <div
            className={`${C.radius} p-5 mb-6 flex items-center gap-4`}
            style={{ background: C.card, boxShadow: C.shadow }}
          >
            <div
              className="w-[46px] h-[46px] rounded-full flex items-center justify-center text-white text-[18px] font-semibold shrink-0"
              style={{ background: C.blue }}
            >
              {authUser.displayName?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] font-semibold truncate" style={{ color: C.text }}>
                {authUser.displayName || '未命名用户'}
              </h3>
              {authUser.email ? (
                <p className="text-[12px] mt-0.5 truncate" style={{ color: C.sub }}>{authUser.email}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="shrink-0 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
              style={{ color: C.danger, border: `1px solid ${C.danger}` }}
            >
              {loggingOut ? '退出中…' : '退出登录'}
            </button>
          </div>
        ) : null}

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

        {/* ── Dev tools (dev mode only) ─────────────────── */}
        {import.meta.env.DEV ? (
          <div className="mt-6">
            <p className="text-[12px] font-semibold mb-3" style={{ color: C.sub }}>Dev Tools</p>
            <div
              className={`${C.radius} p-5`}
              style={{ background: C.card, boxShadow: C.shadow }}
            >
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>
                    {seedStatus === 'seeding' ? `导入中… ${seedLabel}` : '导入测试数据'}
                  </h3>
                  <p className="text-[12px] mt-0.5 leading-snug" style={{ color: C.sub }}>
                    {seedStatus === 'done' ? seedResult
                      : seedStatus === 'error' ? seedResult
                      : '从 mock.json 导入 3 个孩子及全部测试数据到 SQLite'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSeedMock}
                  disabled={seedStatus === 'seeding'}
                  className="shrink-0 rounded-full px-4 py-1.5 text-[12px] font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: seedStatus === 'done' ? C.accent : seedStatus === 'error' ? C.danger : C.blue }}
                >
                  {seedStatus === 'seeding' ? '导入中…'
                    : seedStatus === 'done' ? '已完成'
                    : seedStatus === 'error' ? '重试'
                    : '导入'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
