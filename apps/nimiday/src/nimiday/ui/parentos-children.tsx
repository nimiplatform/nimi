import { useState } from 'react';
import { Button, SelectField, TextField } from '@nimiplatform/kit/ui';
import { Check, Search } from 'lucide-react';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { PARENTOS_APP_ID, sourceGroupFor, type SourceGroup } from '../domain/sources.js';
import type { CareCircle } from '../domain/types.js';

// @nimi-authority: rule.nimi.nimiday.assistant.child-source-addition
export function SourceChildAction({ group, onAdded, contentLayer = 'popover' }: {
  readonly group: SourceGroup;
  readonly onAdded?: (circle: CareCircle) => void;
  readonly contentLayer?: 'popover' | 'dialog';
}) {
  const { actions, store, copy } = useNimiDay();
  const { sourceApps, directoryStatus } = useEngine();
  const { state } = useDayStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const [existingId, setExistingId] = useState('unselected');
  const children = state.circles.filter(circle => circle.kind === 'child' && circle.status !== 'ended');
  const associated = sourceGroupFor(state.profile, group.key);
  const linked = associated?.appId === PARENTOS_APP_ID && children.some(circle => circle.id === associated.circleId);
  const usable = directoryStatus === 'ready' && group.available;
  const save = async (existing = false) => {
    setBusy(true);
    setError('');
    try {
      const current = sourceApps.find(app => app.appId === PARENTOS_APP_ID)?.groups.find(entry => entry.key === group.key);
      if (!current?.available || !current.child || directoryStatus !== 'ready') {
        setError(copy.childSources.stale);
        return;
      }
      let circle: CareCircle | null;
      if (existing) {
        circle = actions.addSourceChild(current, existingId);
      } else {
        circle = actions.addSourceChild(current);
      }
      if (!circle) { setError(copy.childSources.stale); return; }
      const result = await store.persist();
      if (!result.ok) { setError(copy.childSources.failed); return; }
      setLinking(false);
      onAdded?.(circle);
    } catch {
      setError(copy.childSources.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nd-stack" style={{ gap: 8 }}>
      <div className="nd-inline-actions">
        {linked && !error && !busy ? <span className="nd-child-added"><Check size={14} aria-hidden="true" />{copy.childSources.added}</span>
          : <Button tone="primary" size="sm" loading={busy} disabled={!usable} onClick={() => { void save(); }}>
            {busy ? copy.common.saving : error && linked ? copy.common.retrySave : copy.childSources.add}
          </Button>}
        {!linked && children.length > 0 ? <Button size="sm" tone="ghost" disabled={!usable || busy}
          onClick={() => setLinking(value => !value)}>{copy.childSources.existing}</Button> : null}
      </div>
      {linking ? <div className="nd-inline-actions">
        <SelectField contentLayer={contentLayer} aria-label={copy.care.chooseChildFor(group.child?.childName ?? '')} value={existingId}
          options={[{ value: 'unselected', label: copy.childSources.chooseExisting }, ...children.map(circle => ({ value: circle.id, label: circle.name }))]}
          onValueChange={setExistingId} disabled={!usable || busy} />
        <Button tone="secondary" size="sm" disabled={existingId === 'unselected' || !usable || busy} onClick={() => { void save(true); }}>{copy.common.save}</Button>
      </div> : null}
      {!group.available ? <p className="nd-muted" role="status">{copy.sources.sourceUnavailable}</p> : null}
      {error ? <p className="nd-muted" role="alert">{error}</p> : null}
    </div>
  );
}

export function ParentOSChildren({ onAdded, onSelect, selectedKeys = [], contentLayer = 'popover' }: {
  readonly onAdded?: (circle: CareCircle) => void;
  readonly onSelect?: (group: SourceGroup) => void;
  readonly selectedKeys?: readonly string[];
  readonly contentLayer?: 'popover' | 'dialog';
}) {
  const { copy, activity } = useNimiDay();
  const { state } = useDayStore();
  const { sourceApps, directoryStatus, childDirectory } = useEngine();
  const [query, setQuery] = useState('');
  const groups = sourceApps.find(app => app.appId === PARENTOS_APP_ID)?.groups.filter(group => group.child) ?? [];
  const search = query.trim().toLocaleLowerCase();
  const matches = (group: SourceGroup) => !search || group.child!.childName.toLocaleLowerCase().includes(search);
  const loading = directoryStatus === 'loading' || directoryStatus === 'idle';
  const linked = (group: SourceGroup) => {
    const association = sourceGroupFor(state.profile, group.key);
    return association?.appId === PARENTOS_APP_ID && state.circles.some(circle =>
      circle.id === association.circleId && circle.kind === 'child' && circle.status !== 'ended');
  };
  return (
    <section className="nd-child-picker" aria-label={copy.childSources.title} data-testid="nd-parentos-children">
      <div className="nd-child-picker-heading">
        <strong>{copy.childSources.title}</strong>
        <Button size="sm" tone="ghost" disabled={loading} onClick={() => activity.retry()}>{copy.childSources.refresh}</Button>
      </div>
      <p className="nd-muted nd-child-picker-hint">{copy.childSources.hint}</p>
      {loading ? <p role="status">{copy.common.loading}</p>
        : directoryStatus === 'no-access' ? <p role="status">{copy.childSources.noAccess}</p>
        : directoryStatus === 'unavailable' ? <p role="status">{copy.childSources.unavailable}</p>
        : childDirectory.unavailable && groups.length === 0 ? <p role="status">{copy.sources.sourceUnavailable}</p>
        : groups.length === 0 ? <p role="status">{childDirectory.sources ? copy.childSources.emptyFamily : copy.childSources.empty}</p>
        : <>
          <TextField type="search" aria-label={copy.childSources.search} placeholder={copy.childSources.search} value={query}
            leading={<Search size={16} aria-hidden="true" />} onChange={event => setQuery(event.target.value)} />
          {!groups.some(matches) ? <p className="nd-muted" role="status">{copy.settings.searchEmpty}</p> : null}
          <div className="nd-child-picker-list">{groups.map(group => <div key={group.key} hidden={!matches(group)} className="nd-child-source">
            <div className="nd-child-source-name"><strong>{group.child!.childName}</strong>
            {groups.some(other => other.key !== group.key && other.child!.childName === group.child!.childName) ? <details className="nd-faint">
              <summary>{copy.settings.sourceIdentity}</summary>
              <p style={{ overflowWrap: 'anywhere' }}>{copy.settings.childSourceIdentity(group.child!.childId, group.child!.sourceRef)}</p>
            </details> : null}</div>
            {onSelect ? <Button size="sm" disabled={!group.available || linked(group) || selectedKeys.includes(group.key)}
              onClick={() => onSelect(group)}>{linked(group) ? copy.childSources.added : selectedKeys.includes(group.key) ? copy.childSources.selected : copy.childSources.select}</Button>
              : <SourceChildAction group={group} onAdded={onAdded} contentLayer={contentLayer} />}
            {onSelect && !group.available ? <span className="nd-muted">{copy.sources.sourceUnavailable}</span> : null}
          </div>)}</div>
        </>}
      {groups.length > 0 && directoryStatus === 'ready' ? <details className="nd-child-help">
        <summary>{copy.childSources.missing}</summary>
        <p className="nd-muted">{copy.childSources.coverage}</p>
      </details> : null}
    </section>
  );
}
