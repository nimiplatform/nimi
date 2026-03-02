import { useTranslation } from 'react-i18next';
import type { WorldDetailData, WorldAgent, WorldEvent } from './world-detail-template.js';
import { TimeFlowDynamics } from './time-flow-dynamics.js';

export type XianxiaWorldData = WorldDetailData & {
  subtitle?: string;
  quote?: string;
  narrative?: string;
};

export type XianxiaWorldTemplateProps = {
  world: XianxiaWorldData;
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

// Helper function: display data or show fallback
const displayValue = (value: unknown, fallback = 'N/A') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && isNaN(value)) return fallback;
  return String(value);
};

// Generate radar chart coordinates
function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const angle = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  const { t } = useTranslation();

  const world = props.world;
  const cx = 150;
  const cy = 150;
  const radius = 100;
  const levels = 5;

  // Score metadata with i18n - matching the reference image layout
  const scoreMeta = [
    {
      key: 'scoreA',
      label: 'Activity Score',
      short: t('WorldDetail.scoresShort'),
      desc: t('WorldDetail.scoresDesc'),
    },
    {
      key: 'scoreC',
      label: 'Consensus Score',
      short: t('WorldDetail.scoresShort'),
      desc: t('WorldDetail.scoresDesc'),
    },
    {
      key: 'scoreE',
      label: 'Engagement Score',
      short: t('WorldDetail.scoresShort'),
      desc: t('WorldDetail.scoresDesc'),
    },
    {
      key: 'scoreQ',
      label: 'Quality Score',
      short: t('WorldDetail.scoresShort'),
      desc: t('WorldDetail.scoresDesc'),
    },
    { key: 'scoreEwma', label: 'EWMA Score', short: 'EWMA', desc: t('WorldDetail.ewmaDesc') },
  ];

  const angleStep = 360 / scoreMeta.length;

  // Calculate radar chart data
  const metrics = scoreMeta.map((item) => ({
    ...item,
    value: world[item.key as keyof WorldDetailData] as number,
  }));

  const polygonPoints = metrics
    .map((m, i) => {
      const p = polarPoint(cx, cy, radius * (m.value / 100), i * angleStep);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const formatDateTime = (d: string) => {
    const date = new Date(d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  if (props.loading) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#4ECCA3]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
          <span className="text-sm text-[#e8f5ee]/60">{t('WorldDetail.loading')}</span>
        </div>
      </div>
    );
  }

  if (props.error || !world) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <span className="text-sm text-red-400">{t('WorldDetail.error')}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f0c] text-[#e8f5ee] font-sans relative overflow-x-hidden">
      {/* Global background - dark cultivation theme */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f16] via-[#0a0f0c] to-[#050705]" />
        {/* Stars */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle, #4ECCA3 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
          }}
        />
        {/* Glow effects */}
        <div
          className="absolute -top-20 -right-20 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(78,204,163,0.3), transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, rgba(78,204,163,0.2), transparent 70%)' }}
        />
      </div>

      <div className="relative z-10 w-[min(1400px,calc(100vw-48px))] mx-auto my-6 mb-16 flex flex-col gap-5">
        {/* Hero Banner - Reference Image Style */}
        <section className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/20 bg-[#0f1612]/80 backdrop-blur-sm">
          {/* Background image with overlay */}
          <div
            className="w-full h-[min(45vw,420px)] object-cover object-center block"
            style={{
              background: world.bannerUrl
                ? `linear-gradient(180deg, rgba(10,15,12,0.2) 0%, rgba(10,15,12,0.4) 50%, rgba(10,15,12,0.9) 100%), url(${world.bannerUrl}) center/cover no-repeat`
                : `linear-gradient(120deg, #0d1f16 0%, #0a1410 50%, #050a08 100%)`,
            }}
          />

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0f0c]" />

          {/* Hero content */}
          <div className="absolute inset-0 flex flex-col justify-between p-8">
            {/* Top badges */}
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wider uppercase bg-[#4ECCA3]/20 text-[#4ECCA3] border border-[#4ECCA3]/40 font-semibold">
                {displayValue(world.type, 'Unknown')} WORLD
              </span>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wider uppercase bg-[#4ECCA3]/10 text-[#4ECCA3] border border-[#4ECCA3]/30 font-semibold">
                {displayValue(world.status, 'Unknown')}
              </span>
            </div>

            {/* Bottom: icon + title */}
            <div className="flex items-start gap-6">
              {world.iconUrl ? (
                <img
                  src={world.iconUrl}
                  alt={world.name}
                  className="w-24 h-24 rounded-2xl object-cover border-2 border-[#4ECCA3]/30 shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-serif text-[#4ECCA3] border-2 border-[#4ECCA3]/30 bg-gradient-to-br from-[#4ECCA3]/20 to-transparent">
                  {world.name ? world.name.charAt(0) : '凡'}
                </div>
              )}
              <div className="flex-1">
                <h1
                  className="text-[clamp(28px,4vw,48px)] leading-tight font-serif tracking-wide text-white drop-shadow-lg"
                  style={{ fontFamily: '"Noto Serif SC", serif' }}
                >
                  {displayValue(world.name)}
                </h1>
                <p className="mt-2 text-base text-white/70 leading-relaxed max-w-2xl">
                  {displayValue(world.subtitle || world.description)}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Main Content Grid - 3 Columns */}
        <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-5">
          {/* Left Column - World Overview */}
          <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

            {/* Section Title */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-[#e8f5ee]/60">世界概览</span>
              <span className="text-sm text-[#e8f5ee]/40">/</span>
              <span className="text-sm text-[#4ECCA3]">World Overview</span>
            </div>

            {/* World Name */}
            <h3 className="text-xl font-bold text-[#e8f5ee] mb-2">{displayValue(world.name)}</h3>

            {/* ID Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 text-xs text-[#4ECCA3] mb-4 font-mono">
              ID: {world.id || 'N/A'}
            </div>

            {/* Description */}
            <div className="mb-4">
              <div className="text-xs text-[#e8f5ee]/40 mb-1">Description</div>
              <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                {displayValue(world.description)}
              </p>
            </div>

            {/* Narrative */}
            <div className="mb-4">
              <div className="text-xs text-[#e8f5ee]/40 mb-1">World Narrative</div>
              <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                {displayValue(world.narrative || world.description)}
              </p>
            </div>

            {/* Creation Date */}
            <div className="mb-4">
              <div className="text-xs text-[#e8f5ee]/40 mb-1">Creation Date</div>
              <div className="text-sm text-[#e8f5ee]">
                {world.createdAt ? formatDateTime(world.createdAt) : 'N/A'}
              </div>
            </div>

            {/* Agent Count */}
            <div className="mb-4">
              <div className="text-xs text-[#e8f5ee]/40 mb-2">Agent Count</div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold text-[#4ECCA3]">
                  {world.agentCount !== undefined ? world.agentCount : 'N/A'}
                </div>
                <div className="text-xs text-[#e8f5ee]/50">Agents in this world</div>
              </div>
            </div>

            {/* Time Flow Dynamics */}
            <div className="mb-4">
              <TimeFlowDynamics ratio={world.timeFlowRatio || 1.0} className="h-[200px]" />
            </div>

            {/* Quote */}
            <div className="p-4 rounded-xl bg-[#0a0f0c]/40 border border-[#4ECCA3]/10">
              <p className="text-sm text-[#e8f5ee]/80 leading-relaxed italic">
                {displayValue(world.quote, t('WorldDetail.xianxia.noData.quote'))}
              </p>
            </div>
          </section>

          {/* Middle Column - Scoring Matrix */}
          <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

            {/* Section Title */}
            <div className="text-center mb-4">
              <h2 className="text-lg font-medium text-[#e8f5ee]">World Scoring Matrix</h2>
            </div>

            {/* Radar Chart */}
            <div className="relative w-full aspect-square max-w-[320px] mx-auto">
              <svg viewBox="0 0 300 300" className="w-full h-full">
                <defs>
                  <linearGradient id="scoreStroke" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#4ECCA3" />
                    <stop offset="100%" stopColor="#3db892" />
                  </linearGradient>
                  <linearGradient id="scoreFill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="rgba(78,204,163,0.4)" />
                    <stop offset="100%" stopColor="rgba(61,184,146,0.1)" />
                  </linearGradient>
                </defs>

                {/* Background grid */}
                {Array.from({ length: levels }, (_, idx) => {
                  const r = radius * ((idx + 1) / levels);
                  const pts = metrics
                    .map((_, i) => {
                      const p = polarPoint(cx, cy, r, i * angleStep);
                      return `${p.x},${p.y}`;
                    })
                    .join(' ');
                  return (
                    <polygon
                      key={idx}
                      points={pts}
                      fill="none"
                      stroke="rgba(78,204,163,0.1)"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Axis lines */}
                {metrics.map((_, i) => {
                  const p = polarPoint(cx, cy, radius, i * angleStep);
                  return (
                    <line
                      key={i}
                      x1={cx}
                      y1={cy}
                      x2={p.x}
                      y2={p.y}
                      stroke="rgba(78,204,163,0.15)"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Data area */}
                <polygon
                  points={polygonPoints}
                  fill="url(#scoreFill)"
                  stroke="url(#scoreStroke)"
                  strokeWidth="2"
                />

                {/* Data points */}
                {metrics.map((m, i) => {
                  const p = polarPoint(cx, cy, radius * (m.value / 100), i * angleStep);
                  return (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r="4"
                      fill="#4ECCA3"
                      stroke="#0f1612"
                      strokeWidth="2"
                    />
                  );
                })}

                {/* Center point */}
                <circle cx={cx} cy={cy} r="4" fill="#4ECCA3" />
              </svg>

              {/* Labels positioned around the chart */}
              {metrics.map((m, i) => {
                const angle = i * angleStep;
                const labelRadius = radius + 35;
                const p = polarPoint(cx, cy, labelRadius, angle);
                const value =
                  m.value !== undefined && m.value !== null ? Number(m.value).toFixed(0) : '-';

                // Position adjustments based on angle
                let textAnchor: 'start' | 'middle' | 'end' = 'middle';
                let dx = 0;
                if (angle > 45 && angle < 135) textAnchor = 'start';
                if (angle > 225 && angle < 315) textAnchor = 'end';

                return (
                  <div
                    key={i}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 text-center"
                    style={{
                      left: `${(p.x / 300) * 100}%`,
                      top: `${(p.y / 300) * 100}%`,
                    }}
                  >
                    <div className="text-xs text-[#4ECCA3] font-medium">{m.short}</div>
                    <div className="text-lg font-bold text-[#4ECCA3]">{value}</div>
                  </div>
                );
              })}
            </div>

            {/* Bottom note */}
            <p className="text-center text-xs text-[#e8f5ee]/40 mt-4">
              {t('WorldDetail.xianxia.scores.chartNote')}
            </p>
          </section>

          {/* Right Column - Chronicle/Timeline */}
          <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

            {/* Section Title */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-sm text-[#e8f5ee]/60">事件编年</span>
              <span className="text-sm text-[#e8f5ee]/40">/</span>
              <span className="text-sm text-[#4ECCA3]">Chronicle</span>
            </div>

            {/* Timeline */}
            <div className="relative flex flex-col gap-4">
              {/* Timeline line */}
              <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />

              {props.events.length > 0 ? (
                props.events.slice(0, 5).map((event, idx) => (
                  <div key={event.id} className="relative pl-8">
                    {/* Timeline dot with icon */}
                    <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-[#0f1612] border-2 border-[#4ECCA3]/30 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-[#4ECCA3]" />
                    </div>

                    {/* Date */}
                    <div className="text-xs text-[#4ECCA3] tracking-wider mb-1">
                      {event.time ? formatDateTime(event.time) : 'N/A'}
                    </div>

                    {/* Content */}
                    <div className="p-3 rounded-xl bg-[#0a0f0c]/40 border border-[#4ECCA3]/10">
                      <h4 className="text-sm font-bold text-[#e8f5ee] mb-1">
                        {displayValue(event.title)}
                      </h4>
                      <p className="text-xs text-[#e8f5ee]/50 leading-relaxed line-clamp-3">
                        {displayValue(event.description)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="pl-8 p-4 text-center text-[#e8f5ee]/50 text-sm">
                  {t('WorldDetail.xianxia.timeline.noData')}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Bottom Section - Agent Directory */}
        <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

          {/* Section Title */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-sm text-[#e8f5ee]/60">智能体名录</span>
            <span className="text-sm text-[#e8f5ee]/40">/</span>
            <span className="text-sm text-[#4ECCA3]">Interactive Agent Directory</span>
          </div>

          {/* Agent Grid - 3 columns */}
          <div className="grid grid-cols-3 gap-4">
            {props.agents.length > 0 ? (
              props.agents.slice(0, 6).map((agent) => (
                <article
                  key={agent.id}
                  className="relative p-4 rounded-xl bg-[#0a0f0c]/60 border border-[#4ECCA3]/10 overflow-hidden"
                >
                  {/* Avatar */}
                  <div className="flex items-start gap-3 mb-3">
                    {agent.avatarUrl ? (
                      <img
                        src={agent.avatarUrl}
                        alt={agent.name}
                        className="w-16 h-16 rounded-xl object-cover border border-[#4ECCA3]/20"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-serif text-[#4ECCA3] border border-[#4ECCA3]/20 bg-gradient-to-br from-[#4ECCA3]/10 to-transparent">
                        {agent.name ? agent.name.charAt(0) : '修'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-bold text-[#e8f5ee] truncate">
                          {displayValue(agent.name)}
                        </h4>
                        <div
                          className="w-2 h-2 rounded-full bg-[#4ECCA3] flex-shrink-0"
                          title="Online"
                        />
                      </div>
                      <div className="text-xs text-[#4ECCA3] truncate">
                        {displayValue(agent.handle)}
                      </div>
                    </div>
                  </div>

                  {/* Bio */}
                  <p className="text-xs text-[#e8f5ee]/60 leading-relaxed mb-3 line-clamp-2">
                    {displayValue(agent.bio, t('WorldDetail.xianxia.noData.bio'))}
                  </p>

                  {/* Created date */}
                  <div className="text-xs text-[#e8f5ee]/40 mb-3">
                    Created: {agent.createdAt ? formatDateTime(agent.createdAt) : 'N/A'}
                  </div>

                  {/* Buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => props.onChatAgent?.(agent)}
                      className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 rounded-lg text-xs font-medium text-[#e8f5ee] bg-[#0f1612] border border-[#4ECCA3]/30 hover:border-[#4ECCA3] hover:text-[#4ECCA3] transition-all"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      Chat
                    </button>
                    <button
                      onClick={() => props.onVoiceAgent?.(agent)}
                      className="flex items-center justify-center gap-1.5 flex-1 px-3 py-2 rounded-lg text-xs font-medium text-[#0f1612] bg-gradient-to-r from-[#4ECCA3] to-[#3db892] hover:shadow-lg transition-all"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                      Add
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="col-span-3 py-16 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 mb-4 rounded-full bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 flex items-center justify-center">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4ECCA3"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <p className="text-[#e8f5ee]/60 text-sm">
                  {t('WorldDetail.xianxia.agents.noData')}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
