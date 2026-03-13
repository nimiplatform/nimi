import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';

// World 数据类型定义（与 WorldDetailDto 对应）
export type WorldDetailData = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: 'OASIS' | 'CREATOR';
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  level: number;
  levelUpdatedAt: string | null;
  agentCount: number;
  createdAt: string;
  creatorId: string | null;
  freezeReason: 'QUOTA_OVERFLOW' | 'WORLD_INACTIVE' | 'GOVERNANCE_LOCK' | null;
  lorebookEntryLimit: number;
  nativeAgentLimit: number;
  nativeCreationState: 'OPEN' | 'NATIVE_CREATION_FROZEN';
  scoreA: number;  // Activity Score
  scoreC: number;  // Consensus Score
  scoreE: number;  // Engagement Score
  scoreEwma: number; // Exponentially Weighted Moving Average
  scoreQ: number;  // Quality Score
  timeFlowRatio: number;
  transitInLimit: number;
  genre?: string | null;
  era?: string | null;
  themes?: string[] | null;
  clockConfig?: Record<string, unknown> | null;
  sceneTimeConfig?: Record<string, unknown> | null;
};

// 智能体数据类型
export type WorldAgent = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  avatarUrl?: string | null;
  createdAt: string;
};

// 事件数据类型
export type WorldEvent = {
  id: string;
  timelineSeq: number;
  time: string;
  title: string;
  tag: string;
  description: string;
};

// World 详情页 Props
export type WorldDetailTemplateProps = {
  world: WorldDetailData;
  agents: WorldAgent[];
  events: WorldEvent[];
  loading?: boolean;
  error?: boolean;
  onBack?: () => void;
  onEnterEdit?: () => void;
  onCreateSubWorld?: () => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
};

// 主题配置
const themes = {
  xianxia: { label: '仙侠', icon: '仙', primary: '#2d9e68', gradient: 'from-[#1F7A53] to-[#7BD89F]' },
  scifi: { label: '科幻', icon: '科', primary: '#169b72', gradient: 'from-[#0E7D5C] to-[#69E0B0]' },
  urban: { label: '都市', icon: '都', primary: '#34a96d', gradient: 'from-[#2B8B57] to-[#9BE0B6]' },
  anime: { label: '二次元', icon: '次', primary: '#27a364', gradient: 'from-[#21915D] to-[#7BE0A8]' },
};

type ThemeKey = keyof typeof themes;

// 状态标签样式
const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: 'bg-green-100', text: 'text-green-700', label: '运行中' },
  DRAFT: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '草稿' },
  PENDING_REVIEW: { bg: 'bg-blue-100', text: 'text-blue-700', label: '审核中' },
  SUSPENDED: { bg: 'bg-red-100', text: 'text-red-700', label: '已暂停' },
  ARCHIVED: { bg: 'bg-gray-100', text: 'text-gray-600', label: '已归档' },
};

// 冻结原因标签
const freezeReasonLabels: Record<string, string> = {
  QUOTA_OVERFLOW: '配额超限',
  WORLD_INACTIVE: '世界不活跃',
  GOVERNANCE_LOCK: '治理锁定',
};

// 创建状态标签
const creationStateLabels: Record<string, { label: string; color: string }> = {
  OPEN: { label: '开放', color: 'bg-green-100 text-green-700' },
  NATIVE_CREATION_FROZEN: { label: '冻结', color: 'bg-orange-100 text-orange-700' },
};

// 字段定义配置
const fieldDefinitions = [
  { key: 'id', title: '世界唯一标识符', format: (v: string) => v },
  { key: 'name', title: '世界名称', format: (v: string) => v },
  { key: 'description', title: '世界描述', format: (v: string | null) => v || '暂无描述' },
  { key: 'type', title: '世界类型', format: (v: string) => v === 'OASIS' ? 'OASIS · 主世界' : 'CREATOR · 子世界' },
  { key: 'status', title: '世界状态', format: (v: string) => v },
  { key: 'freezeReason', title: '冻结原因', format: (v: string | null) => v ? `${v} · ${freezeReasonLabels[v]}` : null },
  { key: 'nativeCreationState', title: '创建状态', format: (v: string) => v },
  { key: 'level', title: '世界等级', format: (v: number) => `Lv.${v}` },
  { key: 'agentCount', title: '智能体数量', format: (v: number) => `${v} 个 Agent` },
  { key: 'nativeAgentLimit', title: '原生限制', format: (v: number) => `${v}` },
  { key: 'lorebookEntryLimit', title: '知识库限制', format: (v: number) => `${v}` },
  { key: 'timeFlowRatio', title: '时间流速', format: (v: number) => `${v.toFixed(1)}x` },
  { key: 'transitInLimit', title: '转入限制', format: (v: number) => `${v}` },
  { key: 'createdAt', title: '创建时间', format: (v: string) => new Date(v).toLocaleString('zh-CN') },
  { key: 'creatorId', title: '创建者', format: (v: string | null) => v || '未知' },
] as const;

