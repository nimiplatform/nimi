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
  return (
    <section className="app-access-session" aria-label="Session and identity">
      <div className="app-access-session__head">
        <h2 className="app-access-group__title">Session &amp; Identity</h2>
        <p className="app-access-group__blurb">Independent facts, each queried on its own — none is derived from another.</p>
      </div>
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
              <span className="app-access-fact__label">{meta.label}</span>
              <span className="app-access-fact__detail">{fact.detail}</span>
              {fact.technical ? (
                <details className="app-access-diag">
                  <summary>Technical details</summary>
                  <p className="app-access-diag__note"><code>{fact.technical}</code></p>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
