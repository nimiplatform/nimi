import { useTranslation } from 'react-i18next';
import type { WorldDetailData, WorldAgent, WorldEvent } from './world-detail-template';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';

// CSS Keyframes for status-based glow effects
const statusGlowStyles = `
  @keyframes breathing-glow-active {
    0%, 100% {
      box-shadow: 0 0 20px 4px rgba(78, 204, 163, 0.3), 0 0 40px 8px rgba(78, 204, 163, 0.15);
      transform: scale(1);
    }
    50% {
      box-shadow: 0 0 30px 8px rgba(78, 204, 163, 0.5), 0 0 60px 16px rgba(78, 204, 163, 0.25);
      transform: scale(1.05);
    }
  }

  @keyframes breathing-glow-draft {
    0%, 100% {
      box-shadow: 0 0 15px 2px rgba(148, 163, 184, 0.2), 0 0 30px 6px rgba(148, 163, 184, 0.1);
    }
    50% {
      box-shadow: 0 0 20px 4px rgba(148, 163, 184, 0.3), 0 0 40px 10px rgba(148, 163, 184, 0.15);
    }
  }

  @keyframes breathing-glow-pending {
    0%, 100% {
      box-shadow: 0 0 20px 4px rgba(234, 179, 8, 0.3), 0 0 40px 8px rgba(234, 179, 8, 0.15);
      opacity: 0.7;
    }
    50% {
      box-shadow: 0 0 30px 8px rgba(234, 179, 8, 0.5), 0 0 60px 16px rgba(234, 179, 8, 0.25);
      opacity: 1;
    }
  }

  @keyframes breathing-glow-suspended {
    0%, 100% {
      box-shadow: 0 0 25px 6px rgba(239, 68, 68, 0.4), 0 0 50px 12px rgba(239, 68, 68, 0.2);
    }
    50% {
      box-shadow: 0 0 35px 10px rgba(239, 68, 68, 0.6), 0 0 70px 20px rgba(239, 68, 68, 0.3);
    }
  }

  @keyframes breathing-glow-archived {
    0%, 100% {
      box-shadow: 0 0 10px 2px rgba(107, 114, 128, 0.15), 0 0 20px 4px rgba(107, 114, 128, 0.08);
      opacity: 0.5;
    }
    50% {
      box-shadow: 0 0 15px 4px rgba(107, 114, 128, 0.2), 0 0 30px 8px rgba(107, 114, 128, 0.12);
      opacity: 0.7;
    }
  }
`;

