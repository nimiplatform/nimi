import { Button, Surface } from '@nimiplatform/kit/ui';
import { RefreshCw } from 'lucide-react';

import { useTranslation } from '../../shell/i18n/index.js';
import {
  appAccessSessionFacts,
  appAccessPageCopy,
  appAccessPageIds,
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

export function AppAccessSessionBar({ facts, onRefresh }: { readonly facts: AppAccessSessionFacts; readonly onRefresh: () => void }) {
  const { t } = useTranslation();
  const renderFact = (id: AppAccessSessionFactId) => {
    const meta = appAccessSessionFacts[id];
    const fact = facts[id];
    return (
      <div className="app-access-fact" data-testid={meta.testId} data-state={fact.state}>
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
  };
  return (
    <Surface as="section" tone="panel" padding="none" className="app-access-session" aria-label={t('AppAccess.sessionBar.ariaLabel')}>
      <div className="app-access-session__head">
        <h2 className="app-access-group__title">{t('AppAccess.sessionBar.title')}</h2>
        <Button type="button" tone="ghost" size="sm" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} data-testid={appAccessPageIds.refreshSession} onClick={onRefresh}>
          {t(appAccessPageCopy.refreshSession)}
        </Button>
      </div>
      <div className="app-access-session__grid">
        {renderFact('session')}
        {renderFact('current-user')}
      </div>
      <details className="app-access-diag app-access-session__advanced">
        <summary>{t('AppAccess.sessionBar.developerDetails')}</summary>
        <div className="app-access-session__grid">
          {renderFact('app-process')}
          {renderFact('tooling')}
        </div>
      </details>
    </Surface>
  );
}
