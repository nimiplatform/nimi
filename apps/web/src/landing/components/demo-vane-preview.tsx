import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Compass,
  FileText,
  Globe2,
  House,
  Search,
  Settings,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewNav, PreviewTabs, RemainingPreview } from './demo-remaining-shared.js';

const SOURCES = [
  {
    title: 'Street design field notes',
    label: 'Sample source 1',
    text: 'Short crossing distances, shade and places to pause help create more comfortable walking routes.',
  },
  {
    title: 'A public-space reading list',
    label: 'Sample source 2',
    text: 'A useful walking network links everyday destinations such as shops, schools, parks and public transport.',
  },
  {
    title: 'Access for everyone',
    label: 'Sample source 3',
    text: 'Step-free routes, clear wayfinding and predictable crossings help more people use public space.',
  },
];

/** Vane's compact icon rail, centered research composer and source-led answer surface. */
export function DemoVanePreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('home');
  const [query, setQuery] = useState(() =>
    pData('How can small cities make walking more enjoyable?'),
  );
  const [asked, setAsked] = useState(false);
  const [mode, setMode] = useState('Web');
  const [source, setSource] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'home', label: 'Home', Icon: House },
    { id: 'discover', label: 'Discover', Icon: Compass },
    { id: 'library', label: 'Library', Icon: BookOpen },
    { id: 'settings', label: 'Settings', Icon: Settings },
  ];
  return (
    <RemainingPreview content={content} kind="vane">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            setSource(null);
          }}
        />
        <main className="rp-main vane-main">
          {view === 'settings' ? (
            <section className="rp-page">
              <h1>{pText('Settings')}</h1>
              <p>
                {pText('Choose research preferences and configure Nimi AI in the installed App.')}
              </p>
              <label>
                {pText('Example search mode')}
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value={'Web'}>{pText('Web')}</option>
                  <option value={'Academic'}>{pText('Academic')}</option>
                  <option value={'Writing'}>{pText('Writing')}</option>
                </select>
              </label>
            </section>
          ) : view === 'library' ? (
            <section className="rp-page">
              <h1>{pText('Library')}</h1>
              <p className="tp-muted">{pText('Saved sample research')}</p>
              {saved ? (
                <button
                  type="button"
                  className="vane-saved"
                  onClick={() => {
                    setView('home');
                    setAsked(true);
                  }}
                >
                  <Search size={20} />
                  <span>
                    {pText('Walking-friendly cities')}
                    <small>{pText('Saved in this preview')}</small>
                  </span>
                </button>
              ) : (
                <div className="rp-empty">
                  <BookOpen size={32} />
                  <p>{pText('Save the research example to find it here.')}</p>
                  <PreviewButton
                    onClick={() => {
                      setView('home');
                      setAsked(true);
                    }}
                  >
                    {pText('View example')}
                  </PreviewButton>
                </div>
              )}
            </section>
          ) : view === 'discover' ? (
            <section className="rp-page">
              <h1>{pText('Discover')}</h1>
              <div className="vane-discover">
                {['Walking-friendly streets', 'The sound of a city', 'A calmer daily routine'].map(
                  (x, i) => (
                    <button
                      type="button"
                      key={x}
                      onClick={() => {
                        setQuery(
                          i === 0 ? pText('How can small cities make walking more enjoyable?') : x,
                        );
                        setView('home');
                        setAsked(true);
                      }}
                    >
                      <Globe2 size={24} />
                      <h2>{pText(x)}</h2>
                      <span>{pText('Explore saved example')}</span>
                    </button>
                  ),
                )}
              </div>
            </section>
          ) : (
            <div className={asked ? 'vane-research' : 'vane-welcome'}>
              {!asked ? (
                <>
                  <h1>{pText('Research begins here.')}</h1>
                  <p>{pText('Follow a question. Explore its sources.')}</p>
                </>
              ) : (
                <>
                  <h1>{pText('Walking-friendly cities')}</h1>
                  <div className="vane-answer-tabs">
                    <span>{pText('Saved research example')}</span>
                    <PreviewButton onClick={() => setSaved(!saved)}>
                      <BookOpen size={15} />
                      {pText(saved ? 'Saved to library' : 'Save example')}
                    </PreviewButton>
                  </div>
                  <h2>
                    <Globe2 size={17} />
                    {pText('Sources')}
                  </h2>
                  <div className="vane-sources">
                    {SOURCES.map((s, i) => (
                      <button
                        type="button"
                        key={s.title}
                        onClick={() => setSource(source === i ? null : i)}
                      >
                        <span>
                          {pText(i + 1)} {pText(' · ')}
                          {pText(s.label)}
                        </span>
                        <strong>{pText(s.title)}</strong>
                        <FileText size={14} />
                      </button>
                    ))}
                  </div>
                  {source !== null && (
                    <section className="vane-source-excerpt">
                      <h3>{pText(SOURCES[source]!.title)}</h3>
                      <p>{pText(SOURCES[source]!.text)}</p>
                      <small>{pText('Illustrative excerpt authored for this preview.')}</small>
                    </section>
                  )}
                  <article className="vane-answer">
                    <h2>{pText('Make the everyday journey easier')}</h2>
                    <p>
                      {pText(
                        'A comfortable walk combines a connected route with small places to pause. The example sources suggest three practical themes:',
                      )}
                    </p>
                    <ol>
                      <li>
                        <strong>{pText('Connect daily destinations.')}</strong>{' '}
                        {pText(' Start with the routes people already need.')}
                      </li>
                      <li>
                        <strong>{pText('Make crossings predictable.')}</strong>{' '}
                        {pText(' Clear paths help everyone navigate.')}
                      </li>
                      <li>
                        <strong>{pText('Offer shade and rest.')}</strong>{' '}
                        {pText(' Trees, benches and shelter make longer walks easier.')}
                      </li>
                    </ol>
                    <p className="tp-muted">
                      {pText(
                        'This prewritten answer demonstrates the reading flow; it does not answer newly entered questions.',
                      )}
                    </p>
                  </article>
                </>
              )}
              <form
                className="vane-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  setAsked(true);
                }}
              >
                <textarea
                  aria-label={pText('Research question')}
                  placeholder={pText('Ask anything…')}
                  value={query}
                  rows={2}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
                <div>
                  <PreviewTabs
                    items={['Web', 'Academic', 'Writing']}
                    value={mode}
                    onChange={setMode}
                    label={pText('Search focus')}
                  />
                  <button
                    type="submit"
                    aria-label={pText('View saved research example')}
                    disabled={!query.trim()}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </form>
              {!asked && (
                <div className="vane-suggestions">
                  <button type="button" onClick={() => setAsked(true)}>
                    {pText('Explore a saved research example')}
                    <Compass size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