// 评分指标定义
const scoreDefinitions = [
  { key: 'scoreA', name: 'Activity Score', desc: '活跃度评分', color: 'bg-blue-50 text-blue-600' },
  { key: 'scoreC', name: 'Consensus Score', desc: '共识度评分', color: 'bg-purple-50 text-purple-600' },
  { key: 'scoreE', name: 'Engagement Score', desc: '参与度评分', color: 'bg-green-50 text-green-600' },
  { key: 'scoreQ', name: 'Quality Score', desc: '质量评分', color: 'bg-orange-50 text-orange-600' },
] as const;

export function WorldDetailTemplate(props: WorldDetailTemplateProps) {
  const { t } = useTranslation();
  const [activeTheme, setActiveTheme] = useState<ThemeKey>('xianxia');
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  const theme = themes[activeTheme];
  const statusStyle = statusStyles[props.world.status] || statusStyles.DRAFT;
  const creationState = creationStateLabels[props.world.nativeCreationState] || creationStateLabels.OPEN;

  const getAgentPalette = (agent: WorldAgent) => getSemanticAgentPalette({
    description: agent.bio || props.world.description,
    worldName: props.world.name,
    tags: props.world.themes || undefined,
  });

  // 格式化 EWMA 仪表盘角度
  const ewmaDegree = useMemo(() => {
    return Math.round((props.world.scoreEwma / 100) * 360);
  }, [props.world.scoreEwma]);

  if (props.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fffa] via-[#f0fcf5] to-[#fbfffd] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#4ECCA3]" />
          <span className="text-sm">{t('WorldDetail.loading')}</span>
        </div>
      </div>
    );
  }

  if (props.error || !props.world) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fffa] via-[#f0fcf5] to-[#fbfffd] flex items-center justify-center">
        <span className="text-sm text-red-600">{t('WorldDetail.error')}</span>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen text-[#173422] relative overflow-x-hidden"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(120, 219, 164, 0.18), transparent 28%),
          radial-gradient(circle at 95% 10%, rgba(56, 196, 134, 0.12), transparent 24%),
          linear-gradient(180deg, #f7fffa 0%, #f0fcf5 48%, #fbfffd 100%)
        `,
      }}
    >
      {/* 背景装饰 */}
      <div className="fixed -left-[120px] bottom-[12vh] w-[360px] h-[360px] rounded-full blur-xl opacity-70 pointer-events-none z-0"
        style={{ background: 'radial-gradient(circle, rgba(127, 215, 168, 0.18), transparent 65%)' }} />
      <div className="fixed -right-[100px] top-[12vh] w-[360px] h-[360px] rounded-full blur-xl opacity-70 pointer-events-none z-0"
        style={{ background: 'radial-gradient(circle, rgba(47, 163, 106, 0.12), transparent 65%)' }} />

      <div className="relative z-10 w-full max-w-[1240px] mx-auto px-5 py-6">
        {/* 顶部导航栏 */}
        <header className="flex items-center justify-between gap-5 mb-5 py-2">
          <div className="flex items-center gap-3.5 min-w-0">
            <div 
              className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-extrabold text-xl shadow-lg shrink-0"
              style={{ background: `linear-gradient(135deg, ${theme.primary}, #7fd7a8)` }}
            >
              W
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold tracking-wide">
                {t('WorldDetail.studioTitle', { defaultValue: 'World Studio' })}
              </div>
              <div className="text-[13px] text-[#5f7a69] mt-0.5">{t('WorldDetail.subtitle')}</div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-2.5 flex-wrap justify-center">
            {['overview', 'scores', 'agents', 'timeline'].map((section) => (
              <a
                key={section}
                href={`#${section}`}
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-[#5f7a69] hover:text-[#17784a] hover:bg-white/60 transition-all"
              >
                {t(`WorldDetail.section.${section}`)}
              </a>
            ))}
          </nav>

          <div className="flex gap-2.5 items-center">
            <button
              onClick={props.onCreateSubWorld}
              className="px-4 py-2.5 rounded-full text-sm font-bold text-[#17784a] bg-white/70 border border-[rgba(47,163,106,0.1)] backdrop-blur-sm hover:-translate-y-0.5 transition-transform"
            >
              {t('WorldDetail.createSubWorld')}
            </button>
            <button
              onClick={props.onEnterEdit}
              className="px-4 py-2.5 rounded-full text-sm font-bold text-white shadow-lg hover:-translate-y-0.5 transition-transform"
              style={{ background: `linear-gradient(135deg, ${theme.primary}, #50c281)`, boxShadow: '0 10px 22px rgba(47, 163, 106, 0.20)' }}
            >
              {t('WorldDetail.enterEdit')}
            </button>
          </div>
        </header>

        {/* Hero Banner - 新版设计 */}
        <section className="relative rounded-[32px] overflow-hidden mb-6 shadow-2xl isolation-auto"
          style={{
            background: `
              linear-gradient(135deg, rgba(47, 163, 106, 0.9) 0%, rgba(127, 215, 168, 0.85) 50%, rgba(78, 204, 163, 0.8) 100%)
            `,
          }}
        >
          {/* 背景装饰 */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {/* 光晕效果 */}
            <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-30"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)' }} />
            <div className="absolute -bottom-40 -left-20 w-96 h-96 rounded-full opacity-20"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)' }} />
            {/* 网格纹理 */}
            <div className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
                backgroundSize: '50px 50px',
              }}
            />
          </div>

          {/* Banner 内容 */}
          <div className="relative z-10 p-8 md:p-10">
            {/* 右上角更多选项按钮 */}
            <div className="absolute top-6 right-6 md:top-8 md:right-8 z-20">
              <button
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-all"
                title={t('WorldDetail.moreOptions')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="6" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="18" r="2" />
                </svg>
              </button>
              
              {/* 主题选择下拉菜单 */}
              {showThemeMenu && (
                <>
                  {/* 点击外部关闭 */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowThemeMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 z-50">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-gray-800">{t('WorldDetail.themeSwitch')}</span>
                      <span className="text-xs text-gray-400">{t('WorldDetail.keepGreenTone')}</span>
                    </div>
                    <div className="space-y-1">
                      {(Object.keys(themes) as ThemeKey[]).map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            setActiveTheme(key);
                            setShowThemeMenu(false);
                          }}
                          className={`w-full px-3 py-2.5 rounded-xl text-sm font-bold text-left transition-all flex items-center gap-2 ${
                            activeTheme === key 
                              ? 'bg-[#e8f9ef] text-[#17784a]' 
                              : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span 
                            className="w-3 h-3 rounded-full"
                            style={{ background: themes[key].primary }}
                          />
                          {themes[key].label}
                          {activeTheme === key && (
                            <svg className="ml-auto w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 顶部标签栏 */}
            <div className="flex flex-wrap items-center gap-2.5 mb-6">
              <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-wider uppercase bg-white/15 text-white border border-white/20 backdrop-blur-sm">
                {props.world.type === 'OASIS' ? 'Main World' : 'Sub World'}
              </span>
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider border backdrop-blur-sm ${statusStyle!.bg} ${statusStyle!.text}`}>
                {props.world.status}
              </span>
              <span className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wider border backdrop-blur-sm ${creationState!.color}`}>
                Native · {creationState!.label}
              </span>
              {props.world.freezeReason && (
                <span className="px-4 py-1.5 rounded-full text-xs font-bold tracking-wider bg-red-500/80 text-white border border-red-400/50 backdrop-blur-sm">
                  {freezeReasonLabels[props.world.freezeReason]}
                </span>
              )}
            </div>

            {/* 主体内容区 */}
            <div className="flex flex-col lg:flex-row gap-8 items-start">
              {/* 左侧：图标 + 标题 + 描述 */}
              <div className="flex gap-5 items-start flex-1 min-w-0">
                {/* 世界图标 - 圆形带边框 */}
                {props.world.iconUrl ? (
                  <img 
                    src={props.world.iconUrl} 
                    alt={props.world.name}
                    className="w-20 h-20 md:w-24 md:h-24 rounded-[28px] object-cover border-2 border-white/40 shadow-2xl shrink-0 bg-white/10 backdrop-blur-sm" 
                  />
                ) : (
                  <div 
                    className="w-20 h-20 md:w-24 md:h-24 rounded-[28px] flex items-center justify-center text-3xl font-bold text-white border-2 border-white/40 shadow-2xl shrink-0"
                    style={{ background: 'rgba(255,255,255,0.15)' }}
                  >
                    {props.world.name.charAt(0).toUpperCase()}
                  </div>
                )}
                
                <div className="min-w-0 flex-1">
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3 leading-tight tracking-tight drop-shadow-sm">
                    {props.world.name}
                  </h1>
                  <p className="text-[15px] leading-7 text-white/85 max-w-2xl">
                    {props.world.description || t('WorldDetail.noDescription')}
                  </p>
                </div>
              </div>

            </div>

            {/* 底部统计卡片 - 横向4列 */}
            <div className="mt-6 pt-6 border-t border-white/15">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 等级 */}
                <div className="bg-black/20 rounded-2xl p-4 border border-white/10 backdrop-blur-sm">
                  <div className="text-xs text-white/60 mb-2 font-medium">{t('WorldDetail.level')}</div>
                  <div className="text-2xl font-bold text-white">Lv.{props.world.level}</div>
                </div>
                {/* 时间流速 */}
                <div className="bg-black/20 rounded-2xl p-4 border border-white/10 backdrop-blur-sm">
                  <div className="text-xs text-white/60 mb-2 font-medium">{t('WorldDetail.timeFlow')}</div>
                  <div className="text-2xl font-bold text-white">{props.world.timeFlowRatio.toFixed(1)}×</div>
                </div>
                {/* 智能体数量 */}
                <div className="bg-black/20 rounded-2xl p-4 border border-white/10 backdrop-blur-sm">
                  <div className="text-xs text-white/60 mb-2 font-medium">{t('WorldDetail.agents')}</div>
                  <div className="text-2xl font-bold text-white">{props.world.agentCount}</div>
                </div>
                {/* 最后更新 */}
                <div className="bg-black/20 rounded-2xl p-4 border border-white/10 backdrop-blur-sm">
                  <div className="text-xs text-white/60 mb-2 font-medium">{t('WorldDetail.lastUpdated')}</div>
                  <div className="text-lg font-bold text-white">
                    {props.world.levelUpdatedAt 
                      ? new Date(props.world.levelUpdatedAt).toLocaleDateString('zh-CN')
                      : new Date(props.world.createdAt).toLocaleDateString('zh-CN')
                    }
                  </div>
                </div>
              </div>
              
              {/* 底部信息标签 */}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/80 border border-white/10">
                  ID · {props.world.id.length > 20 ? props.world.id.slice(0, 16) + '...' : props.world.id}
                </span>
                {props.world.creatorId && (
                  <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/80 border border-white/10">
                    CREATOR · {props.world.creatorId.length > 16 ? props.world.creatorId.slice(0, 12) + '...' : props.world.creatorId}
                  </span>
                )}
                <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/80 border border-white/10">
                  TIME FLOW × {props.world.timeFlowRatio.toFixed(1)}
                </span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 text-white/80 border border-white/10">
                  LEVEL · Lv.{props.world.level}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 两栏内容区 */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-5 mb-5">
          {/* 左侧：World 介绍 */}
          <section id="overview" className="bg-white/75 border border-[rgba(47,163,106,0.12)] rounded-3xl shadow-xl backdrop-blur-md p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{t('WorldDetail.overview')}</h2>
                <p className="text-sm text-[#5f7a69] mt-1.5 leading-relaxed">{t('WorldDetail.overviewDesc')}</p>
              </div>
              <span className="px-3 py-2 rounded-full text-sm font-bold bg-[#e8f9ef] text-[#17784a] whitespace-nowrap">
                {t('WorldDetail.templateArea')}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-3.5">
              {fieldDefinitions.map(({ key, title, format }) => {
                const value = props.world[key as keyof WorldDetailData];
                const formatted = format(value as never);
                if (formatted === null) return null;
                
                return (
                  <div key={key} className="p-4 rounded-2xl bg-white/95 border border-[rgba(47,163,106,0.12)] min-w-0">
                    <div className="inline-flex items-center gap-2 text-xs text-[#5f7a69] font-bold tracking-wide mb-2.5">
                      <code className="px-1.5 py-1 rounded-lg bg-[#e8f9ef] text-[#17784a] font-mono text-[11px]">
                        {key}
                      </code>
                      <span className="truncate">{title}</span>
                    </div>
                    <div className={`text-[15px] font-bold break-words ${
                      key === 'description' ? 'text-[#274534] leading-7 font-semibold' : ''
                    }`}>
                      {formatted}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 右侧：评分指标 */}
          <section id="scores" className="bg-white/75 border border-[rgba(47,163,106,0.12)] rounded-3xl shadow-xl backdrop-blur-md p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{t('WorldDetail.scores')}</h2>
                <p className="text-sm text-[#5f7a69] mt-1.5 leading-relaxed">{t('WorldDetail.scoresDesc')}</p>
              </div>
            </div>

            {/* 各项评分 */}
            <div className="space-y-3.5 mb-4">
              {scoreDefinitions.map((score) => {
                const value = props.world[score.key as keyof WorldDetailData] as number;
                return (
                  <div key={score.key} className="p-4 rounded-2xl bg-white/95 border border-[rgba(47,163,106,0.12)]">
                    <div className="flex items-center justify-between gap-3.5 mb-3">
                      <div>
                        <strong className="text-[15px] tracking-tight">{score.name}</strong>
                        <span className="block text-xs text-[#5f7a69] mt-1">{score.desc}</span>
                      </div>
                      <div className="text-2xl font-extrabold text-[#17784a] whitespace-nowrap tracking-tight">
                        {value}
                      </div>
                    </div>
                    {/* 进度条 */}
                    <div className="relative h-2.5 rounded-full bg-[#e7f5ec] overflow-hidden">
                      <div 
                        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                        style={{ 
                          width: `${value}%`,
                          background: 'linear-gradient(90deg, #2fa36a, #6bd19a)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* EWMA 综合趋势 */}
            <div 
              className="grid grid-cols-[108px_1fr] gap-4 items-center p-4 rounded-3xl border"
              style={{ 
                background: 'radial-gradient(circle at top right, rgba(127, 215, 168, 0.22), transparent 40%), linear-gradient(135deg, #ffffff, #e8f9ef)',
                borderColor: 'rgba(47, 163, 106, 0.18)',
              }}
            >
              {/* 仪表盘 */}
              <div 
                className="w-28 h-28 rounded-full grid place-items-center shadow-inner"
                style={{
                  background: `
                    radial-gradient(closest-side, white 77%, transparent 79% 100%),
                    conic-gradient(${theme.primary} 0deg ${ewmaDegree}deg, rgba(47, 163, 106, 0.14) ${ewmaDegree}deg 360deg)
                  `,
                  boxShadow: 'inset 0 0 0 1px rgba(47, 163, 106, 0.08)',
                }}
              >
                <strong className="text-[28px] text-[#17784a] tracking-tighter">{props.world.scoreEwma}</strong>
              </div>
              <div>
                <h3 className="text-lg font-bold">scoreEwma {t('WorldDetail.ewmaTitle')}</h3>
                <p className="text-sm text-[#5f7a69] mt-2 leading-7">
                  scoreEwma = {props.world.scoreEwma}，{t('WorldDetail.ewmaDesc')}
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* 智能体列表 */}
        <section id="agents" className="bg-white/75 border border-[rgba(47,163,106,0.12)] rounded-3xl shadow-xl backdrop-blur-md p-6 mb-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{t('WorldDetail.agentsList')}</h2>
              <p className="text-sm text-[#5f7a69] mt-1.5 leading-relaxed">{t('WorldDetail.agentsDesc')}</p>
            </div>
            <span className="px-3 py-2 rounded-full text-sm font-bold bg-[#e8f9ef] text-[#17784a]">
              {props.agents.length} {t('WorldDetail.agentCards')}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {props.agents.map((agent) => (
              <article 
                key={agent.id}
                className="relative overflow-hidden rounded-3xl border border-[rgba(47,163,106,0.12)] bg-white/95 p-5"
              >
                {/* 底部装饰渐变 */}
                <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[rgba(47,163,106,0.04)] to-transparent pointer-events-none" />
                
                <div className="relative z-10 mb-3.5 flex items-center gap-3.5">
                  <EntityAvatar
                    imageUrl={agent.avatarUrl}
                    name={agent.name}
                    kind="agent"
                    sizeClassName="h-13 w-13"
                    radiusClassName="rounded-[10px]"
                    innerRadiusClassName="rounded-[8px]"
                    textClassName="text-lg font-extrabold"
                  />
                  <div className="min-w-0">
                    <strong className="block text-base tracking-tight truncate">{agent.name}</strong>
                    <span
                      className="mt-1 block truncate text-[13px] font-semibold"
                      style={{ color: getAgentPalette(agent).accent }}
                    >
                      {agent.handle}
                    </span>
                  </div>
                </div>

                <p className="relative z-10 text-sm leading-7 text-[#355042] mb-3.5 line-clamp-3 min-h-[74px]">
                  {agent.bio}
                </p>

                <div className="relative z-10 flex flex-wrap gap-2 mb-4">
                  <span className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-[#e8f9ef] text-[#17784a]">
                    {t('WorldDetail.createdAt')} {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>

                <div className="relative z-10 flex gap-2.5">
                  <button
                    onClick={() => props.onChatAgent?.(agent)}
                    className="px-3 py-2.5 rounded-xl text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
                    style={{ 
                      background: `linear-gradient(135deg, ${theme.primary}, #59c887)`,
                      boxShadow: '0 10px 20px rgba(47, 163, 106, 0.18)',
                    }}
                  >
                    {t('WorldDetail.startChat')}
                  </button>
                  <button
                    onClick={() => props.onVoiceAgent?.(agent)}
                    className="px-3 py-2.5 rounded-xl text-sm font-bold text-[#17784a] bg-[#e8f9ef] transition-transform hover:-translate-y-0.5"
                  >
                    {t('WorldDetail.voiceInteraction')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 大事件时间轴 */}
        <section id="timeline" className="bg-white/75 border border-[rgba(47,163,106,0.12)] rounded-3xl shadow-xl backdrop-blur-md p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{t('WorldDetail.timeline')}</h2>
              <p className="text-sm text-[#5f7a69] mt-1.5 leading-relaxed">{t('WorldDetail.timelineDesc')}</p>
            </div>
            <span className="px-3 py-2 rounded-full text-sm font-bold bg-[#e8f9ef] text-[#17784a]">
              Timeline · {t('WorldDetail.oldestToLatest')}
            </span>
          </div>

          <div className="relative pl-4">
            {/* 时间轴线 */}
            <div 
              className="absolute left-[15px] top-1 bottom-1 w-0.5 rounded-full"
              style={{ background: 'linear-gradient(180deg, rgba(47, 163, 106, 0.18), rgba(47, 163, 106, 0.05))' }}
            />

            {props.events
              .map((event, _index) => (
                <div key={event.id} className="relative pl-7 mb-4 last:mb-0">
                  {/* 时间点标记 */}
                  <div
                    className="absolute left-1 top-3 w-5.5 h-5.5 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${theme.primary}, #7fd7a8)`,
                      boxShadow: '0 0 0 6px rgba(47, 163, 106, 0.08)',
                    }}
                  />

                  <div className="p-4.5 rounded-3xl bg-white/95 border border-[rgba(47,163,106,0.12)]">
                    <div className="font-mono text-xs text-[#17784a] font-extrabold tracking-wide mb-2.5">
                      {(() => { const d = new Date(event.time); return Number.isNaN(d.getTime()) ? event.time : d.toLocaleString('zh-CN'); })()}
                    </div>
                    <div className="flex items-start justify-between gap-3 mb-2.5">
                      <h3 className="text-base font-bold tracking-tight">{event.title}</h3>
                      <span className="px-2.5 py-1.5 rounded-full text-xs font-bold bg-[#e8f9ef] text-[#17784a]">
                        {event.tag}
                      </span>
                    </div>
                    <p className="text-sm leading-7 text-[#395548]">{event.description}</p>
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* 页脚 */}
        <div className="mt-5 text-center text-sm text-[#5f7a69] leading-7">
          {t('WorldDetail.footerNote')}
        </div>
      </div>
    </div>
  );
}
