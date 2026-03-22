import React from 'react';
import type { LandingContent } from '../content/landing-content.js';

export function ArchitectureSection({ content }: { content?: LandingContent['architecture'] }) {
  if (!content) return null;

  return (
    <section id="architecture" className="relative overflow-hidden border-t border-white/5 bg-[#0A0D14] section-pad outline-none">
      <style>{`
        @keyframes flow-left-to-right {
          to { stroke-dashoffset: -20; }
        }
        @keyframes flow-right-to-left {
          to { stroke-dashoffset: 20; }
        }
        .animate-flow-forward {
          animation: flow-left-to-right 1.2s linear infinite;
        }
        .animate-flow-reverse {
          animation: flow-right-to-left 1.2s linear infinite;
        }
        .bg-grid-dots {
          background-image: radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        .glass-panel {
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
        }
      `}</style>

      {/* Grid Pattern Background */}
      <div className="absolute inset-0 bg-grid-dots opacity-40 mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#0A0D14_70%)] pointer-events-none" />

      <div className="container-nimi relative z-20 mx-auto px-4 lg:px-8">
        
        {/* Title Area */}
        <div className="text-center max-w-4xl mx-auto mb-16 lg:mb-24">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-6 font-semibold text-xs text-slate-300 uppercase tracking-widest shadow-lg backdrop-blur-md">
            {content.subtitle}
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl text-white mb-8">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#38d6a3] via-[#0ea5e9] to-[#8b5cf6]">
              {content.title}
            </span>
          </h2>
          <p className="text-lg sm:text-xl leading-relaxed text-slate-400 font-medium">
            {content.description}
          </p>
        </div>

        {/* Dynamic Canvas Area (Desktop Only) */}
        <div className="relative mx-auto hidden w-full justify-center overflow-visible lg:flex mb-24">
          <div className="relative h-[760px] w-[1000px] shrink-0 select-none overflow-hidden rounded-[2rem] border border-white/10 bg-[#0A0D14]/80 glass-panel shadow-[0_20px_50px_rgba(0,0,0,0.8)]" style={{ transformOrigin: 'center center', transform: 'scale(1)', maxWidth: '100%' }}>
          
          {/* Background Ambient Glows */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[#0ea5e9]/5 blur-[120px] rounded-full pointer-events-none" />

          {/* Connective SVG Paths */}
          <svg className="absolute inset-0 z-0 h-full w-full pointer-events-none" viewBox="0 0 1000 760">
            <defs>
              <linearGradient id="flow-app" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#fff" stopOpacity="0.1"/>
              </linearGradient>
              <linearGradient id="flow-realm-rest" x1="190" y1="500" x2="190" y2="535" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.08"/>
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.85"/>
              </linearGradient>
              <linearGradient id="flow-runtime-grpc" x1="810" y1="500" x2="810" y2="535" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#38d6a3" stopOpacity="0.08"/>
                <stop offset="100%" stopColor="#38d6a3" stopOpacity="0.9"/>
              </linearGradient>
            </defs>

            {/* Faint Under-tracks */}
            <g stroke="#ffffff" strokeOpacity="0.05" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M500 70 L500 90" />
              <path d="M250 134 L250 160" />
              <path d="M500 134 L500 160" />
              <path d="M750 134 L750 160" />
              <path d="M190 500 L190 535" />
              <path d="M810 500 L810 535" />
              <path d="M190 535 L190 555" />
              <path d="M810 535 L810 555" />
              <path d="M150 620 L240 620" />
              <path d="M300 620 L390 620" />
              <path d="M450 620 L540 620" />
              <path d="M600 620 L690 620" />
              <path d="M750 620 L840 620" />
            </g>

            {/* Animated Flow Tracks */}
            <g strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 8" className="opacity-90">
              <path className="animate-flow-forward" stroke="url(#flow-app)" d="M500 70 L500 90" />
              <path className="animate-flow-forward" stroke="#0ea5e9" d="M250 134 L250 160" />
              <path className="animate-flow-forward" stroke="#8b5cf6" d="M500 134 L500 160" />
              <path className="animate-flow-forward" stroke="#38d6a3" d="M750 134 L750 160" />
              <path className="animate-flow-forward" stroke="url(#flow-realm-rest)" d="M190 500 L190 535" />
              <path className="animate-flow-forward" stroke="url(#flow-runtime-grpc)" d="M810 500 L810 535" />
              <path className="animate-flow-forward" stroke="#0ea5e9" d="M190 535 L190 555" />
              <path className="animate-flow-forward" stroke="#38d6a3" d="M810 535 L810 555" />
              
              {/* Realm Radial Branches */}
              <g className="animate-flow-forward">
                <path stroke="#0ea5e9" d="M460 330 C400 330, 400 238, 310 238" />
                <path stroke="#06b6d4" d="M460 330 C400 330, 400 283, 310 283" />
                <path stroke="#10b981" d="M460 330 L310 328" />
                <path stroke="#f59e0b" d="M460 330 C400 330, 400 373, 310 373" />
                <path stroke="#8b5cf6" d="M460 330 C400 330, 400 418, 310 418" />
                <path stroke="#ec4899" d="M460 330 C400 330, 400 463, 310 463" />
              </g>

              {/* Runtime Radial Branches */}
              <g className="animate-flow-forward">
                <path stroke="#0ea5e9" d="M540 330 C600 330, 600 274, 690 274" />
                <path stroke="#8b5cf6" d="M540 330 L690 344" />
                <path stroke="#f43f5e" d="M540 330 C600 330, 600 414, 690 414" />
              </g>

              {/* Bottom horizontal sequence */}
              <g stroke="#94a3b8" className="animate-flow-forward opacity-40">
                <path d="M150 620 L240 620" />
                <path d="M300 620 L390 620" />
                <path d="M450 620 L540 620" />
                <path d="M600 620 L690 620" />
                <path d="M750 620 L840 620" />
              </g>
            </g>
          </svg>

          {/* Top Node: APP */}
          <div className="absolute top-[30px] left-[380px] w-[240px] h-[40px] bg-white rounded-full flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(255,255,255,0.2)] text-slate-900 border border-slate-200 z-10 transition-transform hover:scale-105">
            <svg className="w-5 h-5 text-[#0ea5e9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
               <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-[13px] tracking-[0.15em] font-bold uppercase">YOUR AI APP / MOD</span>
          </div>

          {/* Wide SDK Node */}
          <div className="absolute top-[90px] left-[200px] w-[600px] h-[44px] bg-gradient-to-r from-[#0ea5e9]/20 via-[#8b5cf6]/20 to-[#38d6a3]/20 rounded-xl flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.2)] border border-[#8b5cf6]/30 z-10 backdrop-blur-md">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            <span className="font-mono text-[16px] font-bold text-white tracking-widest uppercase">@nimiplatform/sdk</span>
          </div>

          {/* Central Vertical Pillar: Platform */}
          <div className="absolute top-[160px] left-[460px] w-[80px] h-[340px] rounded-3xl bg-[#0f172a]/90 backdrop-blur-xl border border-white/10 shadow-[0_0_50px_rgba(139,92,246,0.3)] z-20 flex items-center justify-center overflow-hidden group hover:bg-[#1e293b]/90 transition-colors">
             <div className="absolute inset-0 bg-gradient-to-b from-[#0ea5e9]/10 via-[#8b5cf6]/20 to-[#38d6a3]/10" />
             <span className="text-white font-bold tracking-[0.2em] uppercase text-[15px] whitespace-nowrap opacity-90 transition-transform group-hover:scale-105" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
               @NIMI PLATFORM
             </span>
             {/* Center glowing focal point */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/5 blur-md" />
          </div>

          {/* Left Block: REALM Container */}
          <div className="absolute top-[160px] left-[50px] w-[280px] h-[340px] bg-white/[0.02] border border-white/5 rounded-3xl backdrop-blur-md z-0 flex flex-col items-center shadow-xl">
             <div className="w-full bg-gradient-to-b from-white/[0.06] to-transparent pt-4 pb-2 flex flex-col items-center rounded-t-3xl text-center">
                <span className="font-bold text-white tracking-[0.2em] text-[16px]">REALM</span>
                <span className="text-[#0ea5e9] text-[9px] uppercase tracking-widest font-bold">Cloud Context Plane</span>
             </div>
          </div>

          {/* REST + WS Node */}
          <div className="absolute top-[535px] left-[90px] w-[200px] h-[32px] bg-[#0A0D14] rounded-xl flex items-center justify-center border border-[#0ea5e9]/40 shadow-[0_0_20px_rgba(14,165,233,0.15)] z-10 transition-transform hover:-translate-y-1">
            <div className="absolute inset-0 bg-[#0ea5e9]/10 rounded-xl" />
            <span className="font-bold tracking-widest text-[10px] text-[#0ea5e9] relative z-10 uppercase">REST + WebSocket</span>
          </div>

          {/* Realm Domain Nodes */}
          {[
            { id: 'Worlds', y: 220, icon: '\u{1F310}', color: '#0ea5e9' },
            { id: 'Agents', y: 265, icon: '\u{1F916}', color: '#06b6d4' },
            { id: 'Social', y: 310, icon: '\u{1F465}', color: '#10b981' },
            { id: 'Economy', y: 355, icon: '\u{1F4B0}', color: '#f59e0b' },
            { id: 'Memory', y: 400, icon: '\u{1F9E0}', color: '#8b5cf6' },
            { id: 'Identity', y: 445, icon: '\u{1F464}', color: '#ec4899' },
          ].map(sat => (
            <div key={sat.id} className="absolute left-[90px] w-[220px] h-[36px] bg-[#111827] border border-white/10 rounded-lg flex items-center px-4 shadow-[0_4px_15px_rgba(0,0,0,0.5)] transition-all hover:bg-white/[0.05] hover:-translate-x-1 hover:border-white/30 z-10 cursor-default" style={{ top: sat.y }}>
               <div className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center mr-3 text-sm shadow-inner" style={{ color: sat.color }}>{sat.icon}</div>
               <span className="text-[12px] font-bold text-slate-300 transition-colors tracking-wide">{sat.id}</span>
            </div>
          ))}

          {/* Right Block: RUNTIME Container */}
          <div className="absolute top-[160px] left-[670px] w-[280px] h-[340px] bg-white/[0.02] border border-white/5 rounded-3xl backdrop-blur-md z-0 flex flex-col items-center shadow-xl">
             <div className="w-full bg-gradient-to-b from-white/[0.06] to-transparent pt-4 pb-2 flex flex-col items-center rounded-t-3xl text-center">
                <span className="font-bold text-white tracking-[0.2em] text-[16px]">RUNTIME</span>
                <span className="text-[#38d6a3] text-[9px] uppercase tracking-widest font-bold">Local Execution Plane</span>
             </div>
          </div>

          {/* gRPC Node */}
          <div className="absolute top-[535px] left-[710px] w-[200px] h-[32px] bg-[#0A0D14] rounded-xl flex items-center justify-center border border-[#38d6a3]/40 shadow-[0_0_20px_rgba(56,214,163,0.15)] z-10 transition-transform hover:-translate-y-1">
            <div className="absolute inset-0 bg-[#38d6a3]/10 rounded-xl" />
            <span className="font-bold tracking-widest text-[10px] text-[#38d6a3] relative z-10 uppercase">gRPC</span>
          </div>

          {/* Runtime Capability Nodes */}
          {[
            { id: 'AI Models', y: 250, icon: '\u{1F9E0}', color: '#0ea5e9' },
            { id: 'Workflows', y: 320, icon: '\u{26A1}',   color: '#8b5cf6' },
            { id: 'Knowledge', y: 390, icon: '\u{1F4DA}', color: '#f43f5e' },
          ].map(sat => (
            <div key={sat.id} className="absolute left-[690px] w-[240px] h-[48px] bg-[#111827] border border-white/10 rounded-xl flex items-center px-4 shadow-[0_4px_15px_rgba(0,0,0,0.5)] transition-all hover:bg-white/[0.05] hover:translate-x-1 hover:border-white/30 z-10 cursor-default" style={{ top: sat.y }}>
               <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center mr-4 text-[16px] shadow-inner" style={{ color: sat.color }}>{sat.icon}</div>
               <span className="text-[13px] font-bold text-slate-300 transition-colors tracking-widest uppercase">{sat.id}</span>
            </div>
          ))}

          {/* Bottom Row - Cross-World Journey */}
          {[
            { id: 'Unified Account', x: 50, icon: '\u{1F464}' },
            { id: 'Shared Data', x: 200, icon: '\u{1F4BE}' },
            { id: 'Shared Authorization', x: 350, icon: '\u{1F512}' },
            { id: 'Persistent Cross-World Presence', x: 500, icon: '\u{1F310}' },
            { id: 'Multi-World Exploration', x: 650, icon: '\u{1F9ED}' },
            { id: 'Seamless AI Experience', x: 800, icon: '\u{2728}' },
          ].map(sat => (
            <div key={sat.id} className="absolute top-[600px] w-[140px] flex flex-col items-center text-center group cursor-default" style={{ left: sat.x }}>
               <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3 text-[18px] border border-white/10 shadow-[0_4px_10px_rgba(0,0,0,0.3)] transition-transform group-hover:-translate-y-1 grayscale group-hover:grayscale-0 group-hover:bg-white/[0.08] group-hover:border-white/30">
                 {sat.icon}
               </div>
               <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 group-hover:text-white leading-tight transition-colors">{sat.id}</span>
            </div>
          ))}

          </div>
        </div>

        {/* Mobile Fallback */}
        <div className="relative z-10 mx-auto px-4 sm:px-6 lg:hidden flex flex-col gap-6 max-w-md mb-16">
           <div className="bg-[#111827] rounded-3xl border border-white/10 p-8 shadow-xl">
              <div className="w-12 h-12 bg-gradient-to-r from-[#0ea5e9] to-[#8b5cf6] rounded-xl flex items-center justify-center font-bold text-white shadow-lg mb-4">SDK</div>
              <h3 className="text-xl font-heading font-bold text-white mb-2">@nimi/sdk</h3>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">Single surface connecting to local and cloud intelligence.</p>
           </div>
           
           <div className="flex items-center justify-center text-slate-500">
             <svg className="w-6 h-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
           </div>

           <div className="bg-gradient-to-br from-[#0A0D14] to-[#111827] rounded-3xl border border-[#0ea5e9]/20 p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-[#0ea5e9]/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="text-xl font-heading font-bold text-[#0ea5e9] mb-2 tracking-widest uppercase">REALM</h3>
              <p className="text-[11px] text-[#0ea5e9]/70 uppercase tracking-widest font-bold mb-6">Cloud Context</p>
              <div className="flex flex-wrap gap-2">
                {['Worlds', 'Agents', 'Social', 'Economy', 'Memory', 'Identity'].map(n => <span key={n} className="px-3 py-1 bg-white/[0.05] border border-white/10 rounded-full text-xs font-bold text-slate-300 shadow-sm">{n}</span>)}
              </div>
           </div>

           <div className="bg-gradient-to-br from-[#0A0D14] to-[#111827] rounded-3xl border border-[#38d6a3]/20 p-8 shadow-xl relative overflow-hidden">
              <div className="absolute top-[-20%] right-[-10%] w-32 h-32 bg-[#38d6a3]/20 blur-2xl rounded-full pointer-events-none" />
              <h3 className="text-xl font-heading font-bold text-[#38d6a3] mb-2 tracking-widest uppercase">RUNTIME</h3>
              <p className="text-[11px] text-[#38d6a3]/70 uppercase tracking-widest font-bold mb-6">Local Compute</p>
              <div className="flex flex-wrap gap-2">
                {['AI Models', 'Workflows', 'Knowledge'].map(n => <span key={n} className="px-3 py-1 bg-[#38d6a3]/[0.05] border border-[#38d6a3]/20 rounded-full text-xs font-bold text-slate-300 shadow-sm">{n}</span>)}
              </div>
           </div>
        </div>

        {/* Text Segments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto items-stretch mb-20 relative z-20">
          <div className="glass-panel p-8 sm:p-10 rounded-3xl group transition-colors duration-500 hover:bg-[#111827]/90 border hover:border-[#0ea5e9]/30 border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#0ea5e9]/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100" />
            
            <h3 className="text-2xl font-bold text-white mb-6 tracking-tight flex items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-[#0ea5e9]/10 flex items-center justify-center text-[#0ea5e9] shrink-0 border border-[#0ea5e9]/20 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(14,165,233,0.15)]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
              </span>
              {content.devTitle}
            </h3>
            <p className="text-slate-400 leading-[1.8] font-medium text-[15px] sm:text-[16px]">
              {content.devText}
            </p>
          </div>

          <div className="glass-panel p-8 sm:p-10 rounded-3xl group transition-colors duration-500 hover:bg-[#111827]/90 border hover:border-[#38d6a3]/30 border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-[#38d6a3]/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100" />

            <h3 className="text-2xl font-bold text-white mb-6 tracking-tight flex items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-[#38d6a3]/10 flex items-center justify-center text-[#38d6a3] shrink-0 border border-[#38d6a3]/20 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_20px_rgba(56,214,163,0.15)]">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              </span>
              {content.userTitle}
            </h3>
            <p className="text-slate-400 leading-[1.8] font-medium text-[15px] sm:text-[16px]">
              {content.userText}
            </p>
          </div>
        </div>
        
        <div className="text-center max-w-3xl mx-auto relative z-20">
           <h4 className="text-xl sm:text-2xl font-bold text-white mb-6 tracking-tight">
             {content.conclusion}
           </h4>
           <div className="inline-flex items-center px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-white font-medium text-[15px] tracking-wide shadow-2xl backdrop-blur-sm group hover:bg-white/[0.06] transition-colors">
              <span className="w-2 h-2 rounded-full bg-[#0ea5e9] mr-3 animate-pulse shadow-[0_0_10px_#0ea5e9]" />
              <span className="opacity-90">{content.slogan}</span>
           </div>
        </div>

      </div>
    </section>
  );
}
