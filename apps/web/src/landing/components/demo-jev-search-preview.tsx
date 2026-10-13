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
  const { pText, previewLang, pData } = useAppPreviewLocale();
  const [query, setQuery] = useState<string>(() => pData(content.query));
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
          {pText('Jev ')}
          <span>{pText('Search')}</span>
        </button>
        <PreviewButton aria-label={pText('Search settings')} onClick={() => setSettings(!settings)}>
          <Settings2 size={17} />
        </PreviewButton>
      </header>
      <main className={`jev-search-main${searched ? ' jev-search-main--results' : ''}`}>
        {settings ? (
          <section className="jev-settings">
            <h2>{pText('Search settings')}</h2>
            <p>
              {pText(
                'In the installed App, connect your Search1API account and choose your AI in Nimi.',
              )}
            </p>
            <p>{pText('This preview uses a saved example and needs no API key.')}</p>
            <PreviewButton onClick={() => setSettings(false)}>
              {pText('Back to search')}
            </PreviewButton>
          </section>
        ) : (
          <>
            {!searched && (
              <>
                <h1 className="jev-wordmark">
                  {pText('Jev ')}
                  <span>{pText('Search')}</span>
                </h1>
                <p className="jev-tagline">{pText(content.tagline)}</p>
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
                aria-label={pText('Search')}
                placeholder={pText('Ask in plain language…')}
                value={query}
                maxLength={300}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
              <button
                type="submit"
                aria-label={pText('Show example search results')}
                disabled={!query.trim()}
              >
                <ArrowUpRight size={21} />
              </button>
            </form>
            {!searched ? (
              <>
                <ul className="jev-examples" aria-label={pText('Example searches')}>
                  {content.examples.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(example);
                          setSearched(true);
                        }}
                      >
                        {pText(example)}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="jev-engine-strip">
                  <span>
                    <Globe2 size={14} />
                    {pText('Google')}
                  </span>
                  <span>{pText('Reddit')}</span>
                  <span>{pText('Hacker News')}</span>
                  <span>{pText('arXiv')}</span>
                </div>
              </>
            ) : (
              <>
                <div className="jev-filter-row">
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  <label>
                    <span className="tp-sr-only">{pText('Source')}</span>
                    <select value={source} onChange={(event) => setSource(event.target.value)}>
                      {['All sources', 'Hacker News', 'Google'].map((item) => (
                        <option value={item} key={item}>
                          {pText(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="tp-sr-only">{pText('Time range')}</span>
                    <select value={range} onChange={(event) => setRange(event.target.value)}>
                      {['Past month', 'Any time', 'Past year'].map((item) => (
                        <option value={item} key={item}>
                          {pText(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {pText(results.length)} {pText(' example links')}
                  </span>
                </div>
                <p className="jev-example-note">
                  {pText(
                    'Saved example results · filters explore this sample, independently of your query.',
                  )}
                </p>
                <ol className="jev-results">
                  {results.map((result) => (
                    <li key={result.title}>
                      <div>
                        <Globe2 size={13} aria-hidden="true" />
                        {pText(result.url)}
                        <span>
                          {pText('· ')}
                          {pText(result.source)}
                        </span>
                      </div>
                      <h2>{pText(result.title)}</h2>
                      <p>{pText(result.description)}</p>
                      <small>
                        <i />
                        {pText(result.relevance)}
                        {pText('% on topic · illustrative score')}
                      </small>
                    </li>
                  ))}
                </ol>
                <PreviewButton onClick={() => setSearched(false)}>
                  <ArrowLeft size={15} />
                  {pText('Back to examples')}
                </PreviewButton>
              </>
            )}
          </>
        )}
      </main>
      <PreviewNotice>{pText(content.notice)}</PreviewNotice>
    </div>
  );
}
