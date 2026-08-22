import { Surface } from '@nimiplatform/kit/ui';

import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessSessionFacts,
  type AppAccessSessionFactId,
} from './app-access-catalog.js';

// Session & Identity facts are three independent facts plus the current user,
// each queried on its own and never derived from one another.

export type AppAccessSessionFact = {
  readonly state: 'checking' | 'ready' | 'unavailable';
  readonly detail: string;
  readonly technical?: string;
};

export type AppAccessSessionFacts = Readonly<Record<AppAccessSessionFactId, AppAccessSessionFact>>;

export function AppAccessSessionBar({ facts }: { readonly facts: AppAccessSessionFacts }) {
  const { t } = useTranslation();
  return (
    <section className="app-access-session" aria-label={t('AppAccess.sessionBar.ariaLabel')}>
      <div className="app-access-session__head">
        <h2 className="app-access-group__title">{t('AppAccess.sessionBar.title')}</h2>
        <p className="app-access-group__blurb">{t('AppAccess.sessionBar.blurb')}</p>
      </div>
      <Surface as="div" tone="panel" material="glass-regular" elevation="base" padding="none" className="app-access-session__panel">
        <div className="app-access-session__grid">
          {(Object.keys(appAccessSessionFacts) as AppAccessSessionFactId[]).map((id) => {
            const meta = appAccessSessionFacts[id];
            const fact = facts[id];
            return (
              <div
                key={id}
                className="app-access-fact"
                data-testid={meta.testId}
                data-state={fact.state}
              >
                <span className="app-access-fact__top">
                  <span className={`app-access-fact__dot app-access-fact__dot--${fact.state}`} aria-hidden="true" />
                  <span className="app-access-fact__label">{t(meta.labelKey)}</span>
                </span>
                <span className="app-access-fact__detail">{fact.detail}</span>
                {fact.technical ? (
                  <details className="app-access-diag">
                    <summary>{t('AppAccess.page.technicalDetails')}</summary>
                    <p className="app-access-diag__note"><code>{fact.technical}</code></p>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </Surface>
    </section>
  );
}
