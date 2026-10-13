import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Globe2,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import type { JevSearchPreviewContent } from '../content/landing-content.third-party.js';
import { PreviewButton, PreviewNotice } from './demo-third-party-shared.js';

/** Landing-owned replica of jev-search's routes/index, search-box, filters and results. */
export function DemoJevSearchPreview({ content }: { content: JevSearchPreviewContent }) {
  const { previewLang, t } = useAppPreviewLocale();
  const [query, setQuery] = useState<string>(() => content.query);
  const [searched, setSearched] = useState(false);
  const [source, setSource] = useState('All sources');
  const [settings, setSettings] = useState(false);
  const [range, setRange] = useState('Past month');
  const results = content.results.filter(
    (result) => source === 'All sources' || result.source === source,
  );
  return (
    <div className="tp-preview jev-search-preview" data-demo-jev-search-root lang={previewLang}>
      <header className="jev-search-header">
        <button type="button" className="jev-wordmark" onClick={() => setSearched(false)}>
          {t('jevSearch.searchHeader.jev')}
          <span>{t('jevSearch.searchHeader.search')}</span>
        </button>
        <PreviewButton
          aria-label={t('jevSearch.searchHeader.searchSettings')}
          onClick={() => setSettings(!settings)}
        >
          <Settings2 size={17} />
        </PreviewButton>
      </header>
      <main className={`jev-search-main${searched ? ' jev-search-main--results' : ''}`}>
        {settings ? (
          <section className="jev-settings">
            <h2>{t('jevSearch.settings.searchSettings')}</h2>
            <p>{t('jevSearch.settings.inTheInstalledAppConnectYourSearch1api')}</p>
            <p>{t('jevSearch.settings.thisPreviewUsesASavedExampleAnd')}</p>
            <PreviewButton onClick={() => setSettings(false)}>
              {t('jevSearch.settings.backToSearch')}
            </PreviewButton>
          </section>
        ) : (
          <>
            {!searched && (
              <>
                <h1 className="jev-wordmark">
                  {t('jevSearch.workspace.jev')}
                  <span>{t('jevSearch.workspace.search')}</span>
                </h1>
                <p className="jev-tagline">{content.tagline}</p>
              </>
            )}
            <form
              className="jev-query"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim()) setSearched(true);
              }}
            >
              <Search size={20} aria-hidden="true" />
              <input
                aria-label={t('jevSearch.workspace.search')}
                placeholder={t('jevSearch.workspace.askInPlainLanguage')}
                value={query}
                maxLength={300}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              <button
                type="submit"
                aria-label={t('jevSearch.workspace.showExampleSearchResults')}
                disabled={!query.trim()}
              >
                <ArrowUpRight size={21} />
              </button>
            </form>
            {!searched ? (
              <>
                <ul className="jev-examples" aria-label={t('jevSearch.workspace.exampleSearches')}>
                  {content.examples.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(example);
                          setSearched(true);
                        }}
                      >
                        {example}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="jev-engine-strip">
                  <span>
                    <Globe2 size={14} />
                    {t('jevSearch.workspace.google')}
                  </span>
                  <span>{t('jevSearch.workspace.reddit')}</span>
                  <span>{t('jevSearch.workspace.hackerNews')}</span>
                  <span>{t('jevSearch.workspace.arXiv')}</span>
                </div>
              </>
            ) : (
              <>
                <div className="jev-filter-row">
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  <label>
                    <span className="tp-sr-only">{t('jevSearch.workspace.source')}</span>
                    <select value={source} onChange={(event) => setSource(event.target.value)}>
                      {['All sources', 'Hacker News', 'Google'].map((item) => (
                        <option value={item} key={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="tp-sr-only">{t('jevSearch.workspace.timeRange')}</span>
                    <select value={range} onChange={(event) => setRange(event.target.value)}>
                      {[
                        t('jevSearch.workspace.pastMonth'),
                        t('jevSearch.workspace.anyTime'),
                        t('jevSearch.workspace.pastYear'),
                      ].map((item) => (
                        <option value={item} key={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {results.length} {t('jevSearch.workspace.exampleLinks')}
                  </span>
                </div>
                <p className="jev-example-note">
                  {t('jevSearch.workspace.savedExampleResultsFiltersExploreThis')}
                </p>
                <ol className="jev-results">
                  {results.map((result) => (
                    <li key={result.title}>
                      <div>
                        <Globe2 size={13} aria-hidden="true" />
                        {result.url}
                        <span>
                          {'· '}
                          {result.source}
                        </span>
                      </div>
                      <h2>{result.title}</h2>
                      <p>{result.description}</p>
                      <small>
                        <i />
                        {result.relevance}
                        {t('jevSearch.workspace.onTopicIllustrativeScore')}
                      </small>
                    </li>
                  ))}
                </ol>
                <PreviewButton onClick={() => setSearched(false)}>
                  <ArrowLeft size={15} />
                  {t('jevSearch.workspace.backToExamples')}
                </PreviewButton>
              </>
            )}
          </>
        )}
      </main>
      <PreviewNotice>{content.notice}</PreviewNotice>
    </div>
  );
}
