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

const SOURCES = [
  {
    name: 'Urban gardens — field notes.pdf',
    type: 'PDF · Sample source',
    text: 'Community gardens can provide places to meet, learn practical skills, and share responsibility for a small patch of the city.',
  },
  {
    name: 'A conversation about public space',
    type: 'Text · Sample source',
    text: 'Small public spaces become useful when they are easy to reach, comfortable to stay in, and welcoming to different needs.',
  },
  {
    name: 'Questions for a neighborhood walk',
    type: 'Web · Sample source',
    text: 'Who uses this place? What makes people stay? Where could shade or a seat make a difference?',
  },
];
const ANSWER =
  'The sample sources connect gardens with three ideas: shared care, informal learning, and welcoming public space. A useful next step is to note who uses a place and what helps them stay.';

/** Open Notebook's fern palette and Sources / Chat / Notes tri-column notebook. */
export function DemoOpenNotebookPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('notebook');
  const [pane, setPane] = useState('Chat');
  const [selected, setSelected] = useState<number | null>(null);
  const [included, setIncluded] = useState([true, true, true]);
  const [query, setQuery] = useState(() => pData('What themes connect these sources?'));
  const [asked, setAsked] = useState(false);
  const [notes, setNotes] = useState(() =>
    pData([
      {
        title: 'Questions to take on a walk',
        body: 'Who is this place for? What invites people to pause?',
      },
    ]),
  );
  const [activeNote, setActiveNote] = useState(0);
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'sources', label: 'Sources', Icon: FileText },
    { id: 'notebook', label: 'Notebooks', Icon: BookOpen },
    { id: 'search', label: 'Ask and Search', Icon: Search },
    { id: 'podcasts', label: 'Podcasts', Icon: Mic },
    { id: 'settings', label: 'Settings', Icon: Settings },
  ];
  const saveAnswer = () => {
    setNotes((v) => [...v, { title: pText('Themes across the sources'), body: pText(ANSWER) }]);
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
            title={pText(
              view === 'podcasts'
                ? 'Podcasts'
                : view === 'settings'
                  ? 'Settings'
                  : 'A more welcoming city',
            )}
            description={pText('Sample notebook · 3 sources')}
          />
          {view === 'podcasts' ? (
            <section className="rp-page">
              <div className="nb-podcast">
                <Mic size={35} />
                <h2>{pText('Turn your research into a conversation')}</h2>
                <p>
                  {pText(
                    'In the full App, plan and produce an audio discussion from your notebook sources.',
                  )}
                </p>
                <label>
                  {pText('Episode brief')}
                  <textarea
                    defaultValue={pText(
                      'A short discussion about community gardens and shared public space.',
                    )}
                    rows={4}
                  />
                </label>
                <PreviewButton
                  onClick={() => {
                    setView('notebook');
                    setPane('Notes');
                  }}
                >
                  {pText('Return to sample notes')}
                </PreviewButton>
              </div>
            </section>
          ) : view === 'settings' ? (
            <section className="rp-page">
              <h2>{pText('Notebook preferences')}</h2>
              <label>
                {pText('Example source language')}
                <select defaultValue="English">
                  <option value={'English'}>{pText('English')}</option>
                  <option value={'中文'}>{pText('中文')}</option>
                </select>
              </label>
              <p>
                {pText('Models are selected through Nimi AI configuration in the installed App.')}
              </p>
            </section>
          ) : (
            <>
              <div className="nb-mobile-tabs">
                <PreviewTabs
                  items={['Sources', 'Chat', 'Notes']}
                  value={pane}
                  onChange={setPane}
                  label={pText('Notebook panels')}
                />
              </div>
              <div className="nb-columns">
                <section data-active={pane === 'Sources'} className="nb-sources">
                  <div className="nb-column-heading">
                    <h2>
                      <FileText size={17} />
                      {pText('Sources')}
                    </h2>
                    <span>{pText(SOURCES.length)}</span>
                  </div>
                  <p className="tp-muted">{pText('Choose which example sources to include.')}</p>
                  {SOURCES.map((source, i) => (
                    <div className="nb-source" key={source.name}>
                      <input
                        type="checkbox"
                        aria-label={pText(`Include ${source.name}`)}
                        checked={included[i]}
                        onChange={(e) => {
                          setIncluded((v) =>
                            v.map((x, index) => (index === i ? e.target.checked : x)),
                          );
                        }}
                      />
                      <button type="button" onClick={() => setSelected(selected === i ? null : i)}>
                        <strong>{pText(source.name)}</strong>
                        <small>{pText(source.type)}</small>
                      </button>
                      {selected === i && <p>{pText(source.text)}</p>}
                    </div>
                  ))}
                </section>
                <section data-active={pane === 'Chat'} className="nb-chat">
                  <div className="nb-column-heading">
                    <h2>
                      <BookOpen size={17} />
                      {pText('Chat')}
                    </h2>
                    <span>{pText('Sample session')}</span>
                  </div>
                  <div className="nb-conversation">
                    {asked ? (
                      <article>
                        <h3>{pText('Themes across the sources')}</h3>
                        <p>{pText(ANSWER)}</p>
                        <small>{pText('Prewritten example answer · sample sources 1–3')}</small>
                        <PreviewButton onClick={saveAnswer}>
                          <StickyNote size={14} />
                          {pText('Save as note')}
                        </PreviewButton>
                      </article>
                    ) : (
                      <div className="nb-empty">
                        <BookOpen size={33} />
                        <h2>{pText('Let your sources start a conversation.')}</h2>
                        <p>{pText('Ask a question, connect ideas, and keep what matters.')}</p>
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
                      aria-label={pText('Notebook question')}
                      value={query}
                      rows={3}
                      onChange={(e) => {
                        setQuery(e.target.value);
                      }}
                    />
                    <div>
                      <span>
                        {pText(included.filter(Boolean).length)} {pText(' sample sources selected')}
                      </span>
                      <button
                        type="submit"
                        aria-label={pText('Show sample notebook answer')}
                        disabled={!query.trim() || !included.some(Boolean)}
                      >
                        <ArrowUp size={18} />
                      </button>
                    </div>
                    <small>
                      {pText(
                        'The preview shows a saved example; source choices do not run retrieval.',
                      )}
                    </small>
                  </form>
                </section>
                <section data-active={pane === 'Notes'} className="nb-notes">
                  <div className="nb-column-heading">
                    <h2>
                      <StickyNote size={17} />
                      {pText('Notes')}
                    </h2>
                    <button
                      type="button"
                      aria-label={pText('Add sample note')}
                      onClick={() => {
                        setNotes((v) => [...v, { title: pText('Untitled note'), body: '' }]);
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
                        {n.title || pText('Untitled note')}
                      </button>
                    ))}
                  </div>
                  <label>
                    {pText('Note title')}
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
                    {pText('Note content')}
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
                    {pText(saved ? 'Kept in this preview' : 'Save sample note')}
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
