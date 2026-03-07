import { useState } from 'react';
import type { WorldDetailData, WorldAgent, WorldEvent } from './world-detail-template';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
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
  onCreateAgent?: (input: {
    handle: string;
    displayName: string;
    concept: string;
    description: string;
    scenario: string;
    greeting: string;
    referenceImageUrl: string;
    wakeStrategy: '' | 'PASSIVE' | 'PROACTIVE';
    dnaPrimary: '' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
    dnaSecondary: string[];
  }) => void;
  createAgentMutating?: boolean;
};

// Helper function: display data or show fallback
const displayValue = (value: unknown, fallback = 'N/A') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && isNaN(value)) return fallback;
  return String(value);
};

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  const world = props.world;
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [agentHandle, setAgentHandle] = useState('');
  const [agentDisplayName, setAgentDisplayName] = useState('');
  const [agentConcept, setAgentConcept] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [agentScenario, setAgentScenario] = useState('');
  const [agentGreeting, setAgentGreeting] = useState('');
  const [agentRefImageUrl, setAgentRefImageUrl] = useState('');
  const [agentWakeStrategy, setAgentWakeStrategy] = useState<'' | 'PASSIVE' | 'PROACTIVE'>('PASSIVE');
  const [agentDnaPrimary, setAgentDnaPrimary] = useState<'' | 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC'>('');
  const [agentDnaSecondary, setAgentDnaSecondary] = useState<string[]>([]);

  const DNA_PRIMARY_OPTIONS: Array<{ value: typeof agentDnaPrimary; label: string }> = [
    { value: '', label: '不指定' },
    { value: 'CARING', label: '关怀型' },
    { value: 'PLAYFUL', label: '活泼型' },
    { value: 'INTELLECTUAL', label: '智慧型' },
    { value: 'CONFIDENT', label: '自信型' },
    { value: 'MYSTERIOUS', label: '神秘型' },
    { value: 'ROMANTIC', label: '浪漫型' },
  ];
  const DNA_SECONDARY_OPTIONS = [
    { value: 'HUMOROUS', label: '幽默' },
    { value: 'SARCASTIC', label: '毒舌' },
    { value: 'GENTLE', label: '温柔' },
    { value: 'DIRECT', label: '直接' },
    { value: 'OPTIMISTIC', label: '乐观' },
    { value: 'REALISTIC', label: '现实' },
    { value: 'DRAMATIC', label: '戏剧化' },
    { value: 'PASSIONATE', label: '热情' },
    { value: 'REBELLIOUS', label: '叛逆' },
    { value: 'INNOCENT', label: '纯真' },
    { value: 'WISE', label: '智慧' },
    { value: 'ECCENTRIC', label: '古怪' },
  ];

  function resetCreateAgentForm() {
    setAgentHandle('');
    setAgentDisplayName('');
    setAgentConcept('');
    setAgentDescription('');
    setAgentScenario('');
    setAgentGreeting('');
    setAgentRefImageUrl('');
    setAgentWakeStrategy('PASSIVE');
    setAgentDnaPrimary('');
    setAgentDnaSecondary([]);
  }
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
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#4ECCA3]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
          <span className="text-sm text-[#e8f5ee]/60">Loading world...</span>
        </div>
      </div>
    );
  }

  if (props.error || !world) {
    return (
      <div className="min-h-screen bg-[#0a0f0c] flex items-center justify-center">
        <span className="text-sm text-red-400">Error loading world data</span>
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

        {/* Fixed back button - top left */}
        {props.onBack && (
          <button
            onClick={props.onBack}
            className="fixed z-50 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 border border-[#4ECCA3]/20 text-[#4ECCA3] hover:bg-black/70 hover:border-[#4ECCA3]/40 transition-all"
            style={{ 
              top: '24px',
              left: '24px'
            }}
            aria-label="Go Back"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}

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
                  OASIS WORLD
                </span>
              </div>

              {/* Hero content - bottom area */}
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <div className="flex items-end justify-between gap-6">
                  {/* Left: Icon + Title + Description */}
                  <div className="flex items-end gap-6 flex-1 min-w-0">
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
                          {world.name ? world.name.charAt(0) : '凡'}
                        </div>
                      </div>
                    )}
                    
                    {/* Title and description */}
                    <div className="flex-1 min-w-0 pb-1">
                      <h1
                        className="text-[42px] leading-tight font-serif tracking-wide text-white drop-shadow-lg mb-2"
                        style={{ fontFamily: '"Noto Serif SC", serif' }}
                      >
                        {displayValue(world.name)}
                      </h1>
                      <p className="text-base text-white/70 leading-relaxed max-w-2xl">
                        {world.subtitle || world.description}
                      </p>
                    </div>
                  </div>

                  {/* Right: Time Flow Dynamics */}
                  <div className="flex-shrink-0 w-[120px] h-[120px]">
                    <TimeFlowDynamics
                      ratio={world.timeFlowRatio || 1.0}
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
                <span className="text-sm text-[#4ECCA3] font-medium">World Overview</span>
              </div>

              {/* World Name + ID Badge */}
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h3 className="text-xl font-bold text-[#e8f5ee]">{displayValue(world.name)}</h3>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 text-xs text-[#4ECCA3] font-mono">
                  ID: {world.id ? (world.id.length > 20 ? world.id.slice(0, 16) + '...' : world.id) : 'N/A'}
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
                  {world.agentCount !== undefined ? world.agentCount : 0} agents
                </span>
              </div>

              {/* Description */}
              <div className="mb-5">
                <div className="text-xs text-[#4ECCA3] mb-2">Description</div>
                <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                  {displayValue(world.description)}
                </p>
              </div>

              {/* World Narrative */}
              {world.narrative && (
                <div className="mb-5">
                  <div className="text-xs text-[#4ECCA3] mb-2 flex items-center gap-1">
                    World Narrative
                    <span className="text-[#4ECCA3]/50" title="Sample data">*</span>
                  </div>
                  <p className="text-sm text-[#e8f5ee]/70 leading-relaxed whitespace-pre-line">
                    {displayValue(world.narrative)}
                  </p>
                </div>
              )}

              {/* Quote */}
              {world.quote && (
                <div className="p-4 rounded-xl bg-[#4ECCA3]/5 border border-[#4ECCA3]/10">
                  <p className="text-sm text-[#e8f5ee]/80 leading-relaxed italic">
                    {displayValue(world.quote)}
                  </p>
                </div>
              )}
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
                <span className="text-sm text-[#4ECCA3] font-medium">Chronicle</span>
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
                    No events recorded yet
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
              <span className="text-sm text-[#4ECCA3] font-medium">World Agents</span>
              {props.onCreateAgent && (
                <button
                  type="button"
                  onClick={() => setShowCreateAgent((v) => !v)}
                  title="Create Agent"
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[#4ECCA3]/30 text-[#4ECCA3] hover:bg-[#4ECCA3]/10 transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M5 1v8M1 5h8" />
                  </svg>
                </button>
              )}
            </div>

            {/* Inline Create Agent Form */}
            {showCreateAgent && props.onCreateAgent && (
              <div className="mb-5 rounded-xl border border-[#4ECCA3]/20 bg-[#0a0f0c]/80 p-4">
                <div className="flex flex-col gap-3">
                  {/* 基础信息 */}
                  <p className="text-[10px] font-medium text-[#4ECCA3]/70 uppercase tracking-wider">基础信息</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={agentHandle}
                      onChange={(e) => setAgentHandle(e.target.value)}
                      placeholder="Handle（必填）"
                      className="h-9 rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60"
                    />
                    <input
                      value={agentDisplayName}
                      onChange={(e) => setAgentDisplayName(e.target.value)}
                      placeholder="显示名称（可选）"
                      className="h-9 rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60"
                    />
                  </div>
                  <input
                    value={agentRefImageUrl}
                    onChange={(e) => setAgentRefImageUrl(e.target.value)}
                    placeholder="形象参考图 URL（可选）"
                    className="h-9 rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60"
                  />

                  {/* 人设 */}
                  <p className="text-[10px] font-medium text-[#4ECCA3]/70 uppercase tracking-wider mt-1">人设</p>
                  <textarea
                    value={agentConcept}
                    onChange={(e) => setAgentConcept(e.target.value)}
                    placeholder="人设概念（必填）——高度概括角色核心"
                    rows={2}
                    className="rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 py-2 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60 resize-none"
                  />
                  <textarea
                    value={agentDescription}
                    onChange={(e) => setAgentDescription(e.target.value)}
                    placeholder="简介（可选）——对外展示的角色描述"
                    rows={2}
                    className="rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 py-2 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60 resize-none"
                  />
                  <textarea
                    value={agentScenario}
                    onChange={(e) => setAgentScenario(e.target.value)}
                    placeholder="初始场景（可选）——角色所处的世界背景"
                    rows={2}
                    className="rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 py-2 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60 resize-none"
                  />
                  <input
                    value={agentGreeting}
                    onChange={(e) => setAgentGreeting(e.target.value)}
                    placeholder="开场白（可选）——第一轮对话的打开语"
                    className="h-9 rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 text-xs text-[#e8f5ee] placeholder-[#e8f5ee]/30 outline-none focus:border-[#4ECCA3]/60"
                  />

                  {/* DNA 性格 */}
                  <p className="text-[10px] font-medium text-[#4ECCA3]/70 uppercase tracking-wider mt-1">性格 DNA</p>
                  <select
                    value={agentDnaPrimary}
                    onChange={(e) => setAgentDnaPrimary(e.target.value as typeof agentDnaPrimary)}
                    className="h-9 rounded-lg border border-[#4ECCA3]/20 bg-[#111a14] px-3 text-xs text-[#e8f5ee] outline-none focus:border-[#4ECCA3]/60"
                  >
                    {DNA_PRIMARY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-4 gap-1.5">
                    {DNA_SECONDARY_OPTIONS.map((opt) => {
                      const checked = agentDnaSecondary.includes(opt.value);
                      const disabled = !checked && agentDnaSecondary.length >= 3;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setAgentDnaSecondary((prev) =>
                              checked ? prev.filter((v) => v !== opt.value) : [...prev, opt.value],
                            );
                          }}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors ${
                            checked
                              ? 'border-[#4ECCA3]/60 bg-[#4ECCA3]/15 text-[#4ECCA3]'
                              : 'border-[#4ECCA3]/15 bg-transparent text-[#e8f5ee]/40 hover:border-[#4ECCA3]/30 hover:text-[#e8f5ee]/60'
                          } disabled:cursor-not-allowed disabled:opacity-30`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-[#e8f5ee]/30">最多选 3 项（已选 {agentDnaSecondary.length}/3）</p>

                  {/* 唤醒策略 */}
                  <p className="text-[10px] font-medium text-[#4ECCA3]/70 uppercase tracking-wider mt-1">唤醒策略</p>
                  <div className="flex gap-3">
                    {(['PASSIVE', 'PROACTIVE'] as const).map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setAgentWakeStrategy(val)}
                        className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                          agentWakeStrategy === val
                            ? 'border-[#4ECCA3]/60 bg-[#4ECCA3]/15 text-[#4ECCA3]'
                            : 'border-[#4ECCA3]/15 text-[#e8f5ee]/40 hover:border-[#4ECCA3]/30'
                        }`}
                      >
                        {val === 'PASSIVE' ? 'PASSIVE 被动' : 'PROACTIVE 主动'}
                      </button>
                    ))}
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex justify-end gap-2 pt-2 border-t border-[#4ECCA3]/10">
                    <button
                      type="button"
                      onClick={() => { resetCreateAgentForm(); setShowCreateAgent(false); }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#e8f5ee]/40 hover:text-[#e8f5ee]/70"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={!agentHandle.trim() || !agentConcept.trim() || props.createAgentMutating}
                      onClick={() => {
                        props.onCreateAgent!({
                          handle: agentHandle,
                          displayName: agentDisplayName,
                          concept: agentConcept,
                          description: agentDescription,
                          scenario: agentScenario,
                          greeting: agentGreeting,
                          referenceImageUrl: agentRefImageUrl,
                          wakeStrategy: agentWakeStrategy,
                          dnaPrimary: agentDnaPrimary,
                          dnaSecondary: agentDnaSecondary,
                        });
                        resetCreateAgentForm();
                        setShowCreateAgent(false);
                      }}
                      className="rounded-lg bg-[#4ECCA3] px-4 py-1.5 text-xs font-medium text-[#0a0f0c] hover:bg-[#3DBA92] disabled:cursor-not-allowed disabled:bg-[#4ECCA3]/30 disabled:text-[#0a0f0c]/50 transition-all"
                    >
                      {props.createAgentMutating ? '创建中...' : '创建 Agent'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Grid - 4 columns per row */}
            <div className="grid grid-cols-4 gap-4">
              {props.agentsLoading ? (
                <div className="col-span-4 py-16 flex flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
                  <span className="text-xs text-[#e8f5ee]/40">Loading agents...</span>
                </div>
              ) : props.agents.length > 0 ? (
                props.agents.map((agent) => (
                  <article
                    key={agent.id}
                    className="relative w-full min-w-0 overflow-hidden rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4"
                  >
                    {/* Agent header */}
                    <div className="flex items-start gap-3 mb-3">
                      {/* Theme exception: xianxia cards intentionally keep a tighter silhouette. */}
                      <EntityAvatar
                        imageUrl={agent.avatarUrl}
                        name={agent.name || '修'}
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
