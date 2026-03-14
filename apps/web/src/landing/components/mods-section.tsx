import { useEffect, useMemo, useState, type SVGProps } from 'react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';
import type { LandingLocale } from '../i18n/locale.js';
import audioBookLogoUrl from '../assets/mod-logos/audio-book.svg';
import buddyLogoUrl from '../assets/mod-logos/buddy.svg';
import dailyOutfitLogoUrl from '../assets/mod-logos/daily-outfit.svg';
import kismetLogoUrl from '../assets/mod-logos/kismet.svg';
import knowledgeBaseLogoUrl from '../assets/mod-logos/knowledge-base.svg';
import localChatLogoUrl from '../assets/mod-logos/local-chat.svg';
import mintYouLogoUrl from '../assets/mod-logos/mint-you.svg';
import textplayLogoUrl from '../assets/mod-logos/textplay.svg';
import videoplayLogoUrl from '../assets/mod-logos/videoplay.svg';
import worldStudioLogoUrl from '../assets/mod-logos/world-studio.svg';

export type ModsSectionProps = {
  content: LandingContent['mods'];
  links: LandingLinks;
  locale: LandingLocale;
};

type LandingModItem = LandingContent['mods']['items'][number] & {
  label?: string;
  depth: 'back' | 'mid' | 'front';
  color: string;
};

const MOD_IMAGE_LOGOS: Record<string, string> = {
  'audio-book': audioBookLogoUrl,
  Buddy: buddyLogoUrl,
  'daily-outfit': dailyOutfitLogoUrl,
  kismet: kismetLogoUrl,
  'knowledge-base': knowledgeBaseLogoUrl,
  'local-chat': localChatLogoUrl,
  'mint-you': mintYouLogoUrl,
  textplay: textplayLogoUrl,
  videoplay: videoplayLogoUrl,
  'world-studio': worldStudioLogoUrl,
};


const MOD_DEPTH_STYLES: Record<LandingModItem['depth'], string> = {
  back: 'scale-[0.74] blur-[3px] brightness-[0.6]',
  mid: 'scale-[0.86] blur-[1.3px] brightness-[0.82]',
  front: 'scale-[1.03] shadow-[0_18px_44px_rgba(0,0,0,0.52),0_0_18px_rgba(255,255,255,0.05)]',
};

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M9 10h.01" />
      <path d="M12 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  );
}

function SimIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19h16" />
      <path d="M7 15V9" />
      <path d="M12 15V5" />
      <path d="M17 15v-3" />
    </svg>
  );
}

function StoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function AudioIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="4" width="15" height="16" rx="2" />
      <path d="m17 10 5-3v10l-5-3z" />
    </svg>
  );
}

function DocsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CompanionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M18.5 4.5 20 3l1 1-1.5 1.5" />
    </svg>
  );
}

function StyleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 4h12l1 5-7 11L5 9l1-5Z" />
      <path d="M9 4a3 3 0 0 0 6 0" />
    </svg>
  );
}

function IdentityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 4 7v6c0 5 3.5 7.5 8 8 4.5-.5 8-3 8-8V7l-8-4Z" />
      <path d="m9.5 12 1.7 1.7 3.8-4.2" />
    </svg>
  );
}

function WorldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15.3 15.3 0 0 1 0 18" />
      <path d="M12 3a15.3 15.3 0 0 0 0 18" />
    </svg>
  );
}

function ModGlyph(props: { icon: string; className?: string }) {
  switch (props.icon) {
    case 'chat':
      return <ChatIcon className={props.className} />;
    case 'sim':
      return <SimIcon className={props.className} />;
    case 'story':
      return <StoryIcon className={props.className} />;
    case 'audio':
      return <AudioIcon className={props.className} />;
    case 'video':
      return <VideoIcon className={props.className} />;
    case 'docs':
      return <DocsIcon className={props.className} />;
    case 'companion':
      return <CompanionIcon className={props.className} />;
    case 'style':
      return <StyleIcon className={props.className} />;
    case 'identity':
      return <IdentityIcon className={props.className} />;
    case 'world':
      return <WorldIcon className={props.className} />;
    default:
      return <span className={props.className}>{props.icon}</span>;
  }
}

