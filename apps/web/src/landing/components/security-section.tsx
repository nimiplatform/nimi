import { useEffect, useRef } from 'react';
import type { LandingContent } from '../content/landing-content.js';

export type SecuritySectionProps = {
  content: LandingContent['security'];
};

export function SecuritySection({ content }: SecuritySectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const netPathRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const netPath = netPathRef.current;

    if (!section || !netPath) return;

    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      const translateX = (x - 0.5) * 20;
      const translateY = (y - 0.5) * 20;
      netPath.style.transform = `rotate(-15deg) translate(${translateX}px, ${translateY}px)`;
    };

    section.addEventListener('mousemove', handleMouseMove);
    return () => section.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const cardThemes = [
    {
      cardClass: 'group hover:-translate-y-3 hover:scale-[1.02] hover:bg-white hover:border-[#2dd4bf]/40 hover:shadow-[0_25px_50px_-20px_rgba(45,212,191,0.25)]',
      eyebrowClass: 'text-[#0d9488] bg-[#e0fdfa]',
      bulletColor: '#2dd4bf',
      pulseClass: 'group-hover:animate-[pulse-dot-cyan_2s_infinite]',
      svg: (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
            <circle cx="25" cy="50" r="12" fill="#2dd4bf" opacity="0.1">
                <animate attributeName="r" values="10;14;10" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="75" cy="50" r="12" fill="#f472b6" opacity="0.1">
                <animate attributeName="r" values="12;10;12" dur="3s" repeatCount="indefinite" />
            </circle>
            
            <path d="M25,50 Q50,30 75,50" stroke="#0f172a" strokeWidth="2" fill="none" opacity="0.5"/>
            
            <circle cx="0" cy="0" r="2.5" fill="#2dd4bf">
                <animateMotion path="M25,50 Q50,30 75,50" dur="2s" repeatCount="indefinite" />
            </circle>
            
            <path d="M45,20 L55,20 L55,80 L45,80 Z" fill="#2dd4bf" stroke="#2dd4bf" strokeWidth="1.5"/>
            <circle cx="50" cy="50" r="10" fill="#fff" stroke="#2dd4bf" strokeWidth="2.5"/>
            <path d="M47,43 L53,43 L50,57 Z" fill="#2dd4bf"/>
        </svg>
      )
    },
    {
      cardClass: 'group hover:-translate-y-3 hover:scale-[1.02] hover:bg-white hover:border-[#f472b6]/40 hover:shadow-[0_25px_50px_-20px_rgba(244,114,182,0.25)]',
      eyebrowClass: 'text-[#db2777] bg-[#fce7f3]',
      bulletColor: '#f472b6',
      pulseClass: 'group-hover:animate-[pulse-dot-pink_2s_infinite]',
      svg: (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
            <circle cx="50" cy="50" r="30" fill="none" stroke="#f472b6" strokeWidth="1" opacity="0.3">
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="8s" repeatCount="indefinite" />
            </circle>
            <circle cx="50" cy="50" r="15" fill="#f472b6" opacity="0.8"/>
            
            <path d="M42,50 L58,50 L58,62 L42,62 Z" fill="#fff"/>
            <path d="M45,46 Q50,40 55,46" fill="none" stroke="#fff" strokeWidth="2"/>
            
            <g>
                <circle cx="50" cy="20" r="3" fill="#fbbf24">
                    <animate attributeName="fillOpacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
                </circle>
                <circle cx="50" cy="80" r="3" fill="#fbbf24">
                    <animate attributeName="fillOpacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite"/>
                </circle>
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="10s" repeatCount="indefinite" />
            </g>
        </svg>
      )
    },
    {
      cardClass: 'group hover:-translate-y-3 hover:scale-[1.02] hover:bg-white hover:border-[#a855f7]/40 hover:shadow-[0_25px_50px_-20px_rgba(168,85,247,0.25)]',
      eyebrowClass: 'text-[#7e22ce] bg-[#f3e8ff]',
      bulletColor: '#a855f7',
      pulseClass: 'group-hover:animate-[pulse-dot-purple_2s_infinite]',
      svg: (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
            <circle cx="50" cy="50" r="10" fill="#a855f7">
                <animate attributeName="r" values="8;14;8" dur="1.5s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/>
            </circle>
            
            <g opacity="0.7" fill="none" stroke="#a855f7" strokeWidth="1.5">
                <path d="M50 20 L75 35 L75 65 L50 80 L25 65 L25 35 Z">
                    <animate attributeName="strokeDasharray" values="0,150; 150,0" dur="2s" repeatCount="indefinite" begin="0.2s"/>
                </path>
                <path d="M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z" opacity="0.4">
                    <animate attributeName="strokeDasharray" values="150,0; 0,150" dur="2s" repeatCount="indefinite"/>
                </path>
            </g>
            
            <path d="M50,15 L50,5 M48,10 L52,10" fill="none" stroke="#fbbf24" strokeWidth="2">
                <animate attributeName="transform" type="translate" values="0,10; 0,0" dur="1s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0;1;0" dur="1s" repeatCount="indefinite"/>
            </path>
        </svg>
      )
    }
  ];

  return (
    <section
      id="security"
      ref={sectionRef} 
      className="relative overflow-hidden border-t border-white/10 bg-gradient-to-br from-[#f0fdfa] via-[#f8fafc] to-[#e0f2fe] section-pad"
    >
      <style>{`
        @keyframes fadeInDown {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-dot-cyan {
          0% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(45, 212, 191, 0); }
          100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0); }
        }
        @keyframes pulse-dot-pink {
          0% { box-shadow: 0 0 0 0 rgba(244, 114, 182, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(244, 114, 182, 0); }
          100% { box-shadow: 0 0 0 0 rgba(244, 114, 182, 0); }
        }
        @keyframes pulse-dot-purple {
          0% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(168, 85, 247, 0); }
          100% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0); }
        }
      `}</style>

      {/* Top glowing line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] opacity-70" style={{ background: 'linear-gradient(90deg, transparent, #2dd4bf, #a855f7, transparent)' }} />
      
      {/* Background Elements */}
      <div className="absolute inset-0 opacity-10 pointer-events-none z-0">
        <svg 
          ref={netPathRef}
          className="absolute w-[120%] h-[120%] -top-[10%] -left-[10%] stroke-[#2dd4bf] stroke-[0.5] fill-none transition-transform duration-75 ease-out" 
          style={{ strokeDasharray: '4 8', transform: 'rotate(-15deg)' }}
          viewBox="0 0 100 100" 
          preserveAspectRatio="none"
        >
          <path d="M0,20 Q25,30 50,20 T100,20" />
          <path d="M0,50 Q25,60 50,50 T100,50" />
          <path d="M0,80 Q25,90 50,80 T100,80" />
        </svg>
      </div>

      <div className="relative z-10 max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div 
          className="text-center mb-20 max-w-[800px] mx-auto opacity-0 translate-y-5"
          style={{ animation: 'fadeInDown 0.8s ease-out forwards 0.2s' }}
        >
          <h2 className="text-[2.8rem] sm:text-[3.5rem] font-bold text-[#0f172a] mb-4 tracking-[-0.03em] leading-[1.1]">
            {content.title}
          </h2>
          {content.subtitle && (
            <div className="text-[1.35rem] text-[#1e293b] font-semibold mb-4 leading-relaxed">
              {content.subtitle}
            </div>
          )}
          {content.intro && (
            <p className="text-[1.125rem] text-[#64748b] leading-relaxed">
              {content.intro}
            </p>
          )}
        </div>

        {/* Security Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10" style={{ perspective: 1000 }}>
          {content.pillars.map((pillar, index) => {
            const theme = cardThemes[index % cardThemes.length]!;
            return (
              <div 
                key={pillar.title}
                className={`flex flex-col items-center flex-1 text-center bg-white/95 border border-white/50 rounded-[20px] p-8 sm:p-10 shadow-[0_15px_40px_-15px_rgba(15,23,42,0.05)] transition-all duration-500 opacity-0 translate-y-8 ${theme.cardClass}`}
                style={{ animation: `fadeInUp 0.8s ease-out forwards ${0.4 + index * 0.2}s` }}
              >
                {/* Visual SVG Container */}
                <div className="w-[120px] h-[120px] sm:w-[140px] sm:h-[140px] mb-8 relative flex items-center justify-center">
                  {theme.svg}
                </div>

                {/* Content */}
                <div className="w-full flex-grow flex flex-col items-center">
                  <span className={`text-[0.8rem] font-bold uppercase tracking-[0.12em] mb-5 py-1 px-3 rounded-xl inline-block ${theme.eyebrowClass}`}>
                    {pillar.label}
                  </span>
                  <h3 className="text-[1.5rem] sm:text-[1.75rem] font-bold text-[#1e293b] mb-7 leading-tight tracking-[-0.01em]">
                    {pillar.title}
                  </h3>
                  
                  <ul className="text-left w-full space-y-4 m-0 p-0 list-none">
                    {pillar.points.map((point, pointIndex) => (
                      <li key={pointIndex} className="relative pl-8 text-[0.95rem] text-[#64748b] leading-relaxed">
                        <span 
                          className={`absolute left-0 top-[6px] w-[10px] h-[10px] rounded-full shadow-[0_0_0_rgba(45,212,191,0.4)] ${theme.pulseClass}`}
                          style={{ backgroundColor: theme.bulletColor }}
                        />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
