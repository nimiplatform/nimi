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
  const { previewLang, t } = useAppPreviewLocale();
  const navigationLabels: Record<string, string> = {
    home: content.navigation[0],
    statistics: content.navigation[1],
    chat: content.navigation[2],
    notes: content.navigation[3],
    uploads: content.navigation[4],
    dictionary: content.navigation[5],
    settings: content.navigation[6],
  };
  const [view, setView] = useState('home');
  const [query, setQuery] = useState(() => '');
  const [selected, setSelected] = useState(0);
  const [notes, setNotes] = useState<PreviewNote[]>(() => [...content.notes]);
  const [prompt, setPrompt] = useState<string>(() => content.chatPrompt);
  const [sentPrompt, setSentPrompt] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [dictionary, setDictionary] = useState(() => t('openwhispr.workspace.openWhisprNimi'));
  const note = notes[selected]!;
  const updateNote = (patch: Partial<PreviewNote>) =>
    setNotes((previous) =>
      previous.map((item, index) => (index === selected ? { ...item, ...patch } : item)),
    );
  const openNote = (index: number) => {
    setSelected(index);
    setView('notes');
  };
  return (
    <div className="tp-preview openwhispr-preview" data-demo-openwhispr-root lang={previewLang}>
      <div className="ow-layout">
        <aside className="ow-sidebar">
          <div className="ow-brand">
            <img src="/demo/openwhispr-icon.png" alt={''} />
            <strong>{t('openwhispr.sidebar.openWhispr')}</strong>
          </div>
          <nav aria-label={t('openwhispr.sidebar.primaryNavigation')}>
            {['home', 'statistics', 'chat', 'notes', 'uploads', 'dictionary', 'settings'].map(
              (value, index) => {
                const Icon = NAV_ICONS[index]!;
                const label = navigationLabels[value]!;
                return (
                  <button
                    type="button"
                    key={label}
                    aria-label={label}
                    aria-current={view === value ? 'page' : undefined}
                    onClick={() => setView(value)}
                  >
                    <Icon size={17} />
                    <span>{label}</span>
                  </button>
                );
              },
            )}
          </nav>
          <div className="ow-profile">
            <span>{t('openwhispr.sidebar.h')}</span>
            <div>
              {t('openwhispr.sidebar.sampleWorkspace')}
              <small>{t('openwhispr.sidebar.personal')}</small>
            </div>
          </div>
        </aside>
        <div className="ow-panel">
          <header className="ow-topbar">
            <h1>{navigationLabels[view]}</h1>
            <div>
              <Search size={15} />
              <input
                aria-label={t('openwhispr.topbar.searchSampleNotesAndTranscripts')}
                placeholder={t('openwhispr.topbar.searchNotesAndTranscripts')}
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
                    title: t('openwhispr.topbar.untitledNote'),
                    text: '',
                    raw: '',
                    duration: '00:00',
                    time: t('openwhispr.topbar.justNow'),
                  },
                ]);
                setSelected(notes.length);
                setView('notes');
              }}
            >
              <Plus size={15} />
              <span>{t('openwhispr.topbar.newNote')}</span>
            </PreviewButton>
          </header>
          {view === 'home' ? (
            <main className="ow-home">
              <h2>{t('openwhispr.home.welcomeBack')}</h2>
              <div className="ow-welcome">
                <Mic size={22} />
                <div>
                  <strong>{t('openwhispr.home.startWithASentence')}</strong>
                  <p>{t('openwhispr.home.holdRightCtrlAndSpeakYourThoughts')}</p>
                </div>
                <kbd>{t('openwhispr.home.rightCtrl')}</kbd>
              </div>
              <div className="ow-history-heading">
                <h3>{t('openwhispr.home.today')}</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={raw}
                    onChange={(event) => {
                      setRaw(event.target.checked);
                    }}
                  />
                  {t('openwhispr.home.originalTranscript')}
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
                          {item.duration === '00:00' ? t('openwhispr.home.notes') : item.duration}
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
                ) && <p className="tp-empty">{t('openwhispr.home.noMatchingSampleRecords')}</p>}
            </main>
          ) : view === 'notes' ? (
            <main className="ow-notes">
              <aside>
                <h3>{t('openwhispr.notes.privateNote')}</h3>
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
                  aria-label={t('openwhispr.notes.noteTitle')}
                  value={note.title}
                  onChange={(event) => {
                    updateNote({ title: event.target.value });
                  }}
                />
                <p>{t('openwhispr.notes.todayPersonal')}</p>
                <textarea
                  aria-label={t('openwhispr.notes.noteBody')}
                  value={note.text}
                  onChange={(event) => {
                    updateNote({ text: event.target.value });
                  }}
                  rows={9}
                />
                <span className="tp-muted">
                  <Check size={13} />
                  {t('openwhispr.notes.editsLastOnlyInThisPreview')}
                </span>
              </section>
            </main>
          ) : view === 'chat' ? (
            <main className="ow-chat">
              <div className="ow-chat-conversation">
                <span className="ow-chat-mark">
                  <AudioLines size={30} />
                </span>
                <h2>{t('openwhispr.chat.letIdeasConnect')}</h2>
                <p>{t('openwhispr.chat.rediscoverIdeasInYourNotesAndTranscripts')}</p>
                {sentPrompt && (
                  <>
                    <div className="ow-chat-user">{sentPrompt}</div>
                    <div className="ow-chat-answer">
                      <small>{t('openwhispr.chat.sampleReplyReferencesASampleNote')}</small>
                      <p>{content.chatReply}</p>
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
                  aria-label={t('openwhispr.chat.askAQuestion')}
                  value={prompt}
                  maxLength={600}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                  }}
                />
                <button
                  type="submit"
                  aria-label={t('openwhispr.chat.viewSampleReply')}
                  disabled={!prompt.trim()}
                >
                  <ArrowUp size={19} />
                </button>
              </form>
            </main>
          ) : (
            <main className="ow-home">
              <h2>{view === 'statistics' ? t('openwhispr.home.sayWhatYouReThinking') : view}</h2>
              {view === 'statistics' ? (
                <div className="ow-statistics">
                  <div>
                    <strong>{'3'}</strong>
                    <span>{t('openwhispr.home.sampleTranscripts')}</span>
                  </div>
                  <div>
                    <strong>{t('openwhispr.home.39Seconds')}</strong>
                    <span>{t('openwhispr.home.totalSampleRecordingTime')}</span>
                  </div>
                </div>
              ) : view === 'dictionary' ? (
                <>
                  <p>{t('openwhispr.home.keepTheRightSpellingForTermsYou')}</p>
                  <label>
                    {t('openwhispr.home.sampleDictionary')}
                    <textarea
                      value={dictionary}
                      onChange={(event) => {
                        setDictionary(event.target.value);
                      }}
                      rows={5}
                    />
                  </label>
                </>
              ) : view === 'uploads' ? (
                <div className="ow-upload">
                  <Upload size={32} />
                  <h3>{t('openwhispr.home.turnRecordingsIntoNotes')}</h3>
                  <p>{t('openwhispr.home.exploreASavedRecordingTranscript')}</p>
                  <PreviewButton onClick={() => openNote(0)}>
                    {t('openwhispr.home.openSampleTranscript')}
                  </PreviewButton>
                </div>
              ) : (
                <>
                  <label>
                    {t('openwhispr.home.dictationShortcut')}
                    <select defaultValue="按住右 Ctrl">
                      <option value="按住右 Ctrl">{t('openwhispr.home.holdRightCtrl')}</option>
                      <option value="按下切换">{t('openwhispr.home.pressToToggle')}</option>
                    </select>
                  </label>
                  <p>{t('openwhispr.home.theFullAppLetsYouConfigureLanguage')}</p>
                </>
              )}
            </main>
          )}
        </div>
      </div>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
