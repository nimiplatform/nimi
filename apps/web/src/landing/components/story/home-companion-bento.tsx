import { useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  DoorClosed,
  Lock,
  MapPin,
  Moon,
  Pause,
  Pencil,
  RotateCcw,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type { LandingLocale } from '../../i18n/locale.js';
import { useVoiceSample } from './use-voice-sample.js';

export function HomeCompanionBento({ locale }: { locale: LandingLocale }) {
  const [proactiveOn, setProactiveOn] = useState(false);
  const [solitudeOn, setSolitudeOn] = useState(false);
  const [refinedTeaNote, setRefinedTeaNote] = useState(false);
  const [forgotPigmentNote, setForgotPigmentNote] = useState(false);
  const voice = useVoiceSample();

  const voiceClipUrl = '/demo/explore/luomi-voice.mp3';
  const isPlaying = voice.playingUrl === voiceClipUrl;

  const isZh = locale === 'zh';

  return (
    <section id="local-agent" className="public-page-section" aria-labelledby="local-agent-heading">
      <div className="story-container">
        <header className="story-heading public-section-heading-wide">
          <span className="story-eyebrow">
            {isZh ? '住进电脑里的日常伙伴' : 'Companions That Live on Your Computer'}
          </span>
          <h2 id="local-agent-heading">
            {isZh ? '有自己的安静日常，也把分寸交给你' : 'A quiet daily life of their own, with boundaries you set'}
          </h2>
          <p>
            {isZh
              ? '不是关掉网页就消失的临时对话框——它记得你说过的小事，闲时待在海岛空间，打不打扰随时听你的。'
              : 'More than a disposable chat tab—your companion remembers what matters, unwinds in an island habitat, and never interrupts uninvited.'}
          </p>
        </header>

        <div className="home-bento-grid">
          {/* Card 1: Interactive Utopia & Quiet-Hours Controls */}
          <article className="public-domain-card home-bento-card" data-agent-mechanism="utopia">
            <div className="home-bento-card-head">
              <span className="public-domain-badge">
                {isZh ? 'Utopia 海岛日常 · 免打扰开关' : 'Utopia Island Life · Quiet Controls'}
              </span>
              <h3>{isZh ? '闲时过自己的日子，绝不乱弹窗' : 'Lives quietly when you are busy'}</h3>
              <p className="public-domain-summary">
                {isZh
                  ? '内置本地海岛空间，伙伴有自己的小屋与散步去处；主动问候默认关闭。'
                  : 'Companions have private quarters and shared hangouts in Utopia—with outreach off by default.'}
              </p>
            </div>

            <div className="home-bento-utopia-widget">
              <div className="home-bento-utopia-scene">
                <img src="/demo/explore/meridian-archipelago-cover.webp" alt="" decoding="async" />
                <div className="home-bento-utopia-pills">
                  <span>
                    <MapPin size={12} aria-hidden="true" />
                    {solitudeOn
                      ? (isZh ? '独处模式 · 各自在小屋休息' : 'Solitude · Resting in private quarters')
                      : (isZh ? '海岛水岸 · 伙伴偶遇喝茶中' : 'Estuary Tea Stall · Hanging out')}
                  </span>
                  <span>
                    <Moon size={12} aria-hidden="true" />
                    {isZh ? '23:00–08:00 免打扰' : '11 PM–8 AM Quiet'}
                  </span>
                </div>
              </div>

              <div className="home-bento-toggles">
                <div className="home-bento-toggle-row">
                  <div>
                    <strong>
                      {proactiveOn
                        ? (isZh ? '白天空闲时最多轻声问候 1 次' : 'At most 1 gentle daytime check-in')
                        : (isZh ? '默认安静，绝不主动打扰' : 'Default quiet: never messages first')}
                    </strong>
                    <small>{isZh ? '未读时不追问，夜间自动静默' : 'No follow-up nagging · Auto night silence'}</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={proactiveOn}
                    className={`story-pill-switch${proactiveOn ? ' is-on' : ''}`}
                    onClick={() => setProactiveOn((prev) => !prev)}
                  >
                    {proactiveOn ? <Bell size={13} aria-hidden="true" /> : <BellOff size={13} aria-hidden="true" />}
                    <span>{proactiveOn ? (isZh ? '已开启' : 'On') : (isZh ? '默认关闭' : 'Default Off')}</span>
                  </button>
                </div>

                <div className="home-bento-toggle-row">
                  <div>
                    <strong>
                      {solitudeOn
                        ? (isZh ? '独处开启：不与其他伙伴串门' : 'Solitude on: stays in private room')
                        : (isZh ? '允许同账号伙伴在茶摊偶遇' : 'Companions can meet in shared spots')}
                    </strong>
                    <small>{isZh ? '随时切换社交或安静独处状态' : 'Switch between co-presence and solitude'}</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={solitudeOn}
                    className={`story-pill-switch${solitudeOn ? ' is-on' : ''}`}
                    onClick={() => setSolitudeOn((prev) => !prev)}
                  >
                    {solitudeOn ? <DoorClosed size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
                    <span>{solitudeOn ? (isZh ? '独处中' : 'Solitude') : (isZh ? '可偶遇' : 'Shared')}</span>
                  </button>
                </div>
              </div>
            </div>
          </article>

          {/* Card 2: Interactive Memory Drawer */}
          <article className="public-domain-card home-bento-card" data-agent-mechanism="memory">
            <div className="home-bento-card-head">
              <span className="public-domain-badge">
                {isZh ? '透明记忆抽屉 · 本机存放' : 'Transparent Local Memory'}
              </span>
              <h3>{isZh ? '它记住了什么，随时改、一键忘' : 'Inspect, tweak, or erase any memory'}</h3>
              <p className="public-domain-summary">
                {isZh
                  ? '每条记忆都标明来自哪次聊天，点一下就能纠正细节或彻底抹掉。'
                  : 'Every memory links to the chat it came from—refine a detail or erase it immediately.'}
              </p>
            </div>

            <div className="home-bento-memory-drawer">
              <div className="home-bento-memory-item">
                <div className="home-bento-memory-text">
                  <p>
                    {refinedTeaNote
                      ? (isZh ? '晚上九点后喜欢安静写字，习惯泡一杯温麦茶。' : 'Likes quiet writing after 9 PM with warm roasted barley tea.')
                      : (isZh ? '晚上八点后喜欢安静写字，习惯喝一杯热茶。' : 'Likes quiet writing after 8 PM with a cup of hot tea.')}
                  </p>
                  <small>{isZh ? '来自：昨晚 21:15 的聊天 · 已存在本机' : 'From last night’s chat · Stored locally'}</small>
                </div>
                <button
                  type="button"
                  className="home-bento-mini-btn"
                  onClick={() => setRefinedTeaNote((prev) => !prev)}
                >
                  <Pencil size={12} aria-hidden="true" />
                  <span>{refinedTeaNote ? (isZh ? '已改好' : 'Updated') : (isZh ? '顺手改改' : 'Refine')}</span>
                </button>
              </div>

              <div className={`home-bento-memory-item${forgotPigmentNote ? ' is-forgotten' : ''}`}>
                <div className="home-bento-memory-text">
                  <p>
                    {forgotPigmentNote
                      ? (isZh ? '已从本机彻底抹除，后续不再提及。' : 'Removed from your PC—never brought up again.')
                      : (isZh ? '周末打算整理砖画里的矿彩烟痕笔记。' : 'Planning to organize mineral-pigment notes this weekend.')}
                  </p>
                  <small>
                    {forgotPigmentNote
                      ? (isZh ? '即时生效 · 原对话不受影响' : 'Effective immediately · Chat stays intact')
                      : (isZh ? '来自：前天下午的对话' : 'From two days ago')}
                  </small>
                </div>
                <button
                  type="button"
                  className="home-bento-mini-btn"
                  onClick={() => setForgotPigmentNote((prev) => !prev)}
                >
                  {forgotPigmentNote ? <RotateCcw size={12} aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />}
                  <span>{forgotPigmentNote ? (isZh ? '恢复看看' : 'Restore') : (isZh ? '忘掉这条' : 'Forget')}</span>
                </button>
              </div>

              <div className="home-bento-memory-item is-static">
                <div className="home-bento-memory-text">
                  <p>{isZh ? '写方案习惯先列三条短提纲，不喜欢冗长铺垫。' : 'Prefers starting drafts with three crisp bullet points.'}</p>
                  <small>{isZh ? '来自：上周三的工作讨论 · 随时可改' : 'From last Wednesday’s chat · Editable anytime'}</small>
                </div>
                <span className="home-bento-local-tag">
                  <Check size={12} aria-hidden="true" />
                  <span>{isZh ? '本机保存' : 'Local'}</span>
                </span>
              </div>
            </div>
          </article>

          {/* Card 3: Full-width Voice Embodiment & Chat-vs-Work Split */}
          <article className="public-domain-card home-bento-card home-bento-card--wide" data-agent-mechanism="continuity">
            <div className="home-bento-wide-grid">
              <div className="home-bento-voice-pane">
                <span className="public-domain-badge">
                  {isZh ? '专属声音与形象 · 随时去留' : 'Voice, Avatar & Clean Exit'}
                </span>
                <h3>{isZh ? '有声音、有模样，去哪聊都是同一个它' : 'One voice and identity across apps'}</h3>
                <p className="public-domain-summary">
                  {isZh
                    ? '可搭配专属音色与 Live2D / 3D 桌面形象；如果有一天不想继续陪伴，也能一键把本机记录干干净净清空。'
                    : 'Pair with custom voices and Live2D or 3D avatars—and if you ever part ways, wipe all local records cleanly in one step.'}
                </p>

                <div className="home-bento-voice-box">
                  <img src="/demo/explore/meridian-archipelago-character-1.png" alt="" width={44} height={44} />
                  <div>
                    <strong>{isZh ? '罗弥 · 澄汊河城匠人' : 'Luo Mi · Clearfork Builder'}</strong>
                    <small>{isZh ? '“拿上铜锥和引信，两个时辰内准给它重新续上！”' : '“Grab the copper awl—we’ll have the line running within four hours!”'}</small>
                  </div>
                  <button
                    type="button"
                    aria-pressed={isPlaying}
                    className={`story-voice-play-btn${isPlaying ? ' is-playing' : ''}`}
                    onClick={() => voice.toggle(voiceClipUrl)}
                  >
                    {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                    <span>{isPlaying ? (isZh ? '暂停' : 'Pause') : (isZh ? '听听声音' : 'Listen')}</span>
                  </button>
                </div>
                {voice.failedUrl === voiceClipUrl ? (
                  <p className="story-voice-error" role="alert">
                    {isZh ? '语音片段暂时无法播放，请重试。' : 'Voice sample could not be played. Please try again.'}
                  </p>
                ) : null}
              </div>

              <div className="home-bento-split-pane">
                <div className="home-bento-lane">
                  <div className="home-bento-lane-top">
                    <img src="/logo.svg" alt="" width={24} height={24} />
                    <img src="/demo/zhiyu-icon.png" alt="" width={24} height={24} />
                    <strong>{isZh ? '在 Home 与织羽陪你聊' : 'In Nimi Home & Zhiyu'}</strong>
                  </div>
                  <ul>
                    <li><Check size={14} aria-hidden="true" /><span>{isZh ? '延续同一条长久对话与共同回忆' : 'Continues one shared conversation & memory'}</span></li>
                    <li><Check size={14} aria-hidden="true" /><span>{isZh ? '没有任何第三方软件能偷看角色底牌' : 'No outside app can read raw persona prompts'}</span></li>
                  </ul>
                </div>

                <div className="home-bento-lock-pill">
                  <Lock size={13} aria-hidden="true" />
                  <span>{isZh ? '私聊严格隔离' : 'Private chats isolated'}</span>
                </div>

                <div className="home-bento-lane is-tool">
                  <div className="home-bento-lane-top">
                    <img src="/demo/parentos-icon.png" alt="" width={24} height={24} />
                    <img src="/demo/storybook-icon.png" alt="" width={24} height={24} />
                    <strong>{isZh ? '去工具软件搭把手' : 'Inside Utility Apps'}</strong>
                  </div>
                  <ul>
                    <li><Check size={14} aria-hidden="true" /><span>{isZh ? '保留熟悉的性格语气帮你处理眼前任务' : 'Helps with the task at hand in character'}</span></li>
                    <li className="is-blocked"><X size={14} aria-hidden="true" /><span>{isZh ? '绝不读取你们平时的私人聊天与海岛动态' : 'Never reads private chats or Utopia life'}</span></li>
                  </ul>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
