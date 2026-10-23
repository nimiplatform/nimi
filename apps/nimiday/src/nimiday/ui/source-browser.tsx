import { useEffect, useMemo, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { selectSourceEntries, sourceEntries, type SourceEntry, type SourceListMode, type SourceListTarget } from '../domain/source-attention.js';
import { PARENTOS_APP_ID, sourceViewKey } from '../domain/sources.js';
import { SourceChildAction } from './parentos-children.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import { Hint } from './common.js';
import './source-attention.css';

// @nimi-authority: rule.nimi.nimiday.assistant.source-attention-summary
export function SourceBrowser({ target }: { readonly target: SourceListTarget }) {
  const { copy, navigate, activity } = useNimiDay();
  const { state } = useDayStore();
  const { sourceChanges, sourceApps, now, activityStatus } = useEngine();
  const [mode, setMode] = useState(target.mode);
  const [unitKey, setUnitKey] = useState(target.unitKey);
  const [app, setApp] = useState('');
  const [circle, setCircle] = useState('');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(20);
  const [readingOrder, setReadingOrder] = useState<readonly string[]>([]);
  const orderedKeys = useMemo(() => {
    const known = new Set(readingOrder);
    return [...readingOrder, ...sourceChanges.map(sourceViewKey).filter(key => !known.has(key)).sort()];
  }, [readingOrder, sourceChanges]);
  useEffect(() => {
    if (orderedKeys.length !== readingOrder.length) setReadingOrder(orderedKeys);
  }, [orderedKeys, readingOrder.length]);
  const positions = new Map(orderedKeys.map((key, index) => [key, index]));
  const entries = useMemo(() => sourceEntries(state, sourceChanges, now), [state, sourceChanges, now]);
  const apps = [...new Map(sourceChanges.map(change => [change.appId, change.appName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const search = query.trim().toLocaleLowerCase();
  const list = selectSourceEntries(entries, { mode, unitKey }).sort((a, b) =>
    positions.get(sourceViewKey(a.change))! - positions.get(sourceViewKey(b.change))!).filter(({ change }) =>
    (!app || change.appId === app) && (!circle || (circle === 'unassociated' ? !change.circleId : change.circleId === circle))
    && (!search || [change.appName, change.title, change.summary, change.child?.childName,
      state.circles.find(person => person.id === change.circleId)?.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(search)));
  const shown = list.slice(0, visible);
  const associationGroups = new Map<string, SourceEntry[]>();
  if (mode === 'association') for (const entry of shown) {
    const key = entry.change.groupKey ?? `unknown:${entry.change.id}`;
    const group = associationGroups.get(key) ?? []; group.push(entry); associationGroups.set(key, group);
  }
  const ready = activityStatus === 'ready';
  return <section className="nd-source-browser" data-testid="nd-source-browser">
    <div className="nd-source-browser-heading"><h2>{copy.sourceAttention.allSources}</h2>
      <button type="button" className="nd-link" onClick={() => navigate({ view: 'today' })}>{copy.sourceAttention.back}</button></div>
    <div className="nd-source-filters">
      <label>{copy.sourceAttention.status}<select aria-label={copy.sourceAttention.status} value={mode} onChange={event => { setMode(event.target.value as SourceListMode); setUnitKey(undefined); setVisible(20); }}>
        {Object.entries(copy.sourceAttention.modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>{copy.sourceAttention.app}<select aria-label={copy.sourceAttention.app} value={app} onChange={event => { setApp(event.target.value); setVisible(20); }}>
        <option value="">{copy.sourceAttention.allApps}</option>{apps.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      <label>{copy.sourceAttention.object}<select aria-label={copy.sourceAttention.object} value={circle} onChange={event => { setCircle(event.target.value); setVisible(20); }}>
        <option value="">{copy.sourceAttention.allObjects}</option><option value="unassociated">{copy.sourceAttention.unassociated}</option>
        {state.circles.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>{copy.sourceAttention.search}<input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisible(20); }} /></label>
    </div>
    {unitKey ? <div className="nd-source-filter-scope"><span>{copy.sourceAttention.scope}</span>
      <button type="button" className="nd-link" onClick={() => setUnitKey(undefined)}>{copy.sourceAttention.clearScope}</button></div> : null}
    {mode === 'hidden' || mode === 'snoozed' ? <p className="nd-muted">{copy.sourceAttention.hiddenHint}</p> : null}
    {!ready ? <Hint>{activityStatus === 'no-access' ? copy.today.sourcesNoAccess : activityStatus === 'unavailable' ? copy.today.sourcesUnavailable : copy.common.loading}</Hint>
      : list.length === 0 ? <Hint>{copy.sourceAttention.noMatches}</Hint>
      : mode === 'association' ? [...associationGroups].map(([key, group]) => {
        const first = group[0]!.change;
        const directoryGroup = sourceApps.find(source => source.appId === PARENTOS_APP_ID)?.groups.find(candidate => candidate.key === first.groupKey);
        return <section key={key} className="nd-source-association-group">
          <h3>{first.child?.childName ?? copy.sources.unassociated} · {first.appName}</h3>
          {first.child && entries.some(entry => entry.change.groupKey !== first.groupKey && entry.change.child?.childName === first.child?.childName)
            ? <details className="nd-faint"><summary>{copy.settings.sourceIdentity}</summary>
              <p>{copy.settings.childSourceIdentity(first.child.childId, first.child.sourceRef)}</p></details> : null}
          {first.child ? directoryGroup ? <SourceChildAction group={directoryGroup} />
            : <p className="nd-muted">{copy.sourceAttention.directoryMissing}</p>
            : <p className="nd-muted">{copy.sourceAttention.sourceMissing}</p>}
          {group.map(entry => <SourceRow key={entry.change.id} change={entry.change} presentation="care" associationInGroup />)}
        </section>;
      }) : <div className="nd-list">{shown.map(entry => <SourceRow key={entry.change.id} change={entry.change} presentation="care" />)}</div>}
    {ready ? <div className="nd-care-list-footer"><span className="nd-muted">{copy.sourceAttention.showing(shown.length, list.length)}</span>
      {visible < list.length ? <button type="button" className="nd-link" onClick={() => setVisible(count => count + 20)}>{copy.sourceAttention.moreRows}</button> : null}</div> : null}
    <SourceCoverageNote />
    <Button tone="ghost" size="sm" onClick={() => { setReadingOrder([]); activity.retry(); }}>{copy.sourceAttention.refreshSources}</Button>
  </section>;
}
