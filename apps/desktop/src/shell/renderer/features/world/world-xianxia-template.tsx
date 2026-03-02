import { useTranslation } from 'react-i18next';
import type { WorldDetailData, WorldAgent, WorldEvent } from './world-detail-template';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';

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
                : `linear-gradient(180deg, rgba(10,15,12,0.2) 0%, rgba(10,15,12,0.4) 50%, rgba(10,15,12,0.9) 100%), url(/images/worlds/xianxia-banner.png) center/cover no-repeat`,
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

            {/* Bottom: icon + title + TimeFlowDynamics */}
            <div className="flex items-end justify-between gap-6">
              {/* Left: Icon + Title */}
              <div className="flex items-start gap-6 flex-1 min-w-0">
                {world.iconUrl ? (
                  <img
                    src={world.iconUrl}
                    alt={world.name}
                    className="w-24 h-24 rounded-2xl object-cover border-2 border-[#4ECCA3]/30 shadow-lg flex-shrink-0"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-serif text-[#4ECCA3] border-2 border-[#4ECCA3]/30 bg-gradient-to-br from-[#4ECCA3]/20 to-transparent flex-shrink-0">
                    {world.name ? world.name.charAt(0) : '凡'}
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
                    {world.subtitle && <span className="text-[#4ECCA3]/50 text-xs mr-1" title="Sample data — no API field available">*</span>}
                    {displayValue(world.subtitle || world.description)}
                  </p>
                </div>
              </div>

              {/* Right: Time Flow Dynamics */}
              <div className="flex-shrink-0 w-[140px] h-[140px] -mt-4">
                <TimeFlowDynamics ratio={world.timeFlowRatio || 1.0} className="h-full" variant="compact" />
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

            {/* World Name */}
            <h3 className="text-xl font-bold text-[#e8f5ee] mb-2">{displayValue(world.name)}</h3>

            {/* ID Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#4ECCA3]/10 border border-[#4ECCA3]/20 text-xs text-[#4ECCA3] mb-2 font-mono">
              ID: {world.id || 'N/A'}
            </div>

            {/* Meta info row - Created At + Agent Count */}
            <div className="flex items-center gap-4 mb-4 text-xs text-[#e8f5ee]/60">
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
            <div className="mb-4">
              <div className="text-xs text-[#e8f5ee]/40 mb-1">Description</div>
              <p className="text-sm text-[#e8f5ee]/70 leading-relaxed">
                {displayValue(world.description)}
              </p>
            </div>

            {/* Narrative — mock data, API 无对应字段 */}
            {world.narrative && (
              <div className="mb-4">
                <div className="text-xs text-[#e8f5ee]/40 mb-1">
                  World Narrative <span className="text-[#4ECCA3]/50" title="Sample data — no API field available">*</span>
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
                  <span className="text-[#4ECCA3]/50 text-xs not-italic mr-1" title="Sample data — no API field available">*</span>
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
                    {displayValue(agent.bio, 'No bio available')}
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
                      "Chat"
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
                      "Add Friend"
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
                  No agents in this world yet
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