export function ModsSection(props: ModsSectionProps) {
  const isChinese = props.locale === 'zh';
  const [activeModName, setActiveModName] = useState<string | null>(null);

  const mods = useMemo<LandingModItem[]>(() => {
    const baseItems: LandingModItem[] = props.content.items.map((item, index) => ({
      ...item,
      label: index < 3 ? 'Starter mod' : 'Desktop mod',
      depth: (['back', 'mid', 'front', 'front', 'mid', 'back'][index] ?? 'mid') as LandingModItem['depth'],
      color: ({
        chat: '#5ad7ff',
        sim: '#4ade80',
        audio: '#b67cff',
        video: '#ff6b9b',
        story: '#f59e0b',
        docs: '#60a5fa',
      } as Record<string, string>)[item.icon] ?? '#ffffff',
    }));

    const extraItems: LandingModItem[] = isChinese
      ? [
          {
            icon: 'companion',
            name: 'Buddy',
            description: 'Live2D 角色陪伴 mod，可通过文字和语音与用户互动。',
            label: 'New in desktop',
            depth: 'mid',
            color: '#67e8f9',
          },
          {
            icon: 'style',
            name: 'daily-outfit',
            description: 'AI 辅助衣橱整理与每日穿搭规划，支持本地优先的衣物档案与历史记录。',
            label: 'New in desktop',
            depth: 'front',
            color: '#fb7185',
          },
          {
            icon: 'identity',
            name: 'mint-you',
            description: '围绕人格画像与社交人格代理创建的体验入口。',
            label: 'New in desktop',
            depth: 'front',
            color: '#4ade80',
          },
          {
            icon: 'world',
            name: 'world-studio',
            description: '面向世界设定、草稿与维护流程的世界工坊。',
            label: 'New in desktop',
            depth: 'mid',
            color: '#7dd3fc',
          },
        ]
      : [
          {
            icon: 'companion',
            name: 'Buddy',
            description: 'A Live2D companion mod for text and voice interaction inside the desktop workspace.',
            label: 'New in desktop',
            depth: 'mid',
            color: '#67e8f9',
          },
          {
            icon: 'style',
            name: 'daily-outfit',
            description: 'AI-assisted wardrobe organization and outfit planning with local-first history and closet insights.',
            label: 'New in desktop',
            depth: 'front',
            color: '#fb7185',
          },
          {
            icon: 'identity',
            name: 'mint-you',
            description: 'Behavioral personality profiling and agent creation for social-persona workflows.',
            label: 'New in desktop',
            depth: 'front',
            color: '#4ade80',
          },
          {
            icon: 'world',
            name: 'world-studio',
            description: 'A world-building studio for drafts, events, lorebooks, and maintenance flows.',
            label: 'New in desktop',
            depth: 'mid',
            color: '#7dd3fc',
          },
        ];

    const modsByName = new Map(
      [...baseItems, ...extraItems].map((item) => [item.name, item] as const),
    );
    const orderedNames = [
      'audio-book',
      'textplay',
      'local-chat',
      'kismet',
      'videoplay',
      'knowledge-base',
      'Buddy',
      'mint-you',
      'daily-outfit',
      'world-studio',
    ];
    const orderedDepths: LandingModItem['depth'][] = [
      'back',
      'mid',
      'front',
      'front',
      'mid',
      'back',
      'mid',
      'front',
      'front',
      'mid',
    ];

    return orderedNames
      .map((name, index) => {
        const item = modsByName.get(name);
        return item ? { ...item, depth: orderedDepths[index] ?? item.depth } : null;
      })
      .filter((item): item is LandingModItem => Boolean(item));
  }, [isChinese, props.content.items]);

  const activeMod = activeModName
    ? mods.find((item) => item.name === activeModName) ?? null
    : null;

  const topRow = mods.slice(0, 6);
  const bottomRow = mods.slice(6, 10);

  useEffect(() => {
    if (!activeMod) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveModName(null);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeMod]);

  return (
    <section
      id="mods"
      className="relative overflow-hidden bg-[radial-gradient(circle_at_top_center,#0a0a10_0%,#000000_100%)] px-4 py-24 text-white sm:px-6 lg:px-8 lg:py-28"
    >
      <div className="pointer-events-none absolute left-1/2 top-[28%] h-[31rem] w-[50rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(135deg,rgba(16,185,129,0.24)_0%,rgba(59,130,246,0.24)_100%)] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-16%] left-[-18%] h-[38vh] w-[68vw] rounded-[60%_40%_30%_70%/60%_30%_70%_40%] bg-[radial-gradient(ellipse_at_center,rgba(30,60,90,0.38)_0%,transparent_70%)] opacity-60 blur-[100px]" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[34vh] w-[58vw] rounded-[40%_60%_70%_30%/40%_50%_60%_50%] bg-[radial-gradient(ellipse_at_center,rgba(20,70,80,0.3)_0%,transparent_70%)] opacity-60 blur-[100px]" />

      <div className="container-nimi relative z-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#63f0cf]">
            Ecosystem surface
          </p>
          <h2 className="mt-6 bg-[linear-gradient(180deg,#ffffff_0%,#a0a0a0_100%)] bg-clip-text font-heading text-4xl font-bold tracking-[-0.04em] text-transparent sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
            {isChinese ? '所有 Mod，一个运行时' : 'Every mod, one runtime'}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-[#888890]">
            {isChinese
              ? '已接入桌面端的 Mods，覆盖聊天、知识、叙事、音频、视频等场景。点击任意 Mod 了解详情。'
              : 'Mods already shipping in Nimi desktop — chat, knowledge, narrative, audio, video, and more. Click any to explore.'}
          </p>
        </div>

        <div className={`mt-16 flex flex-col items-center gap-8 ${activeMod ? 'lg:flex-row lg:items-start lg:justify-center' : ''}`}>
          {/* Mod grid */}
          <div className="flex flex-col items-center gap-7">
            <div className="flex flex-wrap items-center justify-center gap-4 lg:flex-nowrap">
              {topRow.map((mod, index) => {
                const imageSrc = MOD_IMAGE_LOGOS[mod.name];
                return (
                  <div
                    key={mod.name}
                    className="animate-[mod-float_3.2s_ease-in-out_infinite]"
                    style={{ animationDelay: `-${(index * 0.65).toFixed(2)}s` }}
                  >
                    <button
                      type="button"
                      aria-label={`Open ${mod.name}`}
                      onClick={() => setActiveModName(activeModName === mod.name ? null : mod.name)}
                      className={[
                        'group relative flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-[1.4rem] border bg-[rgba(25,25,30,0.5)] text-white shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[16px] transition duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:z-20 hover:scale-[1.2] hover:-translate-y-2 hover:brightness-[1.18] hover:blur-0 hover:shadow-[0_25px_50px_rgba(0,0,0,0.8),0_0_30px_rgba(16,185,129,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] sm:h-[5.7rem] sm:w-[5.7rem]',
                        activeModName === mod.name
                          ? 'border-[rgba(99,240,207,0.55)] shadow-[0_0_28px_rgba(99,240,207,0.45),0_10px_30px_rgba(0,0,0,0.4)]'
                          : 'border-white/8',
                        MOD_DEPTH_STYLES[mod.depth],
                      ].join(' ')}
                      style={{ color: mod.color }}
                    >
                      {imageSrc ? (
                        <div className="flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-[1rem] bg-white/[0.03] p-1">
                          <img
                            src={imageSrc}
                            alt={`${mod.name} logo`}
                            className="h-full w-full object-contain transition duration-300 group-hover:scale-110"
                          />
                        </div>
                      ) : (
                        <ModGlyph icon={mod.icon} className="h-10 w-10 transition duration-300 group-hover:scale-110" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 lg:flex-nowrap">
              {bottomRow.map((mod, index) => {
                const imageSrc = MOD_IMAGE_LOGOS[mod.name];
                return (
                  <div
                    key={mod.name}
                    className="animate-[mod-float_3.2s_ease-in-out_infinite]"
                    style={{ animationDelay: `-${(index * 0.65 + 0.32).toFixed(2)}s` }}
                  >
                    <button
                      type="button"
                      aria-label={`Open ${mod.name}`}
                      onClick={() => setActiveModName(activeModName === mod.name ? null : mod.name)}
                      className={[
                        'group relative flex h-[5.25rem] w-[5.25rem] items-center justify-center rounded-[1.4rem] border bg-[rgba(25,25,30,0.5)] text-white shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[16px] transition duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:z-20 hover:scale-[1.2] hover:-translate-y-2 hover:brightness-[1.18] hover:blur-0 hover:shadow-[0_25px_50px_rgba(0,0,0,0.8),0_0_30px_rgba(16,185,129,0.2),inset_0_1px_0_rgba(255,255,255,0.18)] sm:h-[5.7rem] sm:w-[5.7rem]',
                        activeModName === mod.name
                          ? 'border-[rgba(99,240,207,0.55)] shadow-[0_0_28px_rgba(99,240,207,0.45),0_10px_30px_rgba(0,0,0,0.4)]'
                          : 'border-white/8',
                        MOD_DEPTH_STYLES[mod.depth],
                      ].join(' ')}
                      style={{ color: mod.color }}
                    >
                      {imageSrc ? (
                        <div className="flex h-[3.1rem] w-[3.1rem] items-center justify-center rounded-[1rem] bg-white/[0.03] p-1">
                          <img
                            src={imageSrc}
                            alt={`${mod.name} logo`}
                            className="h-full w-full object-contain transition duration-300 group-hover:scale-110"
                          />
                        </div>
                      ) : (
                        <ModGlyph icon={mod.icon} className="h-10 w-10 transition duration-300 group-hover:scale-110" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex justify-center">
              <a
                href={props.links.modDocsUrl}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex cursor-pointer select-none items-center gap-3 rounded-full border border-white/10 bg-white/[0.03] px-8 py-3.5 text-[1.05rem] font-medium tracking-[0.02em] text-white shadow-[0_4px_15px_rgba(0,0,0,0.2)] backdrop-blur-[12px] transition duration-300 hover:-translate-y-0.5 hover:border-[rgba(16,185,129,0.5)] hover:bg-white/[0.08] hover:shadow-[0_8px_25px_rgba(16,185,129,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 fill-none stroke-current stroke-2 transition duration-300 group-hover:rotate-90"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>{props.content.buildModCta}</span>
              </a>
            </div>
          </div>

          {/* Detail panel — slides in to the right */}
          {activeMod && (
            <div
              key={activeMod.name}
              className="relative w-full max-w-sm shrink-0 animate-[slide-in-right_0.22s_ease-out] rounded-[1.5rem] border border-[rgba(16,185,129,0.28)] bg-[rgba(8,18,13,0.78)] p-7 shadow-[0_0_60px_rgba(16,185,129,0.18),0_20px_60px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(16,185,129,0.12)] backdrop-blur-[28px] lg:w-[22rem]"
            >
              {/* Green glow ring */}
              <div className="pointer-events-none absolute inset-0 rounded-[1.5rem] bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.08)_0%,transparent_60%)]" />

              <button
                type="button"
                onClick={() => setActiveModName(null)}
                className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-white/6 text-slate-400 transition hover:bg-[rgba(16,185,129,0.15)] hover:text-[#63f0cf]"
                aria-label="Close mod details"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div className="relative flex items-start gap-4">
                {/* 2×2 frosted grid icon — height stretches to match text column */}
                <div
                  className="flex min-w-[3.4rem] shrink-0 self-stretch items-center justify-center border border-white/10 bg-white/[0.05] px-2 backdrop-blur-[10px]"
                  style={{ color: activeMod.color }}
                >
                  <div className="grid grid-cols-2 gap-[5px]">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex h-[1.45rem] w-[1.45rem] items-center justify-center bg-white/[0.08]"
                      >
                        {MOD_IMAGE_LOGOS[activeMod.name] ? (
                          <img
                            src={MOD_IMAGE_LOGOS[activeMod.name]}
                            alt=""
                            className="h-[0.95rem] w-[0.95rem] object-contain opacity-70"
                          />
                        ) : (
                          <ModGlyph icon={activeMod.icon} className="h-3 w-3 opacity-55" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold tracking-tight text-white">
                    {activeMod.name}
                  </h3>
                  <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#63f0cf]/70">
                    {activeMod.label ?? activeMod.icon}
                  </p>
                </div>
              </div>

              <p className="relative mt-5 text-sm leading-7 text-slate-300">
                {activeMod.description}
              </p>

            </div>
          )}
        </div>
      </div>
    </section>
  );
}
