import { useContext, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  Compass,
  Lock,
  Moon,
  Pause,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { withLocaleQuery } from '../../config/landing-links.js';
import type { StoryText } from '../../content/story-copy.js';
import { DEFAULT_STORY_AGENT } from '../../content/story-model.js';
import {
  createUtopiaPreviewContent,
  type UtopiaHabitatId,
} from '../../content/landing-content.utopia.js';
import { DemoSessionContext } from '../hero-demo-context.js';
import { UtopiaMiniChibiSvg, useUtopiaWalkers } from '../demo-utopia-preview.js';
import { PublicSiteLink } from '../../../pages/public-site-shell.js';
import { useVoiceSample } from './use-voice-sample.js';

type PillarId = 'utopia' | 'origin' | 'embodiment';

type VoiceCharacter = {
  id: string;
  name: string;
  world: string;
  role: string;
  avatarSrc: string;
  portraitSrc: string;
  backdropSrc: string;
  voiceUrl: string;
  duration: string;
  quote: string;
};

const VOICE_CHARACTERS: Record<'zh' | 'en', ReadonlyArray<VoiceCharacter>> = {
  zh: [
    {
      id: 'heguan',
      name: '禾罐',
      world: '瓷炭院',
      role: '砖画创作者 · 青绿釉陶偶',
      avatarSrc: '/demo/explore/emberware-court-character-0.png',
      portraitSrc: '/story/heguan-cutout-v2.webp',
      backdropSrc: '/demo/explore/emberware-court-cover.png',
      voiceUrl: '/demo/explore/heguan-voice.mp3',
      duration: '0:14',
      quote: '“急不得。等这道斜阳移到第三格窗棂，阴影最深的时候，我才好拿矿彩点出檐下的烟痕。”',
    },
    {
      id: 'liuwenxing',
      name: '柳问荇',
      world: '行脉诸洲',
      role: '石渠退修前辈 · 水岸看守人',
      avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
      portraitSrc: '/demo/explore/meridian-archipelago-character-0.png',
      backdropSrc: '/demo/explore/meridian-archipelago-cover.webp',
      voiceUrl: '/demo/explore/liuwenxing-voice.mp3',
      duration: '0:10',
      quote: '“地脉不是井水，你这头多抽一口，下游三道闸口就得断流。慢下来，按规矩查验。”',
    },
    {
      id: 'peiyu',
      name: '佩榆阿姨',
      world: '瓷炭院',
      role: '老院住户 · 地方刊物撰稿人',
      avatarSrc: '/demo/explore/emberware-court-character-1.png',
      portraitSrc: '/demo/explore/emberware-court-character-1.png',
      backdropSrc: '/demo/explore/emberware-court-cover.png',
      voiceUrl: '/demo/explore/peiyu-voice.mp3',
      duration: '0:18',
      quote: '“禾罐一早就在廊檐下对光看砖，小炉火上还坐着温水呢。过日子就是这慢火候。”',
    },
  ],
  en: [
    {
      id: 'heguan',
      name: 'Heguan',
      world: 'Emberware Court',
      role: 'Brick artist · Glazed clay folk',
      avatarSrc: '/demo/explore/emberware-court-character-0.png',
      portraitSrc: '/story/heguan-cutout-v2.webp',
      backdropSrc: '/demo/explore/emberware-court-cover.png',
      voiceUrl: '/demo/explore/heguan-voice.mp3',
      duration: '0:14',
      quote: '“Can’t rush it. When the sunlight reaches the third lattice pane, I can dab in the soot under the eaves.”',
    },
    {
      id: 'liuwenxing',
      name: 'Liu Wenxing',
      world: 'Meridian Archipelago',
      role: 'Retired canal negotiator',
      avatarSrc: '/demo/explore/meridian-archipelago-character-0.png',
      portraitSrc: '/demo/explore/meridian-archipelago-character-0.png',
      backdropSrc: '/demo/explore/meridian-archipelago-cover.webp',
      voiceUrl: '/demo/explore/liuwenxing-voice.mp3',
      duration: '0:10',
      quote: '“The earth’s currents aren’t well water—draw extra here and three locks downstream run dry. Take it steady.”',
    },
    {
      id: 'peiyu',
      name: 'Auntie Peiyu',
      world: 'Emberware Court',
      role: 'Courtyard neighbor & columnist',
      avatarSrc: '/demo/explore/emberware-court-character-1.png',
      portraitSrc: '/demo/explore/emberware-court-character-1.png',
      backdropSrc: '/demo/explore/emberware-court-cover.png',
      voiceUrl: '/demo/explore/peiyu-voice.mp3',
      duration: '0:18',
      quote: '“Heguan’s been studying a brick under the eaves since morning, with warm water on the stove. Life goes over a low flame.”',
    },
  ],
};

export function StoryCompanionShowcase({
  locale,
  t,
}: {
  locale: 'zh' | 'en';
  t: StoryText;
}) {
  const [activePillar, setActivePillar] = useState<PillarId>('utopia');
  const [charIndex, setCharIndex] = useState(0);
  const [habitatId, setHabitatId] = useState<UtopiaHabitatId>('seaside-island');
  const [tunedByHabitat, setTunedByHabitat] = useState<Partial<Record<UtopiaHabitatId, boolean>>>({});
  const [allowCheckIn, setAllowCheckIn] = useState(false);
  const session = useContext(DemoSessionContext);
  const voice = useVoiceSample();

  const utopiaContent = createUtopiaPreviewContent(locale);
  const habitat =
    utopiaContent.habitats.find((item) => item.id === habitatId) ?? utopiaContent.habitats[0]!;
  const isTuned = Boolean(tunedByHabitat[habitat.id]);
  const walkerFrames = useUtopiaWalkers(
    habitat.id,
    habitat.residents,
    isTuned,
    false,
    activePillar !== 'utopia',
  );

  const characters = VOICE_CHARACTERS[locale];
  const currentChar = characters[charIndex] ?? characters[0]!;
  const isPlaying = voice.playingUrl === currentChar.voiceUrl;

  const pillars: ReadonlyArray<{
    id: PillarId;
    Icon: typeof Volume2;
    title: string;
    body: string;
  }> = [
    {
      id: 'utopia',
      Icon: Sparkles,
      title: t('agents.utopiaTitle'),
      body: t('agents.utopiaBody'),
    },
    {
      id: 'origin',
      Icon: Volume2,
      title: t('agents.originTitle'),
      body: t('agents.originBody'),
    },
    {
      id: 'embodiment',
      Icon: Compass,
      title: t('agents.embodimentTitle'),
      body: t('agents.embodimentBody'),
    },
  ];

  return (
    <section
      id="local-agents"
      className="story-section story-agents"
      aria-labelledby="agents-heading"
      data-story-scene
    >
      <div className="story-container">
        <header className="story-heading story-agents-heading">
          <h2 id="agents-heading">{t('agents.title')}</h2>
        </header>

        <div className="story-companion-showcase">
          <div className="story-companion-stage" data-active-scene={activePillar}>
            {activePillar === 'utopia' && (
              <div className="story-companion-scene story-companion-scene--utopia">
                <div className="story-utopia-banner">
                  <img
                    src={habitat.baseImageSrc}
                    alt={habitat.title}
                    className="story-utopia-base-img"
                    decoding="async"
                  />
                  <img
                    src={habitat.overlayImageSrc}
                    alt=""
                    aria-hidden="true"
                    className={`story-utopia-weather-layer${isTuned ? ' is-visible' : ''}`}
                    decoding="async"
                  />

                  <div className="story-utopia-top-controls">
                    <div
                      className="story-utopia-habitat-switcher"
                      role="group"
                      aria-label={locale === 'zh' ? '切换洞天画卷' : 'Switch habitat scroll'}
                    >
                      {utopiaContent.habitats.map((item) => {
                        const active = item.id === habitat.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={active}
                            className={`story-utopia-habitat-btn${active ? ' is-active' : ''}`}
                            onClick={() => setHabitatId(item.id)}
                          >
                            {item.shortTitle}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      aria-pressed={isTuned}
                      className={`story-utopia-weather-btn${isTuned ? ' is-tuned' : ''}`}
                      onClick={() =>
                        setTunedByHabitat((prev) => ({
                          ...prev,
                          [habitat.id]: !prev[habitat.id],
                        }))
                      }
                    >
                      <Sparkles size={12.5} aria-hidden="true" />
                      <span>{isTuned ? habitat.tunedEnvLabel : habitat.normalEnvLabel}</span>
                    </button>
                  </div>

                  {/* Hand-drawn Walking Chibi Actors Positioned on the 2.5D Scroll */}
                  {habitat.residents.map((resident) => {
                    const placement = isTuned ? resident.tuned : resident.normal;
                    const frame = walkerFrames[resident.id] ?? {
                      x: placement.x,
                      y: placement.y,
                      walking: false,
                      facing: 'right' as const,
                    };
                    return (
                      <div
                        key={resident.id}
                        className={`story-utopia-map-actor${frame.walking ? ' is-walking' : ''}`}
                        style={{
                          left: `${frame.x.toFixed(2)}%`,
                          top: `${frame.y.toFixed(2)}%`,
                          zIndex: 2 + Math.round(frame.y * 0.05),
                        }}
                      >
                        <UtopiaMiniChibiSvg
                          cloakColor={resident.defaultCloak}
                          headwear={resident.defaultHeadwear}
                          size={40}
                          walking={frame.walking}
                          facing={frame.facing}
                        />
                        <span className="story-utopia-map-tag">
                          <strong>{resident.name}</strong>
                          <small>{placement.placeName}</small>
                        </span>
                      </div>
                    );
                  })}

                  <div className="story-utopia-banner-overlay">
                    <span className="story-utopia-pill is-muted">
                      <Moon size={12.5} aria-hidden="true" />
                      <span>
                        {locale === 'zh'
                          ? '23:00–08:00 免打扰 · 支持拓展 .utopia 包'
                          : 'Quiet 11 PM–8 AM · Custom .utopia packs'}
                      </span>
                    </span>

                    {session ? (
                      <button
                        type="button"
                        className="story-utopia-open-app-btn"
                        onClick={() => session.openPreview('nimi.utopia')}
                      >
                        <img src="/demo/utopia-icon.png" alt="" width={16} height={16} />
                        <span>{locale === 'zh' ? '展卷试玩 NimiUtopia' : 'Try NimiUtopia'}</span>
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="story-utopia-residents">
                  {habitat.residents.map((resident) => {
                    const placement = isTuned ? resident.tuned : resident.normal;
                    return (
                      <div key={resident.id} className="story-utopia-resident">
                        <img src={resident.avatarSrc} alt="" width={38} height={38} />
                        <div>
                          <strong>
                            {resident.name} · {placement.placeName}
                          </strong>
                          <small>{placement.detail}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="story-utopia-control-bar">
                  <div>
                    <strong>
                      {allowCheckIn
                        ? locale === 'zh'
                          ? '仅白天空闲时轻声问候（每日最多 1 次）'
                          : 'Gentle daytime check-ins (max 1 per day)'
                        : locale === 'zh'
                          ? '默认静音，你不开口绝不打扰'
                          : 'Quiet by default—never interrupts uninvited'}
                    </strong>
                    <small>
                      {locale === 'zh'
                        ? '门前便签不建空会话，想长聊可一键带草稿去织羽'
                        : 'Send a quick doorstep note, or hand off to Zhiyu for full chat'}
                    </small>
                  </div>
                  <div className="story-utopia-control-actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allowCheckIn}
                      className={`story-pill-switch${allowCheckIn ? ' is-on' : ''}`}
                      onClick={() => setAllowCheckIn((prev) => !prev)}
                    >
                      {allowCheckIn ? <Bell size={13.5} aria-hidden="true" /> : <BellOff size={13.5} aria-hidden="true" />}
                      <span>
                        {allowCheckIn
                          ? locale === 'zh'
                            ? '允许问候'
                            : 'Check-ins On'
                          : locale === 'zh'
                            ? '默认免打扰'
                            : 'Default Quiet'}
                      </span>
                    </button>
                    {session ? (
                      <button
                        type="button"
                        className="story-utopia-zhiyu-btn"
                        onClick={() => session.openPreview('nimi.zhiyu', 'companion', DEFAULT_STORY_AGENT)}
                      >
                        <img src="/demo/zhiyu-icon.png" alt="" width={15} height={15} />
                        <span>{locale === 'zh' ? '去织羽深聊' : 'Chat in Zhiyu'}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {activePillar === 'origin' && (
              <div className="story-companion-scene story-companion-scene--origin">
                <div className="story-companion-art">
                  <img
                    src={currentChar.backdropSrc}
                    alt=""
                    className="story-companion-backdrop"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="story-companion-switcher" role="group" aria-label={locale === 'zh' ? '切换试听角色' : 'Switch character voice'}>
                    {characters.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`story-companion-chip${idx === charIndex ? ' is-active' : ''}`}
                        aria-pressed={idx === charIndex}
                        onClick={() => {
                          voice.stop();
                          setCharIndex(idx);
                        }}
                      >
                        <img src={item.avatarSrc} alt="" width={22} height={22} />
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </div>
                  <img
                    src={currentChar.portraitSrc}
                    alt=""
                    className={`story-companion-portrait${currentChar.id === 'heguan' ? ' is-cutout' : ' is-framed'}`}
                    loading="lazy"
                    decoding="async"
                  />
                </div>

                <div className="story-companion-voice-card">
                  <div className="story-companion-voice-meta">
                    <div>
                      <span className="story-companion-world-tag">{currentChar.world}</span>
                      <strong>{currentChar.name}</strong>
                      <small>{currentChar.role}</small>
                    </div>
                    <button
                      type="button"
                      className={`story-voice-play-btn${isPlaying ? ' is-playing' : ''}`}
                      onClick={() => voice.toggle(currentChar.voiceUrl)}
                    >
                      {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                      <span>{isPlaying ? t('worlds.pause') : t('worlds.listen')}</span>
                      <small>{currentChar.duration}</small>
                    </button>
                  </div>
                  <blockquote>{currentChar.quote}</blockquote>
                  {voice.failedUrl === currentChar.voiceUrl && (
                    <p className="story-voice-error">{t('worlds.audioError')}</p>
                  )}
                </div>
              </div>
            )}

            {activePillar === 'embodiment' && (
              <div className="story-companion-scene story-companion-scene--embodiment">
                <div className="story-split-lanes">
                  <div className="story-split-lane">
                    <div className="story-split-lane-head">
                      <img src="/demo/zhiyu-icon.png" alt="" width={28} height={28} />
                      <img src="/demo/utopia-icon.png" alt="" width={28} height={28} />
                      <img src="/logo.svg" alt="" width={28} height={28} />
                      <span>{locale === 'zh' ? '相伴时无缝延续（织羽 · 洞天 · Home）' : 'Together Across Zhiyu, Utopia & Home'}</span>
                    </div>
                    <div className="story-split-bubble">
                      <img src="/demo/explore/emberware-court-character-0.png" alt="" width={34} height={34} />
                      <p>
                        {locale === 'zh'
                          ? '“昨晚你说八点想理那份烟痕笔记，现在要接着聊吗？”'
                          : '“You mentioned sorting those soot-glaze notes at eight—want to pick up where we left off?”'}
                      </p>
                    </div>
                    <ul className="story-split-checks">
                      <li><Check size={14} aria-hidden="true" /><span>{locale === 'zh' ? '换个窗口依然接着同一段话聊' : 'Continues the same thread across hubs'}</span></li>
                      <li><Check size={14} aria-hidden="true" /><span>{locale === 'zh' ? '保留专属声音、形象与长期记忆' : 'Keeps voice, avatar, and long-term memory'}</span></li>
                    </ul>
                  </div>

                  <div className="story-split-divider" aria-hidden="true">
                    <span><Lock size={14} /></span>
                  </div>

                  <div className="story-split-lane is-isolated">
                    <div className="story-split-lane-head">
                      <img src="/demo/parentos-icon.png" alt="" width={28} height={28} />
                      <img src="/demo/vane-icon.png" alt="" width={28} height={28} />
                      <span>{locale === 'zh' ? '去工具软件帮忙时' : 'Helping Inside Utility Apps'}</span>
                    </div>
                    <div className="story-split-bubble is-utility">
                      <p>
                        {locale === 'zh'
                          ? '按熟悉的语气帮你整理当前页面的笔记或清单。'
                          : 'Helps organize the current note or task in its familiar voice.'}
                      </p>
                    </div>
                    <ul className="story-split-checks">
                      <li><Check size={14} aria-hidden="true" /><span>{locale === 'zh' ? '仅传入当前交给它的这件任务' : 'Only receives the current task snippet'}</span></li>
                      <li className="is-blocked"><X size={14} aria-hidden="true" /><span>{locale === 'zh' ? '绝不读取你们平时的私聊记录' : 'Never reads your private chat history'}</span></li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="story-companion-tabs" role="list">
            {pillars.map(({ id, Icon, title, body }) => {
              const active = activePillar === id;
              return (
                <article
                  key={id}
                  role="listitem"
                  className={`story-agent-card story-companion-tab${active ? ' is-active' : ''}`}
                  data-agent-pillar={id}
                >
                  <button
                    type="button"
                    className="story-companion-tab-btn"
                    aria-pressed={active}
                    onClick={() => {
                      if (id !== 'origin') voice.stop();
                      setActivePillar(id);
                    }}
                  >
                    <div className="story-portal-card-top">
                      <span className="story-portal-icon" aria-hidden="true">
                        <Icon size={19} />
                      </span>
                    </div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="story-agents-footer">
          <PublicSiteLink to={withLocaleQuery('/home', locale)} className="story-link story-agents-cta">
            <span>{t('agents.exploreAction')}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </PublicSiteLink>
        </div>
      </div>
    </section>
  );
}
