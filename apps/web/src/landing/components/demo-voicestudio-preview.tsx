import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  FileAudio,
  Folder,
  Headphones,
  Mic,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import type { VoiceStudioPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice, PreviewWaveform } from './demo-third-party-shared.js';

const NAV_ICONS = [
  Mic,
  BookOpen,
  Headphones,
  AudioLines,
  FileAudio,
  Wand2,
  BookOpen,
  Folder,
  SlidersHorizontal,
];
type DemoVoice = { name: string; detail: string; initial: string };

/** Landing-owned replica of VoiceStudio's T3-style workspace, voice library and design page. */
export function DemoVoiceStudioPreview({ content }: { content: VoiceStudioPreviewContent }) {
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [view, setView] = useState('设计');
  const [description, setDescription] = useState<string>(() => pData(content.description));
  const [script, setScript] = useState<string>(() => pData(content.script));
  const [voices, setVoices] = useState<DemoVoice[]>([...content.voices]);
  const [selected, setSelected] = useState(() => pData('海边叙述者'));
  const [name, setName] = useState(() => pData(''));
  const [take, setTake] = useState(false);
  const [language, setLanguage] = useState('自动');
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState(() => pData(''));
  const pickVoice = (voice: DemoVoice) => {
    setSelected(voice.name);
    setDescription(voice.detail);
    setView('设计');
  };
  return (
    <div className="tp-preview voicestudio-preview" data-demo-voicestudio-root lang={previewLang}>
      <div className="vs-layout">
        <aside className="vs-sidebar">
          <div className="vs-brand">
            <img src="/demo/voicestudio-icon.png" alt={pText('')} />
            <strong>{pText('VoiceStudio')}</strong>
          </div>
          <div className="vs-library-heading">
            <span>{pText('已保存的配置')}</span>
            <button
              type="button"
              aria-label={pText('查看声音配置')}
              onClick={() => setView('配置档案')}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="vs-voice-list">
            {voices.map((voice) => (
              <button
                type="button"
                key={voice.name}
                aria-pressed={selected === voice.name}
                onClick={() => pickVoice(voice)}
              >
                <span>{voice.initial}</span>
                {voice.name}
              </button>
            ))}
          </div>
          <nav aria-label={pText('工作区')}>
            {content.navigation.map((label, index) => {
              const Icon = NAV_ICONS[index]!;
              return (
                <button
                  type="button"
                  key={label}
                  aria-current={view === label ? 'page' : undefined}
                  onClick={() => setView(label)}
                >
                  <Icon size={16} />
                  {pText(label)}
                </button>
              );
            })}
          </nav>
          <button className="vs-settings-link" type="button" onClick={() => setView('设置')}>
            <Settings size={16} />
            {pText('设置')}
          </button>
        </aside>
        <main className="vs-main">
          <header className="vs-header">
            <h1>{pText(view === '配置档案' ? pText('已保存的配置') : view)}</h1>
            <span className="tp-chip">{pText('示例工作区')}</span>
          </header>
          {view === '设计' || view === '克隆' ? (
            <div className="vs-creation">
              <aside className="vs-designer">
                <h2>{pText(view)}</h2>
                {view === '设计' ? (
                  <>
                    <label>
                      {pText('描述你想要的声音')}
                      <textarea
                        rows={5}
                        value={description}
                        maxLength={2000}
                        onChange={(event) => {
                          setDescription(event.target.value);
                        }}
                      />
                    </label>
                    <p className="tp-muted">{pText('描述这个声音，或选择一个起点。')}</p>
                    <h3>{pText('起点')}</h3>
                    <div className="vs-presets">
                      {['叙述者', '随性', '新闻主播', '说书人', '商务', '活力'].map((preset) => (
                        <button
                          type="button"
                          key={preset}
                          onClick={() => setDescription(`${preset}风格，吐字清晰，语速自然。`)}
                        >
                          {pText(preset)}
                        </button>
                      ))}
                    </div>
                    <details>
                      <summary>{pText('详情')}</summary>
                      <label>
                        {pText('语速')}
                        <select defaultValue="自然">
                          <option value={'自然'}>{pText('自然')}</option>
                          <option value={'舒缓'}>{pText('舒缓')}</option>
                          <option value={'轻快'}>{pText('轻快')}</option>
                        </select>
                      </label>
                    </details>
                  </>
                ) : (
                  <div className="vs-reference">
                    <Upload size={27} />
                    <h3>{pText('参考音频')}</h3>
                    <p>{pText('完整 App 支持使用一段清晰的参考语音创建声音配置。')}</p>
                    <PreviewButton
                      onClick={() => {
                        setSelected('海边叙述者');
                        setDescription(content.description);
                      }}
                    >
                      {pText('载入示例配置')}
                    </PreviewButton>
                  </div>
                )}
                <label>
                  {pText('配置名称')}
                  <input
                    value={name}
                    maxLength={60}
                    placeholder={pText('配置名称…')}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
                <PreviewButton
                  disabled={!name.trim() || voices.some((voice) => voice.name === name.trim())}
                  onClick={() => {
                    setVoices((previous) => [
                      ...previous,
                      {
                        name: name.trim(),
                        detail: description,
                        initial: Array.from(name.trim())[0]!,
                      },
                    ]);
                    setSelected(name.trim());
                    setName('');
                    setSaved(true);
                  }}
                >
                  <Plus size={14} />
                  {pText('保存为声音配置')}
                </PreviewButton>
                {saved && (
                  <p role="status">
                    <Check size={14} />
                    {pText('示例配置已加入侧栏')}
                  </p>
                )}
              </aside>
              <section className="vs-script">
                <button
                  type="button"
                  className="vs-current-voice"
                  onClick={() => setView('配置档案')}
                >
                  <span className="vs-voice-avatar">{Array.from(selected)[0]}</span>
                  <span>
                    <small>{pText('语音')}</small>
                    {selected}
                  </span>
                  <ChevronRight size={16} />
                </button>
                <label>
                  {pText('文本')}
                  <textarea
                    value={script}
                    rows={7}
                    maxLength={3000}
                    placeholder={pText('想让这个声音说什么？')}
                    onChange={(event) => {
                      setScript(event.target.value);
                    }}
                  />
                </label>
                <div className="vs-generate-row">
                  <label>
                    <span className="tp-sr-only">{pText('语言')}</span>
                    <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                      <option value={'自动'}>{pText('自动')}</option>
                      <option value={'中文'}>{pText('中文')}</option>
                      <option value={'English'}>{pText('English')}</option>
                    </select>
                  </label>
                  <span>
                    {script.length} {pText(' 字')}
                  </span>
                  <PreviewButton
                    primary
                    disabled={!script.trim() || !description.trim()}
                    onClick={() => setTake(true)}
                  >
                    <Sparkles size={15} />
                    {pText('生成音频')}
                  </PreviewButton>
                </div>
                <p className="vs-sample-hint">
                  {pText('此按钮展示预录示例，音频内容不随输入文字或声音配置变化。')}
                </p>
                {take && (
                  <section className="vs-take">
                    <h3>{pText('最新拍摄 · 预录示例')}</h3>
                    <PreviewWaveform label={pText('示例音轨示意')} />
                    <audio
                      controls
                      preload="none"
                      src="/demo/zhiyu/qingzhao-voice.mp3"
                      aria-label={pText('VoiceStudio 预录示例音频')}
                    />
                    <p>{pText('预录演示音频 · 非本次生成')}</p>
                  </section>
                )}
              </section>
            </div>
          ) : view === '配置档案' ? (
            <section className="vs-profiles">
              <label className="vs-search">
                <Search size={16} />
                <input
                  value={query}
                  aria-label={pText('搜索示例声音')}
                  placeholder={pText('搜索…')}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
              </label>
              <div>
                {voices
                  .filter((voice) => voice.name.toLowerCase().includes(query.toLowerCase()))
                  .map((voice) => (
                    <button type="button" key={voice.name} onClick={() => pickVoice(voice)}>
                      <span className="vs-voice-avatar">{voice.initial}</span>
                      <strong>{voice.name}</strong>
                      <p>{voice.detail}</p>
                      <span>
                        {pText('使用此声音')}
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))}
              </div>
              {!voices.some((voice) => voice.name.toLowerCase().includes(query.toLowerCase())) && (
                <p className="tp-empty">{pText('没有匹配的示例声音。')}</p>
              )}
            </section>
          ) : view === '故事' || view === '有声读物' ? (
            <section className="vs-story">
              <h2>{pText('海边的一天')}</h2>
              <p className="tp-muted">{pText('示例故事 · 为每个角色分配声音')}</p>
              <label>
                {pText('故事文本')}
                <textarea
                  rows={6}
                  value={script}
                  onChange={(event) => {
                    setScript(event.target.value);
                  }}
                />
              </label>
              {voices.slice(0, 2).map((voice, index) => (
                <div className="vs-track" key={voice.name}>
                  <span>
                    {pText(index === 0 ? pText('旁白') : pText('角色'))}
                    <small>{voice.name}</small>
                  </span>
                  <PreviewWaveform label={pText(`${voice.name}示例轨道`)} />
                </div>
              ))}
            </section>
          ) : (
            <section className="vs-story">
              <h2>
                {pText(
                  view === '转录'
                    ? pText('把录音变成文字')
                    : view === '配音'
                      ? pText('为画面赋予声音')
                      : view === '设置'
                        ? pText('声音创作偏好')
                        : `${view}工作区`,
                )}
              </h2>
              <p>
                {pText(
                  view === '转录'
                    ? pText('完整 App 支持文件、录音与快捷键听写。')
                    : view === '配音'
                      ? pText('导入视频，整理台词，为片段选择声音。')
                      : pText('在完整 App 中管理项目、音频工具和 Nimi AI 配置。'),
                )}
              </p>
              <PreviewButton onClick={() => setView('设计')}>
                {pText('探索声音设计')}
                <ChevronRight size={15} />
              </PreviewButton>
            </section>
          )}
        </main>
      </div>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