// Helper function to get status-based glow styles
function getStatusGlowConfig(status: string) {
  switch (status) {
    case 'ACTIVE':
      return {
        animation: 'breathing-glow-active 3s ease-in-out infinite',
        boxShadow: '0 0 20px 4px rgba(78, 204, 163, 0.4), 0 0 40px 8px rgba(78, 204, 163, 0.2)',
        borderColor: 'border-[#4ECCA3]/30',
        textColor: 'text-[#4ECCA3]',
        bgGradient: 'from-[#4ECCA3]/20 to-transparent',
      };
    case 'DRAFT':
      return {
        animation: 'breathing-glow-draft 4s ease-in-out infinite',
        boxShadow: '0 0 15px 2px rgba(148, 163, 184, 0.3), 0 0 30px 6px rgba(148, 163, 184, 0.15)',
        borderColor: 'border-slate-400/30',
        textColor: 'text-slate-400',
        bgGradient: 'from-slate-400/20 to-transparent',
      };
    case 'PENDING_REVIEW':
      return {
        animation: 'breathing-glow-pending 2s ease-in-out infinite',
        boxShadow: '0 0 20px 4px rgba(234, 179, 8, 0.4), 0 0 40px 8px rgba(234, 179, 8, 0.2)',
        borderColor: 'border-yellow-500/30',
        textColor: 'text-yellow-500',
        bgGradient: 'from-yellow-500/20 to-transparent',
      };
    case 'SUSPENDED':
      return {
        animation: 'breathing-glow-suspended 2.5s ease-in-out infinite',
        boxShadow: '0 0 25px 6px rgba(239, 68, 68, 0.5), 0 0 50px 12px rgba(239, 68, 68, 0.25)',
        borderColor: 'border-red-500/30',
        textColor: 'text-red-500',
        bgGradient: 'from-red-500/20 to-transparent',
      };
    case 'ARCHIVED':
      return {
        animation: 'breathing-glow-archived 5s ease-in-out infinite',
        boxShadow: '0 0 10px 2px rgba(107, 114, 128, 0.2), 0 0 20px 4px rgba(107, 114, 128, 0.1)',
        borderColor: 'border-gray-500/30',
        textColor: 'text-gray-500',
        bgGradient: 'from-gray-500/10 to-transparent',
      };
    default:
      return {
        animation: 'breathing-glow-active 3s ease-in-out infinite',
        boxShadow: '0 0 20px 4px rgba(78, 204, 163, 0.4), 0 0 40px 8px rgba(78, 204, 163, 0.2)',
        borderColor: 'border-[#4ECCA3]/30',
        textColor: 'text-[#4ECCA3]',
        bgGradient: 'from-[#4ECCA3]/20 to-transparent',
      };
  }
}

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
  agentsLoading?: boolean;
  eventsLoading?: boolean;
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

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  const { t } = useTranslation();

  const world = props.world;

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const formatDateTime = (d: string) => {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d; // non-ISO string (e.g. "修仙纪元 11190年") — display as-is
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  if (props.loading) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#4ECCA3]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
          <span className="text-sm text-[#e8f5ee]/60">"Loading..."</span>
        </div>
      </div>
    );
  }

  if (props.error || !world) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <span className="text-sm text-red-400">"Error loading world data"</span>
      </div>
    );
  }

  const glowConfig = getStatusGlowConfig(world.status);

  return (
    <>
      {/* Inject status-based glow animation CSS */}
      <style>{statusGlowStyles}</style>
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

        {/* Fixed back button - positioned at banner top-left with transform offset */}
        {props.onBack && (
          <button
            onClick={props.onBack}
            className="fixed z-50 flex items-center justify-center w-10 h-10 rounded-xl bg-black/40 text-white/90 hover:bg-black/60 hover:text-white transition-all"
            style={{ 
              top: 'calc(24px + 15px)',
              left: 'max(39px, calc((100vw - 1400px) / 2 + 24px + 15px))',
              transform: 'translate(30px, 45px)'
            }}
            aria-label="Go Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="relative z-10 w-[min(1400px,calc(100vw-48px))] mx-auto my-6 mb-16 flex flex-col gap-5">
          {/* Hero Banner - Reference Image Style */}
          <section className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/20 bg-[#0f1612]/80 backdrop-blur-sm">
            {/* Background image with overlay */}
            <div
              className="w-full h-[min(45vw,420px)] object-cover object-center block"
              style={{
                background: world.bannerUrl
                  ? `linear-gradient(180deg, rgba(10,15,12,0.2) 0%, rgba(10,15,12,0.4) 50%, rgba(10,15,12,0.9) 100%), url(${world.bannerUrl}) center/cover no-repeat`
                  : `linear-gradient(180deg, rgba(10,15,12,0.2) 0%, rgba(10,15,12,0.4) 50%, rgba(10,15,12,0.9) 100%), url(/images/worlds/xianxia-banner.png) center/cover no-repeat`,
              }}
            />

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0f0c]" />

            {/* Hero content */}
            <div className="absolute inset-0 flex flex-col justify-between p-8">
              {/* Top bar: Type badge right */}
              <div className="flex items-start justify-end">
                {/* Type badge - top right */}
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wider uppercase bg-[#4ECCA3]/20 text-[#4ECCA3] border border-[#4ECCA3]/40 font-semibold">
                  {displayValue(world.type, 'Unknown')} WORLD
                </span>
              </div>

              {/* Bottom: icon + title + TimeFlowDynamics */}
              <div className="flex items-end justify-between gap-6">
                {/* Left: Icon + Title */}
                <div className="flex items-start gap-6 flex-1 min-w-0">
                  {world.iconUrl ? (
                    <div className="relative flex-shrink-0">
                      {/* Status-based Glow Effect */}
                      <div
                        className="absolute inset-0 rounded-2xl"
                        style={{
                          boxShadow: glowConfig.boxShadow,
                          animation: glowConfig.animation,
                        }}
                      />
                      <img
                        src={world.iconUrl}
                        alt={world.name}
                        className={`w-24 h-24 rounded-2xl object-cover border-2 shadow-lg relative z-10 ${glowConfig.borderColor}`}
                      />
                    </div>
                  ) : (
                    <div className="relative flex-shrink-0">
                      {/* Status-based Glow Effect */}
                      <div
                        className="absolute inset-0 rounded-2xl"
                        style={{
                          boxShadow: glowConfig.boxShadow,
                          animation: glowConfig.animation,
                        }}
                      />
                      <div
                        className={`w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-serif border-2 bg-gradient-to-br relative z-10 ${glowConfig.textColor} ${glowConfig.borderColor} ${glowConfig.bgGradient}`}
                      >
                        {world.name ? world.name.charAt(0) : '凡'}
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pb-2">
                    <h1
                      className="text-[clamp(28px,4vw,48px)] leading-tight font-serif tracking-wide text-white drop-shadow-lg"
                      style={{ fontFamily: '"Noto Serif SC", serif' }}
                    >
                      {displayValue(world.name)}
                    </h1>
                    <p className="mt-2 text-base text-white/70 leading-relaxed max-w-2xl">
                      {world.subtitle && (
                        <span
                          className="text-[#4ECCA3]/50 text-xs mr-1"
                          title="Sample data — no API field available"
                        >
                          *
                        </span>
                      )}
                      {displayValue(world.subtitle || world.description)}
                    </p>
                  </div>
                </div>

                {/* Right: Time Flow Dynamics */}
                <div className="flex-shrink-0 w-[140px] h-[140px] -mt-4">
                  <TimeFlowDynamics
                    ratio={world.timeFlowRatio || 1.0}
                    className="h-full"
                    variant="compact"
                  />
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
                <span className="text-sm text-[#4ECCA3]">World Overview</span>
              </div>

              {/* World Name + ID Badge */}
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xl font-bold text-[#e8f5ee]">{displayValue(world.name)}</h3>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 text-xs text-[#4ECCA3] font-mono">
                  ID: {world.id || 'N/A'}
                </div>
              </div>

              {/* Meta info row - Created At + Agent Count */}
              <div className="flex items-center gap-4 mb-4 text-xs text-[#e8f5ee]/60">
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {world.createdAt ? formatDateTime(world.createdAt) : 'N/A'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {world.agentCount !== undefined ? world.agentCount : 0} agents
                </span>
              </div>

              {/* Description */}
              <div className="mb-4">
                <div className="text-xs text-[#4ECCA3] mb-1">Description</div>
                <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                  {displayValue(world.description)}
                </p>
              </div>

              {/* Narrative — mock data, API 无对应字段 */}
              {world.narrative && (
                <div className="mb-4">
                  <div className="text-xs text-[#4ECCA3] mb-1">
                    World Narrative{' '}
                    <span
                      className="text-[#4ECCA3]/50"
                      title="Sample data — no API field available"
                    >
                      *
                    </span>
                  </div>
                  <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                    {displayValue(world.narrative)}
                  </p>
                </div>
              )}

              {/* Quote — mock data, API 无对应字段 */}
              {world.quote && (
                <div className="p-4 rounded-xl bg-[#0a0f0c]/40 border border-[#4ECCA3]/10">
                  <p className="text-sm text-[#e8f5ee]/80 leading-relaxed italic">
                    <span
                      className="text-[#4ECCA3]/50 text-xs not-italic mr-1"
                      title="Sample data — no API field available"
                    >
                      *
                    </span>
                    {displayValue(world.quote)}
                  </p>
                </div>
              )}
            </section>

            {/* Middle Column - Scoring Matrix */}
            <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* 3D Crystal Scoring Matrix with EWMA */}
              <WorldScoringMatrix
                data={{
                  scoreA: world.scoreA,
                  scoreC: world.scoreC,
                  scoreQ: world.scoreQ,
                  scoreE: world.scoreE,
                  scoreEwma: world.scoreEwma,
                }}
                className="h-full"
              />
            </section>

            {/* Right Column - Chronicle/Timeline */}
            <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/15 bg-[#0f1612]/60 backdrop-blur-sm p-5">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* Section Title */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm text-[#4ECCA3]">Chronicle</span>
              </div>

              {/* Timeline */}
              <div className="relative flex flex-col gap-4">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />

                {props.eventsLoading ? (
                  <div className="pl-8 py-8 flex flex-col items-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
                    <span className="text-xs text-[#e8f5ee]/40">Loading events...</span>
                  </div>
                ) : props.events.length > 0 ? (
                  props.events.slice(0, 5).map((event) => (
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
                    No events recorded yet
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
              <span className="text-sm text-[#4ECCA3]">World Agents</span>
            </div>

            {/* Agent Grid - 3 columns */}
            <div className="grid grid-cols-3 gap-4">
              {props.agentsLoading ? (
                <div className="col-span-3 py-16 flex flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
                  <span className="text-xs text-[#e8f5ee]/40">Loading agents...</span>
                </div>
              ) : props.agents.length > 0 ? (
                props.agents.slice(0, 6).map((agent) => (
                  <article
                    key={agent.id}
                    className="relative p-4 rounded-xl bg-[#0a0f0c]/60 border border-[#4ECCA3]/10 overflow-hidden"
                  >
                    {/* Avatar with Add Button */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="relative">
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
                        {/* Add Button - bottom right of avatar */}
                        <button
                          onClick={() => props.onVoiceAgent?.(agent)}
                          className="absolute -bottom-0.5 -right-0.5 h-5 w-5 bg-[#4ECCA3] rounded-full flex items-center justify-center hover:bg-[#3DBB94] transition-colors shadow-sm"
                          title="Add friend"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0f1612" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-bold text-[#e8f5ee] truncate">
                            {displayValue(agent.name)}
                          </h4>
                        </div>
                        <div className="text-xs text-[#4ECCA3] truncate">
                          {displayValue(agent.handle)}
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    <p className="text-xs text-[#e8f5ee]/60 leading-relaxed mb-3 line-clamp-2">
                      {displayValue(agent.bio, 'No bio available')}
                    </p>

                    {/* Created date */}
                    <div className="text-xs text-[#e8f5ee]/40">
                      Created: {agent.createdAt ? formatDateTime(agent.createdAt) : 'N/A'}
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
                  <p className="text-[#e8f5ee]/60 text-sm">No agents in this world yet</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
