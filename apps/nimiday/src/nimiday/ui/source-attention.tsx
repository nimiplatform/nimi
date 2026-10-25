import { useEffect, useMemo, useState } from 'react';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { buildSourceAttention, type SourceListTarget } from '../domain/source-attention.js';
import { Hint } from './common.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import './source-attention.css';

export function SourceCompactEntry() {
  const { copy, navigate } = useNimiDay();
  const { state } = useDayStore();
  const { sourceChanges, now, activityStatus, activityCoverage } = useEngine();
  const model = useMemo(() => buildSourceAttention(state, sourceChanges, now), [state, sourceChanges, now]);
  const hint = activityStatus === 'no-access' ? copy.today.sourcesNoAccess
    : activityStatus === 'unavailable' ? copy.today.sourcesUnavailable
    : activityStatus !== 'ready' ? copy.common.loading
    : activityCoverage.openTodos === 'complete' ? copy.sourceAttention.overview(model.openCount, model.appCount)
    : copy.sourceAttention.loaded(model.openCount);
  return <button type="button" className="nd-source-compact" onClick={() => navigate({ view: 'care', sources: { mode: 'pending' } })}>
    <span><strong>{copy.today.fromApps}</strong><span>{hint}</span></span>
    <span className="nd-link">{copy.today.seeAll}</span>
  </button>;
}

// @nimi-authority: rule.nimi.nimiday.assistant.source-attention-summary
export function SourceAttention() {
  const { copy, navigate } = useNimiDay();
  const { state } = useDayStore();
  const { sourceChanges, now, activityStatus, activityCoverage } = useEngine();
  const model = useMemo(() => buildSourceAttention(state, sourceChanges, now), [state, sourceChanges, now]);
  const [keys, setKeys] = useState<readonly string[] | null>(null);
  const nextKeys = model.units.map(unit => unit.key);
  const nextKeyString = JSON.stringify(nextKeys);
  const initialListingSettled = activityCoverage.openTodos !== 'loading' && activityCoverage.recent !== 'loading';
  useEffect(() => {
    if (activityStatus === 'ready' && initialListingSettled && keys === null) setKeys(JSON.parse(nextKeyString) as string[]);
  }, [activityStatus, initialListingSettled, keys, nextKeyString]);
  const units = keys === null ? model.units : keys.flatMap(key => {
    const unit = model.allUnits.find(candidate => candidate.key === key);
    return unit ? [unit] : [];
  });
  const changed = keys !== null && JSON.stringify(keys) !== nextKeyString;
  const open = (target: SourceListTarget, circleId?: string) => navigate({ view: 'care', ...(circleId ? { circleId } : {}), sources: target });
  const shown = units.reduce((count, unit) => count + unit.entries.length, 0);
  return <section data-testid="nd-source-messages">
    <div className="nd-section-heading"><h2>{copy.today.fromApps}</h2>
      <button type="button" className="nd-link" onClick={() => open({ mode: 'pending' })}>{copy.today.seeAll}</button></div>
    {activityStatus === 'no-access' ? <><p className="nd-muted">{copy.today.sourcesNoAccess}</p><p className="nd-faint">{copy.today.sourcesNoAccessBody}</p></>
      : activityStatus === 'unavailable' ? <Hint>{copy.today.sourcesUnavailable}</Hint>
      : activityStatus !== 'ready' ? <Hint>{copy.common.loading}</Hint>
      : <>
        <p className="nd-source-overview">{activityCoverage.openTodos === 'complete' ? copy.sourceAttention.overview(model.openCount, model.appCount) : copy.sourceAttention.loaded(model.openCount)}</p>
        {changed ? <button type="button" className="nd-link nd-source-refresh" onClick={() => setKeys(nextKeys)}>{copy.sourceAttention.refresh}</button> : null}
        {units.length ? <div className="nd-source-section"><h3>{copy.sourceAttention.attention}</h3>
          {units.map(unit => {
            const first = unit.entries[0]!.change;
            const circle = state.circles.find(candidate => candidate.id === first.circleId);
            return <div key={unit.key} data-testid="nd-source-unit">
              {unit.entries.length === 1 ? <SourceRow change={first} presentation="summary" />
                : <button type="button" className="nd-source-summary" onClick={() => open({ mode: 'pending', unitKey: unit.key }, circle?.id)}>
                  <strong>{copy.sourceAttention.groupTitle(circle?.name ?? first.child?.childName ?? first.appName, unit.entries.length)}</strong>
                  <span>{first.appName} · {copy.sourceAttention.reasons[unit.entries[0]!.reason!]}</span>
                  <span className="nd-source-examples">{unit.entries.slice(0, 2).map(entry => entry.change.title).join(' · ')}</span>
                  <span className="nd-source-summary-action">{copy.sourceAttention.viewCount(unit.entries.length)}</span>
                </button>}
            </div>;
          })}</div> : model.attentionCount === 0 && model.association.length === 0 ? <Hint>{copy.sourceAttention.noAttention}</Hint> : null}
        {model.attentionCount > shown ? <button type="button" className="nd-link nd-source-overflow" onClick={() => open({ mode: 'pending' })}>{copy.sourceAttention.more(model.attentionCount - shown)}</button> : null}
        {model.association.length ? <div className="nd-source-section" data-testid="nd-source-unit"><h3>{copy.sourceAttention.association}</h3>
          <button type="button" className="nd-source-summary" onClick={() => open({ mode: 'association' })}>
            <strong>{copy.sourceAttention.associationCount(model.association.length)}</strong><span>{copy.sourceAttention.associationHint}</span>
            <span className="nd-source-summary-action">{copy.sourceAttention.viewAssociation}</span></button></div> : null}
        {model.dynamics.length ? <div className="nd-source-section" data-testid="nd-source-unit"><h3>{copy.sourceAttention.dynamics}</h3>
          <button type="button" className="nd-source-summary" onClick={() => open({ mode: 'dynamics' })}>
            <strong>{copy.sourceAttention.dynamicsCount(model.dynamics.length)}</strong><span>{copy.sourceAttention.dynamicsHint}</span>
            <span className="nd-source-summary-action">{copy.common.open}</span></button></div> : null}
      </>}
    <SourceCoverageNote />
  </section>;
}
