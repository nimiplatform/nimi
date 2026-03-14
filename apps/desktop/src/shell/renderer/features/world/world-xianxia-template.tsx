import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldDetailData, WorldAgent, WorldEvent } from './world-detail-template';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';
import { CreateAgentDrawer, type CreateAgentInput } from './create-agent-drawer';

// CSS Keyframes for status-based glow effects and slide panel
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

  @keyframes float {
    0%, 100% {
      transform: translateY(0px);
    }
    50% {
      transform: translateY(-10px);
    }
  }

  @keyframes pulse-glow {
    0%, 100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.8;
    }
  }

  @keyframes slide-in-right {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
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

export type XianxiaWorldData = WorldDetailData;

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
  onCreateAgent?: (input: CreateAgentInput) => void;
  createAgentMutating?: boolean;
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
  const worldSummary = world.overview || world.description;
  const timeFlowRatio = world.timeFlowRatio || 1;
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const getAgentPalette = (agent: WorldAgent) => getSemanticAgentPalette({
    description: agent.bio || world.description,
    worldName: world.name,
    tags: world.themes || undefined,
  });
  const formatDateTime = (d: string) => {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  if (props.loading) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] px-5 py-6 text-[#e8f5ee]">
        <div className="mx-auto w-full max-w-[1240px] space-y-5">
          <div className="flex items-center justify-between gap-5 py-2">
            <div className="flex items-center gap-3.5">
              <div className="h-11 w-11 animate-pulse rounded-xl bg-[#173422]" />
              <div className="space-y-2">
                <div className="h-5 w-28 animate-pulse rounded bg-[#173422]" />
                <div className="h-3 w-24 animate-pulse rounded bg-[#173422]" />
              </div>
            </div>
            <div className="flex gap-2.5">
              <div className="h-10 w-28 animate-pulse rounded-full bg-[#173422]" />
              <div className="h-10 w-32 animate-pulse rounded-full bg-[#173422]" />
            </div>
          </div>
          <section className="overflow-hidden rounded-[32px] border border-[#173422] bg-[#0f1713] p-8 md:p-10">
            <div className="mb-6 flex gap-2.5">
              <div className="h-7 w-24 animate-pulse rounded-full bg-[#173422]" />
              <div className="h-7 w-20 animate-pulse rounded-full bg-[#173422]" />
              <div className="h-7 w-24 animate-pulse rounded-full bg-[#173422]" />
            </div>
            <div className="flex flex-col gap-8 lg:flex-row">
              <div className="flex flex-1 gap-5">
                <div className="h-28 w-28 animate-pulse rounded-[28px] bg-[#173422]" />
                <div className="flex-1 space-y-4">
                  <div className="h-10 w-64 animate-pulse rounded bg-[#173422]" />
                  <div className="h-5 w-40 animate-pulse rounded bg-[#173422]" />
                  <div className="h-4 w-full animate-pulse rounded bg-[#173422]" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-[#173422]" />
                </div>
              </div>
              <div className="grid min-w-[280px] grid-cols-2 gap-4">
                <div className="h-28 animate-pulse rounded-[24px] bg-[#173422]" />
                <div className="h-28 animate-pulse rounded-[24px] bg-[#173422]" />
                <div className="h-28 animate-pulse rounded-[24px] bg-[#173422]" />
                <div className="h-28 animate-pulse rounded-[24px] bg-[#173422]" />
              </div>
            </div>
          </section>
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1.3fr_1fr]">
            <div className="h-[420px] animate-pulse rounded-[28px] bg-[#0f1713]" />
            <div className="h-[420px] animate-pulse rounded-[28px] bg-[#0f1713]" />
            <div className="h-[420px] animate-pulse rounded-[28px] bg-[#0f1713]" />
          </div>
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

  const glowConfig = getStatusGlowConfig(world.status);

  return (
    <>
      {/* Inject status-based glow animation CSS */}
      <style>{statusGlowStyles}</style>
      <div className="min-h-screen bg-[#0a0f0c] text-[#e8f5ee] font-sans relative overflow-x-hidden">
        {/* Global background - dark cultivation theme with stars */}
        <div className="fixed inset-0 pointer-events-none">
          {/* Base gradient - deep dark green/black */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f16] via-[#0a0f0c] to-[#050705]" />
          
          {/* Stars background */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(78, 204, 163, 0.3) 1px, transparent 1px)`,
              backgroundSize: '50px 50px',
            }}
          />
          
          {/* Additional smaller stars */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(78, 204, 163, 0.5) 0.5px, transparent 0.5px)`,
              backgroundSize: '25px 25px',
            }}
          />
          
          {/* Glow effects - aurora-like */}
          <div
            className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full"
            style={{ 
              background: 'radial-gradient(circle, rgba(78, 204, 163, 0.15) 0%, transparent 70%)',
              animation: 'pulse-glow 4s ease-in-out infinite'
            }}
          />
          <div
            className="absolute top-1/3 -left-40 w-[500px] h-[500px] rounded-full"
            style={{ 
              background: 'radial-gradient(circle, rgba(78, 204, 163, 0.1) 0%, transparent 70%)',
              animation: 'pulse-glow 5s ease-in-out infinite 1s'
            }}
          />
          <div
            className="absolute bottom-20 right-1/4 w-[400px] h-[400px] rounded-full"
            style={{ 
              background: 'radial-gradient(circle, rgba(78, 204, 163, 0.08) 0%, transparent 70%)',
              animation: 'pulse-glow 6s ease-in-out infinite 0.5s'
            }}
          />
        </div>

        <div className="relative z-10 w-[min(1400px,calc(100vw-48px))] mx-auto py-6 flex flex-col gap-5">
          {/* Hero Banner - Large sci-fi/cultivation themed image */}
          <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/20">
            {/* Background image container */}
            <div className="relative w-full h-[380px]">
              {/* Banner background image */}
              <div
                className="absolute inset-0"
                style={{
                  background: world.bannerUrl
                    ? `url(${world.bannerUrl}) center/cover no-repeat`
                    : `linear-gradient(135deg, #0d2b1f 0%, #0a1f15 50%, #071912 100%)`,
                }}
              />
              
              {/* Gradient overlays for depth */}
              <div 
                className="absolute inset-0"
                style={{
                  background: `
                    radial-gradient(ellipse at 30% 20%, rgba(78, 204, 163, 0.1) 0%, transparent 50%),
                    radial-gradient(ellipse at 70% 80%, rgba(78, 204, 163, 0.05) 0%, transparent 40%),
                    linear-gradient(180deg, rgba(10, 15, 12, 0.3) 0%, rgba(10, 15, 12, 0.5) 50%, rgba(10, 15, 12, 0.95) 100%)
                  `
                }}
              />

              {/* Futuristic grid lines overlay */}
              <div 
                className="absolute inset-0 opacity-10"
                style={{
                  backgroundImage: `
                    linear-gradient(90deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px),
                    linear-gradient(0deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px)
                  `,
                  backgroundSize: '100px 100px'
                }}
              />

              {/* Top right badge */}
              <div className="absolute top-4 right-4">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs tracking-wider uppercase bg-[#4ECCA3]/20 text-[#4ECCA3] border border-[#4ECCA3]/40 font-semibold backdrop-blur-sm">
                  {world.type === 'OASIS' ? 'OASIS WORLD' : 'CREATOR WORLD'}
                </span>
              </div>

              {/* Back button inside hero card */}
              {props.onBack && (
                <div className="absolute left-4 top-4 z-20">
                  <button
                    onClick={props.onBack}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/45 text-[#4ECCA3] backdrop-blur-md transition-all hover:bg-black/65 hover:border-[#4ECCA3]/40"
                    aria-label={t('WorldDetail.backToList', { defaultValue: 'Back to List' })}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Hero content - bottom area */}
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <div className="flex items-end justify-between gap-6">
                  {/* Left: Icon + Title + Description */}
                  <div className="flex items-start gap-6 flex-1 min-w-0">
                    {/* World icon with glow */}
                    {world.iconUrl ? (
                      <div className="relative flex-shrink-0" style={{ animation: 'float 6s ease-in-out infinite' }}>
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
                      <div className="relative flex-shrink-0" style={{ animation: 'float 6s ease-in-out infinite' }}>
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
                          {world.name ? world.name.charAt(0) : 'W'}
                        </div>
                      </div>
                    )}
                    
                    {/* Title and description */}
                    <div className="flex-1 min-w-0">
                      {world.tagline ? (
                        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-[#4ECCA3]">
                          {world.tagline}
                        </p>
                      ) : null}
                      <h1
                        className="text-[42px] leading-tight font-serif tracking-wide text-white drop-shadow-lg mb-2"
                        style={{ fontFamily: '"Noto Serif SC", serif' }}
                      >
                        {displayValue(world.name)}
                      </h1>
                      {world.motto ? (
                        <p className="mb-2 text-sm italic text-white/80">
                          {world.motto}
                        </p>
                      ) : null}
                      <p className="text-base text-white/70 leading-relaxed max-w-2xl">
                        {displayValue(worldSummary)}
                      </p>
                    </div>
                  </div>

                  {/* Right: Time Flow Dynamics */}
                  <div className="flex-shrink-0 w-[120px] h-[120px]">
                    <TimeFlowDynamics
                      ratio={timeFlowRatio}
                      className="h-full"
                      variant="compact"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Main Content Grid - 3 Columns */}
          <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-5">
            {/* Left Column - World Overview */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
              {/* Top glow line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* Section Title */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.overview')}</span>
              </div>

              {/* World Name + ID Badge */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h3 className="text-xl font-bold text-[#e8f5ee]">{displayValue(world.name)}</h3>
                <div className="inline-flex max-w-full items-start gap-2 rounded-lg border border-[#4ECCA3]/20 bg-[#4ECCA3]/10 px-3 py-1.5 text-xs font-mono text-[#4ECCA3]">
                  <span className="shrink-0">{t('WorldDetail.xianxia.id')}:</span>
                  <span className="break-all whitespace-normal">
                    {world.id || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Meta info row */}
              <div className="flex items-center gap-4 mb-5 text-xs text-[#e8f5ee]/60">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {world.createdAt ? formatDateTime(world.createdAt) : 'N/A'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t('WorldDetail.agents', {
                    count: world.agentCount !== undefined ? world.agentCount : 0,
                    defaultValue: '{{count}} Agents',
                  })}
                </span>
              </div>

              {/* Description */}
              <div className="mb-5">
                <div className="text-xs text-[#4ECCA3] mb-2">{t('WorldDetail.description')}</div>
                <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                  {displayValue(worldSummary)}
                </p>
              </div>
            </section>

            {/* Middle Column - Scoring Matrix */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
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

            {/* Right Column - Chronicle */}
            <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

              {/* Section Title */}
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.timeline')}</span>
              </div>

              {/* Timeline */}
              <div className="relative flex flex-col gap-4">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[#4ECCA3] via-[#4ECCA3]/30 to-transparent" />

                {props.eventsLoading ? (
                  <div className="pl-8 py-8 flex flex-col items-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
                    <span className="text-xs text-[#e8f5ee]/40">
                      {t('WorldDetail.eventsLoading', { defaultValue: 'Loading events...' })}
                    </span>
                  </div>
                ) : props.events.length > 0 ? (
                  props.events.slice(0, 5).map((event) => (
                    <div key={event.id} className="relative pl-8">
                      {/* Timeline dot */}
                      <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-[#0f1612] border-2 border-[#4ECCA3]/30 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-[#4ECCA3]" />
                      </div>

                      {/* Date */}
                      <div className="text-xs text-[#4ECCA3] tracking-wider mb-1">
                        {event.time ? formatDateTime(event.time) : 'N/A'}
                      </div>

                      {/* Content */}
                      <div className="p-3 rounded-xl bg-[#0a0f0c]/60 border border-[#4ECCA3]/10">
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

          {/* Bottom Section - World Agents */}
          <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />

            {/* Section Title */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm text-[#4ECCA3] font-medium">{t('WorldDetail.section.agents')}</span>
            </div>

            {/* Agent Grid - 4 columns per row */}
            <div className="grid auto-rows-fr grid-cols-4 gap-4">
              {/* 创建�?Agent 专属卡片 */}
              {props.onCreateAgent && (
                <article
                  onClick={() => setShowCreateAgent(true)}
                  className="group relative h-full min-h-[174px] w-full min-w-0 cursor-pointer overflow-hidden rounded-xl border-2 border-dashed bg-gradient-to-br from-[#0b120e]/60 to-[#111a15]/78 p-4 transition-all duration-500 hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(78,204,163,0.18)]"
                  style={{
                    borderColor: 'rgba(117, 240, 194, 0.48)',
                    boxShadow: 'inset 0 0 0 1px rgba(117, 240, 194, 0.06), inset 0 0 22px rgba(78, 204, 163, 0.08)',
                  }}
                >
                  {/* 呼吸灯效果的微光动画 */}
                  <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                    <div 
                      className="absolute inset-0 rounded-xl animate-pulse"
                      style={{
                        background: 'linear-gradient(135deg, rgba(78,204,163,0) 0%, rgba(78,204,163,0.1) 50%, rgba(78,204,163,0) 100%)',
                      }}
                    />
                  </div>
                  
                  <div className="relative z-10 flex h-full min-h-[140px] flex-col items-center justify-center">
                    {/* 大号薄荷�?+ �?*/}
                    <div 
                      className="w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110"
                      style={{ background: 'linear-gradient(135deg, #4ECCA3, #3DBB94)' }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </div>
                    {/* 文案 */}
                    <span className="text-sm font-semibold tracking-[0.01em] text-[#76e6bf]">
                      {t('World.createAgent.title', { defaultValue: 'Create New Agent' })}
                    </span>
                  </div>
                </article>
              )}

              {props.agentsLoading ? (
                <div className="col-span-4 py-16 flex flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
                  <span className="text-xs text-[#e8f5ee]/40">
                    {t('WorldDetail.agentsLoading', { defaultValue: 'Loading agents...' })}
                  </span>
                </div>
              ) : props.agents.length > 0 ? (
                props.agents.map((agent) => (
                  <article
                    key={agent.id}
                    className="relative h-full min-h-[174px] w-full min-w-0 overflow-hidden rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4"
                  >
                    {/* Agent header */}
                    <div className="flex items-start gap-3 mb-3">
                      {/* Theme exception: xianxia cards intentionally keep a tighter silhouette. */}
                      <EntityAvatar
                        imageUrl={agent.avatarUrl}
                        name={agent.name || 'Agent'}
                        kind="agent"
                        sizeClassName="h-14 w-14"
                        radiusClassName="rounded-[10px]"
                        innerRadiusClassName="rounded-[8px]"
                        textClassName="text-lg font-serif"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-[#e8f5ee] truncate">
                          {displayValue(agent.name)}
                        </h4>
                        <div className="text-xs truncate" style={{ color: getAgentPalette(agent).accent }}>
                          {displayValue(agent.handle)}
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    <p className="text-xs text-[#e8f5ee]/60 leading-relaxed line-clamp-2">
                      {displayValue(agent.bio, 'No bio available')}
                    </p>
                  </article>
                ))
              ) : (
                <div className="col-span-4 py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 mb-4 rounded-full bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ECCA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <p className="text-[#e8f5ee]/60 text-sm">
                    {t('WorldDetail.noAgentsYet', { defaultValue: 'No agents in this world yet' })}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <CreateAgentDrawer
        isOpen={showCreateAgent && Boolean(props.onCreateAgent)}
        onClose={() => setShowCreateAgent(false)}
        onSubmit={(input) => {
          props.onCreateAgent?.(input);
          setShowCreateAgent(false);
        }}
        worldName={world.name}
        worldBannerUrl={world.bannerUrl}
        worldDescription={world.description}
        submitting={props.createAgentMutating}
      />
    </>
  );
}
