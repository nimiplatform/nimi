import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  BarChart3,
  BookOpen,
  Check,
  Home,
  MessageSquare,
  Mic,
  Plus,
  Search,
  Settings,
  Upload,
} from 'lucide-react';
import type { OpenwhisprPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice } from './demo-third-party-shared.js';

const NAV_ICONS = [Home, BarChart3, MessageSquare, BookOpen, Upload, BookOpen, Settings];
type PreviewNote = { title: string; time: string; duration: string; text: string; raw: string };

/** Replica of OpenWhispr's ControlPanelSidebar, dictation history, note editor and chat. */
export function DemoOpenwhisprPreview({ content }: { content: OpenwhisprPreviewContent }) {
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [view, setView] = useState('首页');
  const [query, setQuery] = useState(() => pData(''));
  const [selected, setSelected] = useState(0);
  const [notes, setNotes] = useState<PreviewNote[]>(() => pData([...content.notes]));
  const [prompt, setPrompt] = useState<string>(() => pData(content.chatPrompt));
  const [sentPrompt, setSentPrompt] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [dictionary, setDictionary] = useState(() => pData('OpenWhispr\nNimi'));
  const note = notes[selected]!;
  const updateNote = (patch: Partial<PreviewNote>) =>
    setNotes((previous) =>
      previous.map((item, index) => (index === selected ? { ...item, ...patch } : item)),
    );
  const openNote = (index: number) => {
    setSelected(index);
    setView('笔记');
  };
  return (
    <div className="tp-preview openwhispr-preview" data-demo-openwhispr-root lang={previewLang}>
      <div className="ow-layout">
        <aside className="ow-sidebar">
          <div className="ow-brand">
            <img src="/demo/openwhispr-icon.png" alt={pText('')} />
            <strong>{pText('OpenWhispr')}</strong>
          </div>
          <nav aria-label={pText('主导航')}>
            {content.navigation.map((label, index) => {
              const Icon = NAV_ICONS[index]!;
              return (
                <button
                  type="button"
                  key={label}
                  aria-label={pText(label)}
                  aria-current={view === label ? 'page' : undefined}
                  onClick={() => setView(label)}
                >
                  <Icon size={17} />
                  <span>{pText(label)}</span>
                </button>
              );
            })}
          </nav>
          <div className="ow-profile">
            <span>{pText('H')}</span>
            <div>
              {pText('示例工作区')}
              <small>{pText('个人')}</small>
            </div>
          </div>
        </aside>
        <div className="ow-panel">
          <header className="ow-topbar">
            <h1>{pText(view)}</h1>
            <div>
              <Search size={15} />
              <input
                aria-label={pText('搜索示例笔记和转录')}
                placeholder={pText('搜索笔记和转录…')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <PreviewButton
              onClick={() => {
                setNotes((previous) => [
                  ...previous,
                  {
                    title: pText('无标题笔记'),
                    text: '',
                    raw: '',
                    duration: '00:00',
                    time: pText('刚刚'),
                  },
                ]);
                setSelected(notes.length);
                setView('笔记');
              }}
            >
              <Plus size={15} />
              <span>{pText('新建笔记')}</span>
            </PreviewButton>
          </header>
          {view === '首页' ? (
            <main className="ow-home">
              <h2>{pText('欢迎回来')}</h2>
              <div className="ow-welcome">
                <Mic size={22} />
                <div>
                  <strong>{pText('从一句话开始')}</strong>
                  <p>{pText('按住右 Ctrl，说出你的想法。')}</p>
                </div>
                <kbd>{pText('右 Ctrl')}</kbd>
              </div>
              <div className="ow-history-heading">
                <h3>{pText('今天')}</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={raw}
                    onChange={(event) => {
                      setRaw(event.target.checked);
                    }}
                  />
                  {pText('原始转录')}
                </label>
              </div>
              {notes.map(
                (item, index) =>
                  (!query ||
                    `${item.title}${item.text}`.toLowerCase().includes(query.toLowerCase())) && (
                    <article key={item.title} className="ow-transcript">
                      <span className="ow-time">{item.time}</span>
                      <button type="button" onClick={() => openNote(index)}>
                        <span className="ow-duration">
                          {item.duration === '00:00' ? (
                            <BookOpen size={14} />
                          ) : (
                            <AudioLines size={14} />
                          )}
                          {pText(item.duration === '00:00' ? pText('笔记') : item.duration)}
                        </span>
                        <p>{raw && item.raw ? item.raw : item.text}</p>
                        <small>{item.title}</small>
                      </button>
                    </article>
                  ),
              )}
              {query &&
                !notes.some((item) =>
                  `${item.title}${item.text}`.toLowerCase().includes(query.toLowerCase()),
                ) && <p className="tp-empty">{pText('没有匹配的示例记录。')}</p>}
            </main>
          ) : view === '笔记' ? (
            <main className="ow-notes">
              <aside>
                <h3>{pText('私人笔记')}</h3>
                {notes.map((item, index) => (
                  <button
                    type="button"
                    aria-pressed={selected === index}
                    key={index}
                    onClick={() => openNote(index)}
                  >
                    <BookOpen size={14} />
                    {item.title}
                  </button>
                ))}
              </aside>
              <section>
                <input
                  className="ow-note-title"
                  aria-label={pText('笔记标题')}
                  value={note.title}
                  onChange={(event) => {
                    updateNote({ title: event.target.value });
                  }}
                />
                <p>{pText('今天 · 个人')}</p>
                <textarea
                  aria-label={pText('笔记正文')}
                  value={note.text}
                  onChange={(event) => {
                    updateNote({ text: event.target.value });
                  }}
                  rows={9}
                />
                <span className="tp-muted">
                  <Check size={13} />
                  {pText('编辑只在本次预览中保留')}
                </span>
              </section>
            </main>
          ) : view === '聊天' ? (
            <main className="ow-chat">
              <div className="ow-chat-conversation">
                <span className="ow-chat-mark">
                  <AudioLines size={30} />
                </span>
                <h2>{pText('让想法，连成线。')}</h2>
                <p>{pText('从你的笔记与转录中找回灵感。')}</p>
                {sentPrompt && (
                  <>
                    <div className="ow-chat-user">{pText(sentPrompt)}</div>
                    <div className="ow-chat-answer">
                      <small>{pText('示例回复 · 引用示例笔记')}</small>
                      <p>{pText(content.chatReply)}</p>
                      <PreviewButton onClick={() => openNote(0)}>
                        <BookOpen size={14} />
                        {notes[0]!.title}
                      </PreviewButton>
                    </div>
                  </>
                )}
              </div>
              <form
                className="ow-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSentPrompt(prompt);
                }}
              >
                <input
                  aria-label={pText('随便问点什么')}
                  value={prompt}
                  maxLength={600}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                  }}
                />
                <button type="submit" aria-label={pText('查看示例回复')} disabled={!prompt.trim()}>
                  <ArrowUp size={19} />
                </button>
              </form>
            </main>
          ) : (
            <main className="ow-home">
              <h2>{pText(view === '统计' ? pText('把想法说出来') : view)}</h2>
              {view === '统计' ? (
                <div className="ow-statistics">
                  <div>
                    <strong>{pText('3')}</strong>
                    <span>{pText('示例转录')}</span>
                  </div>
                  <div>
                    <strong>{pText('39 秒')}</strong>
                    <span>{pText('示例录音总时长')}</span>
                  </div>
                </div>
              ) : view === '词典' ? (
                <>
                  <p>{pText('为经常使用的专有名词保留正确写法。')}</p>
                  <label>
                    {pText('示例词典')}
                    <textarea
                      value={dictionary}
                      onChange={(event) => {
                        setDictionary(event.target.value);
                      }}
                      rows={5}
                    />
                  </label>
                </>
              ) : view === '上传' ? (
                <div className="ow-upload">
                  <Upload size={32} />
                  <h3>{pText('把录音变成笔记')}</h3>
                  <p>{pText('探索一段预设的录音转录。')}</p>
                  <PreviewButton onClick={() => openNote(0)}>{pText('打开示例转录')}</PreviewButton>
                </div>
              ) : (
                <>
                  <label>
                    {pText('听写快捷键')}
                    <select defaultValue="按住右 Ctrl">
                      <option value={'按住右 Ctrl'}>{pText('按住右 Ctrl')}</option>
                      <option value={'按下切换'}>{pText('按下切换')}</option>
                    </select>
                  </label>
                  <p>{pText('在完整 App 中，可配置语种、听写清理和 Nimi AI 模型。')}</p>
                </>
              )}
            </main>
          )}
        </div>
      </div>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
