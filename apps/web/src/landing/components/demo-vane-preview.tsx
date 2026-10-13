import type { PreviewTranslate } from '../i18n/preview-messages.js';
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

const createSampleSources = (t: PreviewTranslate) => [
  {
    title: t('vane.workspace.streetDesignFieldNotes'),
    label: t('vane.workspace.sampleSource1'),
    text: t('vane.workspace.shortCrossingDistancesShadeAndPlacesTo'),
  },
  {
    title: t('vane.workspace.aPublicSpaceReadingList'),
    label: t('vane.workspace.sampleSource2'),
    text: t('vane.workspace.aUsefulWalkingNetworkLinksEverydayDestinations'),
  },
  {
    title: t('vane.workspace.accessForEveryone'),
    label: t('vane.workspace.sampleSource3'),
    text: t('vane.workspace.stepFreeRoutesClearWayfindingAndPredictableCrossings'),
  },
];

/** Vane's compact icon rail, centered research composer and source-led answer surface. */
export function DemoVanePreview({ content }: { content: RemainingPreviewMeta }) {
  const { t } = useAppPreviewLocale();
  const [view, setView] = useState('home');
  const [query, setQuery] = useState(() => t('vane.workspace.howCanSmallCitiesMakeWalkingMore'));
  const [asked, setAsked] = useState(false);
  const [mode, setMode] = useState('Web');
  const [source, setSource] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'home', label: t('vane.workspace.home'), Icon: House },
    { id: 'discover', label: t('vane.workspace.discover'), Icon: Compass },
    { id: 'library', label: t('vane.workspace.library'), Icon: BookOpen },
    { id: 'settings', label: t('vane.workspace.settings'), Icon: Settings },
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
              <h1>{t('vane.page.settings')}</h1>
              <p>{t('vane.page.chooseResearchPreferencesAndConfigureNimiAi')}</p>
              <label>
                {t('vane.page.exampleSearchMode')}
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="Web">{t('vane.page.web')}</option>
                  <option value="Academic">{t('vane.page.academic')}</option>
                  <option value="Writing">{t('vane.page.writing')}</option>
                </select>
              </label>
            </section>
          ) : view === 'library' ? (
            <section className="rp-page">
              <h1>{t('vane.page.library')}</h1>
              <p className="tp-muted">{t('vane.page.savedSampleResearch')}</p>
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
                    {t('vane.page.walkingFriendlyCities')}
                    <small>{t('vane.page.savedInThisPreview')}</small>
                  </span>
                </button>
              ) : (
                <div className="rp-empty">
                  <BookOpen size={32} />
                  <p>{t('vane.page.saveTheResearchExampleToFindIt')}</p>
                  <PreviewButton
                    onClick={() => {
                      setView('home');
                      setAsked(true);
                    }}
                  >
                    {t('vane.page.viewExample')}
                  </PreviewButton>
                </div>
              )}
            </section>
          ) : view === 'discover' ? (
            <section className="rp-page">
              <h1>{t('vane.page.discover')}</h1>
              <div className="vane-discover">
                {[
                  t('vane.page.walkingFriendlyStreets'),
                  t('vane.page.theSoundOfACity'),
                  t('vane.page.aCalmerDailyRoutine'),
                ].map((x, i) => (
                  <button
                    type="button"
                    key={x}
                    onClick={() => {
                      setQuery(i === 0 ? t('vane.page.howCanSmallCitiesMakeWalkingMore') : x);
                      setView('home');
                      setAsked(true);
                    }}
                  >
                    <Globe2 size={24} />
                    <h2>{x}</h2>
                    <span>{t('vane.page.exploreSavedExample')}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className={asked ? 'vane-research' : 'vane-welcome'}>
              {!asked ? (
                <>
                  <h1>{t('vane.main.researchBeginsHere')}</h1>
                  <p>{t('vane.main.followAQuestionExploreItsSources')}</p>
                </>
              ) : (
                <>
                  <h1>{t('vane.main.walkingFriendlyCities')}</h1>
                  <div className="vane-answer-tabs">
                    <span>{t('vane.main.savedResearchExample')}</span>
                    <PreviewButton onClick={() => setSaved(!saved)}>
                      <BookOpen size={15} />
                      {saved ? t('vane.main.savedToLibrary') : t('vane.main.saveExample')}
                    </PreviewButton>
                  </div>
                  <h2>
                    <Globe2 size={17} />
                    {t('vane.main.sources')}
                  </h2>
                  <div className="vane-sources">
                    {createSampleSources(t).map((s, i) => (
                      <button
                        type="button"
                        key={s.title}
                        onClick={() => setSource(source === i ? null : i)}
                      >
                        <span>
                          {i + 1} {' · '}
                          {s.label}
                        </span>
                        <strong>{s.title}</strong>
                        <FileText size={14} />
                      </button>
                    ))}
                  </div>
                  {source !== null && (
                    <section className="vane-source-excerpt">
                      <h3>{createSampleSources(t)[source]!.title}</h3>
                      <p>{createSampleSources(t)[source]!.text}</p>
                      <small>
                        {t('vane.sourceExcerpt.illustrativeExcerptAuthoredForThisPreview')}
                      </small>
                    </section>
                  )}
                  <article className="vane-answer">
                    <h2>{t('vane.main.makeTheEverydayJourneyEasier')}</h2>
                    <p>{t('vane.main.aComfortableWalkCombinesAConnectedRoute')}</p>
                    <ol>
                      <li>
                        <strong>{t('vane.main.connectDailyDestinations')}</strong>{' '}
                        {t('vane.main.startWithTheRoutesPeopleAlready')}
                      </li>
                      <li>
                        <strong>{t('vane.main.makeCrossingsPredictable')}</strong>{' '}
                        {t('vane.main.clearPathsHelpEveryoneNavigate')}
                      </li>
                      <li>
                        <strong>{t('vane.main.offerShadeAndRest')}</strong>{' '}
                        {t('vane.main.treesBenchesAndShelterMakeLonger')}
                      </li>
                    </ol>
                    <p className="tp-muted">
                      {t('vane.main.thisPrewrittenAnswerDemonstratesTheReadingFlow')}
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
                  aria-label={t('vane.main.researchQuestion')}
                  placeholder={t('vane.main.askAnything')}
                  value={query}
                  rows={2}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                />
                <div>
                  <PreviewTabs
                    items={[
                      { value: 'Web', label: t('vane.main.web') },
                      { value: 'Academic', label: t('vane.main.academic') },
                      { value: 'Writing', label: t('vane.main.writing') },
                    ]}
                    value={mode}
                    onChange={setMode}
                    label={t('vane.main.searchFocus')}
                  />
                  <button
                    type="submit"
                    aria-label={t('vane.main.viewSavedResearchExample')}
                    disabled={!query.trim()}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </form>
              {!asked && (
                <div className="vane-suggestions">
                  <button type="button" onClick={() => setAsked(true)}>
                    {t('vane.main.exploreASavedResearchExample')}
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
