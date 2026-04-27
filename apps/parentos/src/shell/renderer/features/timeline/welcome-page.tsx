import { Link } from 'react-router-dom';
import { AmbientBackground, Surface } from '@nimiplatform/nimi-kit/ui';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { ChildAvatar } from '../../shared/child-avatar.js';

/* ── data ───────────────────────────────────────────────── */

const BENTO = [
  {
    emoji: '🗂️',
    title: '构建全景健康档案',
    desc: '融合中国与 WHO 双重标准，一站式追踪生长曲线、视力、医疗等记录，构建全维度的数字健康档案。',
  },
  {
    emoji: '📝',
    title: '捕捉闪光瞬间',
    desc: '随手记录观察笔记。哪怕是一次无意的微笑或发音，都值得被 AI 智能归类与珍藏。',
  },
  {
    emoji: '🤖',
    title: '你的贴心育儿搭子',
    desc: 'AI 育儿顾问将基于宝贝的成长档案，提供个性化的发育提醒与科学建议。',
  },
] as const;

const TRUST = [
  { emoji: '🔒', label: '本地优先，数据隐私有保障' },
  { emoji: '🌍', label: '采用中国与 WHO 权威标准' },
] as const;

/* ── styles ──────────────────────────────────────────────── */

const textMain = '#1e293b';
const textMuted = '#475569';

/* ── component ───────────────────────────────────────────── */

export function WelcomePage() {
  const children = useAppStore((s) => s.children);
  const setActiveChildId = useAppStore((s) => s.setActiveChildId);
  const hasChildren = children.length > 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const hour = today.getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <AmbientBackground variant="mesh" className="relative flex h-full overflow-hidden">

      {/* ── main scrollable content ── */}
      <div
        className="relative min-w-0 flex-1 overflow-y-auto"
        style={{ paddingTop: S.topPad, paddingLeft: 60, paddingRight: 60, paddingBottom: 40 }}
      >
        <div className="flex flex-col gap-8">

          {/* ── header ── */}
          <header>
            <p className="text-[14px] font-medium tracking-wide" style={{ color: textMuted }}>{dateStr}</p>
            <h1 className="mt-2 text-[24px] font-semibold tracking-tight" style={{ color: textMain, letterSpacing: '-0.5px' }}>
              {greeting}，开启今天的育儿之旅。
            </h1>
          </header>

          {/* ── hero ── */}
          <Surface
            as="section"
            material="glass-thick"
            padding="none"
            tone="card"
            className="relative overflow-hidden p-12"
          >
            <div className="flex items-center justify-between">
              <div style={{ maxWidth: 420 }}>
                <h2 className="text-[24px] font-semibold" style={{ color: textMain }}>
                  {hasChildren ? '选择一个孩子开始' : '欢迎使用成长底稿'}
                </h2>
                <p className="mt-3 text-[16px] leading-relaxed" style={{ color: textMuted }}>
                  {hasChildren
                    ? '请选择一个孩子，查看个性化成长时间线'
                    : '这里是你的专属"成长底稿"。从第一笔身高体重，到每一次难忘的微笑，我们用科学与 AI 陪伴宝贝的每一步。'}
                </p>

                {hasChildren ? (
                  <div className="mt-8 flex flex-wrap gap-3">
                    {children.map((child) => {
                      const age = computeAgeMonths(child.birthDate);
                      const years = Math.floor(age / 12);
                      const months = age % 12;
                      const ageLabel = age < 12
                        ? `${age}个月`
                        : months > 0 ? `${years}岁${months}个月` : `${years}岁`;
                      return (
                        <button
                          key={child.childId}
                          type="button"
                          onClick={() => setActiveChildId(child.childId)}
                          className="flex items-center gap-3 rounded-full py-2 pl-2.5 pr-5 text-left transition-all hover:-translate-y-0.5"
                          style={{
                            background: '#fff',
                            color: textMain,
                            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                            border: '1px solid rgba(255,255,255,0.8)',
                          }}
                        >
                          <ChildAvatar child={child} ageMonths={age} className="h-9 w-9 shrink-0 rounded-full object-cover" />
                          <span>
                            <span className="block text-[14px] font-semibold">{child.displayName}</span>
                            <span className="block text-[13px]" style={{ color: textMuted }}>{ageLabel}</span>
                          </span>
                        </button>
                      );
                    })}
                    <Link
                      to="/settings/children"
                      className="flex items-center gap-2 rounded-full px-5 py-2 text-[14px] font-medium transition-colors hover:bg-black/5"
                      style={{ color: textMuted, border: '1.5px dashed #cbd5e1' }}
                    >
                      + 添加新孩子
                    </Link>
                  </div>
                ) : (
                  <Link
                    to="/settings/children"
                    className="mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[16px] font-medium text-white transition-all hover:-translate-y-0.5"
                    style={{
                      background: textMain,
                      boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
                    }}
                  >
                    建立宝贝专属档案
                    <span>→</span>
                  </Link>
                )}
              </div>

              {/* illustration */}
              <div
                className="hidden shrink-0 select-none lg:flex"
                style={{ fontSize: 80, gap: 16, filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.08))' }}
              >
                <span>👶</span><span>🌱</span>
              </div>
            </div>
          </Surface>

          {/* ── bento feature cards ── */}
          <section>
            <h2 className="mb-5 text-[18px] font-semibold" style={{ color: textMain }}>
              我们将这样陪伴你
            </h2>
            <div className="grid grid-cols-3 gap-6">
              {BENTO.map((item) => (
                <Surface
                  as="div"
                  key={item.title}
                  material="glass-regular"
                  padding="none"
                  tone="card"
                  className="p-7 transition-transform hover:-translate-y-1"
                >
                  <div
                    className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl text-[24px]"
                    style={{ background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}
                  >
                    {item.emoji}
                  </div>
                  <h3 className="text-[18px] font-semibold" style={{ color: textMain }}>{item.title}</h3>
                  <p className="mt-2.5 text-[16px] leading-relaxed" style={{ color: textMuted }}>{item.desc}</p>
                </Surface>
              ))}
            </div>
          </section>

          {/* ── trust badges ── */}
          <footer className="mt-auto flex gap-4 pt-2">
            {TRUST.map((t) => (
              <div
                key={t.label}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-[14px]"
                style={{
                  color: textMuted,
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.8)',
                }}
              >
                <span>{t.emoji}</span> {t.label}
              </div>
            ))}
          </footer>

        </div>
      </div>
    </AmbientBackground>
  );
}
