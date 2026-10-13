import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { ArrowUp, BookOpen, FileText, Mic, Plus, Search, Settings, StickyNote } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import {
  PreviewHeading,
  PreviewNav,
  PreviewTabs,
  RemainingPreview,
} from './demo-remaining-shared.js';

const createSampleSources = (t: PreviewTranslate) => [
  {
    name: t('openNotebook.workspace.urbanGardensFieldNotesPdf'),
    type: t('openNotebook.workspace.pdfSampleSource'),
    text: t('openNotebook.workspace.communityGardensCanProvidePlacesToMeet'),
  },
  {
    name: t('openNotebook.workspace.aConversationAboutPublicSpace'),
    type: t('openNotebook.workspace.textSampleSource'),
    text: t('openNotebook.workspace.smallPublicSpacesBecomeUsefulWhenThey'),
  },
  {
    name: t('openNotebook.workspace.questionsForANeighborhoodWalk'),
    type: t('openNotebook.workspace.webSampleSource'),
    text: t('openNotebook.workspace.whoUsesThisPlaceWhatMakesPeople'),
  },
];
const sampleAnswer = (t: PreviewTranslate) =>
  t('openNotebook.workspace.theSampleSourcesConnectGardensWithThree');

/** Open Notebook's fern palette and Sources / Chat / Notes tri-column notebook. */
export function DemoOpenNotebookPreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('notebook');
  const [pane, setPane] = useState('Chat');
  const [selected, setSelected] = useState<number | null>(null);
  const [included, setIncluded] = useState([true, true, true]);
  const [query, setQuery] = useState(() =>
    t('openNotebook.workspace.whatThemesConnectTheseSources'),
  );
  const [asked, setAsked] = useState(false);
  const [notes, setNotes] = useState(() => [
    {
      title: t('openNotebook.workspace.questionsToTakeOnAWalk'),
      body: t('openNotebook.workspace.whoIsThisPlaceForWhatInvites'),
    },
  ]);
  const [activeNote, setActiveNote] = useState(0);
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'sources', label: t('openNotebook.navigation.sources'), Icon: FileText },
    { id: 'notebook', label: t('openNotebook.workspace.notebooks'), Icon: BookOpen },
    { id: 'search', label: t('openNotebook.workspace.askAndSearch'), Icon: Search },
    { id: 'podcasts', label: t('openNotebook.workspace.podcasts'), Icon: Mic },
    { id: 'settings', label: t('openNotebook.workspace.settings'), Icon: Settings },
  ];
  const saveAnswer = () => {
    setNotes((v) => [
      ...v,
      { title: t('openNotebook.workspace.themesAcrossTheSources'), body: sampleAnswer(t) },
    ]);
    setActiveNote(notes.length);
    setPane('Notes');
  };
  return (
    <RemainingPreview content={content} kind="notebook">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            if (id === 'sources') setPane('Sources');
            if (id === 'search') setPane('Chat');
          }}
        />
        <main className="rp-main nb-main">
          <PreviewHeading
            title={
              view === 'podcasts'
                ? t('openNotebook.main.podcasts2')
                : view === 'settings'
                  ? t('openNotebook.main.settings2')
                  : t('openNotebook.main.aMoreWelcomingCity')
            }
            description={t('openNotebook.main.sampleNotebook3Sources')}
          />
          {view === 'podcasts' ? (
            <section className="rp-page">
              <div className="nb-podcast">
                <Mic size={35} />
                <h2>{t('openNotebook.page.turnYourResearchIntoAConversation')}</h2>
                <p>{t('openNotebook.page.inTheFullAppPlanAndProduce')}</p>
                <label>
                  {t('openNotebook.page.episodeBrief')}
                  <textarea
                    defaultValue={t('openNotebook.page.aShortDiscussionAboutCommunityGardensAnd')}
                    rows={4}
                  />
                </label>
                <PreviewButton
                  onClick={() => {
                    setView('notebook');
                    setPane('Notes');
                  }}
                >
                  {t('openNotebook.page.returnToSampleNotes')}
                </PreviewButton>
              </div>
            </section>
          ) : view === 'settings' ? (
            <section className="rp-page">
              <h2>{t('openNotebook.page.notebookPreferences')}</h2>
              <label>
                {t('openNotebook.page.exampleSourceLanguage')}
                <select defaultValue="English">
                  <option value="English">{t('openNotebook.page.english')}</option>
                  <option value="中文">{t('openNotebook.page.chinese')}</option>
                </select>
              </label>
              <p>{t('openNotebook.page.modelsAreSelectedThroughNimiAiConfiguration')}</p>
            </section>
          ) : (
            <>
              <div className="nb-mobile-tabs">
                <PreviewTabs
                  items={[
                    { value: 'Sources', label: t('openNotebook.tabs.sources') },
                    { value: 'Chat', label: t('openNotebook.tabs.chat') },
                    { value: 'Notes', label: t('openNotebook.tabs.notes') },
                  ]}
                  value={pane}
                  onChange={setPane}
                  label={t('openNotebook.main.notebookPanels')}
                />
              </div>
              <div className="nb-columns">
                <section data-active={pane === 'Sources'} className="nb-sources">
                  <div className="nb-column-heading">
                    <h2>
                      <FileText size={17} />
                      {t('openNotebook.sources.sources')}
                    </h2>
                    <span>{createSampleSources(t).length}</span>
                  </div>
                  <p className="tp-muted">
                    {t('openNotebook.sources.chooseWhichExampleSourcesToInclude')}
                  </p>
                  {createSampleSources(t).map((source, i) => (
                    <div className="nb-source" key={source.name}>
                      <input
                        type="checkbox"
                        aria-label={t('openNotebook.sources.include', { sourceName: source.name })}
                        checked={included[i]}
                        onChange={(e) => {
                          setIncluded((v) =>
                            v.map((x, index) => (index === i ? e.target.checked : x)),
                          );
                        }}
                      />
                      <button type="button" onClick={() => setSelected(selected === i ? null : i)}>
                        <strong>{source.name}</strong>
                        <small>{source.type}</small>
                      </button>
                      {selected === i && <p>{source.text}</p>}
                    </div>
                  ))}
                </section>
                <section data-active={pane === 'Chat'} className="nb-chat">
                  <div className="nb-column-heading">
                    <h2>
                      <BookOpen size={17} />
                      {t('openNotebook.chat.chat')}
                    </h2>
                    <span>{t('openNotebook.chat.sampleSession')}</span>
                  </div>
                  <div className="nb-conversation">
                    {asked ? (
                      <article>
                        <h3>{t('openNotebook.chat.themesAcrossTheSources')}</h3>
                        <p>{sampleAnswer(t)}</p>
                        <small>
                          {t('openNotebook.chat.prewrittenExampleAnswerSampleSources13')}
                        </small>
                        <PreviewButton onClick={saveAnswer}>
                          <StickyNote size={14} />
                          {t('openNotebook.chat.saveAsNote')}
                        </PreviewButton>
                      </article>
                    ) : (
                      <div className="nb-empty">
                        <BookOpen size={33} />
                        <h2>{t('openNotebook.chat.letYourSourcesStartAConversation')}</h2>
                        <p>{t('openNotebook.chat.askAQuestionConnectIdeasAndKeep')}</p>
                      </div>
                    )}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAsked(true);
                    }}
                  >
                    <textarea
                      aria-label={t('openNotebook.chat.notebookQuestion')}
                      value={query}
                      rows={3}
                      onChange={(e) => {
                        setQuery(e.target.value);
                      }}
                    />
                    <div>
                      <span>
                        {included.filter(Boolean).length}{' '}
                        {t('openNotebook.chat.sampleSourcesSelected')}
                      </span>
                      <button
                        type="submit"
                        aria-label={t('openNotebook.chat.showSampleNotebookAnswer')}
                        disabled={!query.trim() || !included.some(Boolean)}
                      >
                        <ArrowUp size={18} />
                      </button>
                    </div>
                    <small>{t('openNotebook.chat.thePreviewShowsASavedExampleSource')}</small>
                  </form>
                </section>
                <section data-active={pane === 'Notes'} className="nb-notes">
                  <div className="nb-column-heading">
                    <h2>
                      <StickyNote size={17} />
                      {t('openNotebook.notes.notes')}
                    </h2>
                    <button
                      type="button"
                      aria-label={t('openNotebook.notes.addSampleNote')}
                      onClick={() => {
                        setNotes((v) => [
                          ...v,
                          { title: t('openNotebook.notes.untitledNote'), body: '' },
                        ]);
                        setActiveNote(notes.length);
                        setSaved(false);
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="nb-note-list">
                    {notes.map((n, i) => (
                      <button
                        type="button"
                        key={i}
                        aria-pressed={activeNote === i}
                        onClick={() => {
                          setActiveNote(i);
                          setSaved(false);
                        }}
                      >
                        {n.title || t('openNotebook.notes.untitledNote')}
                      </button>
                    ))}
                  </div>
                  <label>
                    {t('openNotebook.notes.noteTitle')}
                    <input
                      value={notes[activeNote]!.title}
                      onChange={(e) => {
                        setNotes((v) =>
                          v.map((n, i) => (i === activeNote ? { ...n, title: e.target.value } : n)),
                        );
                        setSaved(false);
                      }}
                    />
                  </label>
                  <label>
                    {t('openNotebook.notes.noteContent')}
                    <textarea
                      rows={7}
                      value={notes[activeNote]!.body}
                      onChange={(e) => {
                        setNotes((v) =>
                          v.map((n, i) => (i === activeNote ? { ...n, body: e.target.value } : n)),
                        );
                        setSaved(false);
                      }}
                    />
                  </label>
                  <PreviewButton onClick={() => setSaved(true)}>
                    {saved
                      ? t('openNotebook.notes.keptInThisPreview')
                      : t('openNotebook.notes.saveSampleNote')}
                  </PreviewButton>
                </section>
              </div>
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
