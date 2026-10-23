import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, InlineAlert, SelectField, Surface, TextField, Toggle } from '@nimiplatform/kit/ui';
import { RefreshCw, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { PARENTOS_APP_ID, sourceGroupFor, sourcePreferenceFor, type SourceApp } from '../domain/sources.js';
import { toLocalDate } from '../domain/time.js';
import { formatInstant } from '../i18n/index.js';
import { Chip } from './common.js';
import { ParentOSChildren } from './parentos-children.js';
import { SourceCoverageNote } from './source-row.js';

function SourceSettings({ app, hidden }: { readonly app: SourceApp; readonly hidden: boolean }) {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const { now, directoryStatus } = useEngine();
  const [query, setQuery] = useState('');
  const [childrenOpen, setChildrenOpen] = useState(false);
  const profile = state.profile;
  const parentos = app.appId === PARENTOS_APP_ID;
  const preference = sourcePreferenceFor(profile, app.appId);
  const circles = state.circles.filter(circle => circle.status !== 'ended');
  const circleOptions = [{ value: 'auto', label: copy.settings.sourceAuto }, ...circles.map(circle => ({ value: circle.id, label: circle.name }))];
  const groupOptions = [{ value: 'auto', label: copy.settings.sourceGroupFollow }, ...circleOptions.slice(1)];
  const childOptions = [{ value: 'auto', label: copy.sources.unassociated }, ...circles.filter(circle => circle.kind === 'child').map(circle => ({ value: circle.id, label: circle.name }))];
  const selectedFor = (key: string) => {
    const association = sourceGroupFor(profile, key);
    return parentos && (association?.appId !== app.appId || !childOptions.some(option => option.value === association.circleId))
      ? 'auto' : association?.circleId ?? 'auto';
  };
  const linked = app.groups.filter(group => selectedFor(group.key) !== 'auto').length;
  const showGroups = parentos || app.groups.length >= 2 || (app.groups.length >= 1 && app.ungrouped.count > 0);
  const search = query.trim().toLocaleLowerCase();
  const groups = app.groups.map((group, index) => ({ group, name: group.child?.childName ?? copy.settings.sourceGroup(index + 1) }))
    .filter(({ group, name }) => !search || [name, ...group.examples].join(' ').toLocaleLowerCase().includes(search));

  return <Surface as="section" tone="card" elevation="base" padding="none" hidden={hidden} className="nd-settings-source" data-testid="nd-source-setting" aria-label={app.appName}>
    <div className="nd-settings-source-head">
      <div className="nd-settings-source-id">
        <h2>{app.appName}</h2>
        <p className="nd-settings-source-meta">{copy.settings.sourceMeta(app.count, formatInstant(copy, app.latestAt, toLocalDate(now)))}</p>
      </div>
      <div className="nd-settings-follow">
        <span data-on={preference.enabled}>{preference.enabled ? copy.settings.sourceOn : copy.settings.sourceOff}</span>
        <Toggle checked={preference.enabled} ariaLabel={`${copy.settings.sourceFollow} · ${app.appName}`}
          onValueChange={enabled => actions.setSourcePreference({ ...preference, enabled })} />
      </div>
    </div>
    {parentos ? <div className="nd-settings-source-summary">
      <Chip>{copy.settings.sourceChildren(app.groups.length, linked)}</Chip>
      {linked < app.groups.length ? <Chip tone="warning">{copy.settings.sourceNeedsLink(app.groups.length - linked)}</Chip> : null}
    </div> : <div className="nd-settings-source-summary">
      <span>{copy.settings.sourceDefault}</span>
      <Chip tone="accent">{circleOptions.find(option => option.value === (preference.circleId ?? 'auto'))?.label ?? copy.settings.sourceAuto}</Chip>
    </div>}
    {parentos && app.ungrouped.count > 0 ? <InlineAlert tone="warning" className="nd-settings-source-issue" icon={<TriangleAlert size={15} aria-hidden="true" />}>
      {copy.settings.childSourceUnknown(app.ungrouped.count)}
    </InlineAlert> : null}
    <details className="nd-settings-source-details">
      <summary aria-label={copy.settings.sourceConfigureFor(app.appName)}>{copy.settings.sourceConfigure}</summary>
      <div className="nd-settings-source-body">
        {parentos ? <>
          <div className="nd-inline-actions">
            <Button tone="secondary" size="sm" onClick={() => setChildrenOpen(true)}>{copy.settings.manageChildren}</Button>
            <details><summary>{copy.settings.sourceChildHelp}</summary><p className="nd-settings-feedback">{copy.settings.childSourcesHint}</p></details>
          </div>
          {directoryStatus !== 'ready' ? <p className="nd-settings-warning" role="status">{copy.settings.childDirectoryPending}</p> : null}
        </> : <div className="nd-settings-row nd-settings-row--wrap">
          <div className="nd-setting-text"><span className="nd-setting-title">{copy.settings.sourceDefault}</span><span className="nd-setting-hint">{copy.settings.sourceDefaultHint}</span></div>
          <div className="nd-settings-source-select"><SelectField aria-label={`${copy.settings.sourceCircle} · ${app.appName}`} value={preference.circleId ?? 'auto'} options={circleOptions}
            onValueChange={value => actions.setSourcePreference({ ...preference, circleId: value === 'auto' ? null : value })} /></div>
        </div>}
        {showGroups ? <div data-testid="nd-source-groups">
          {!parentos ? <p className="nd-settings-feedback">{copy.settings.sourceGroupsHint(app.appName)}</p> : null}
          {parentos || app.groups.length > 6 || query ? <div className="nd-settings-source-search"><TextField type="search" aria-label={`${copy.settings.groupSearch} · ${app.appName}`} placeholder={copy.settings.groupSearch} value={query}
            leading={<Search size={16} aria-hidden="true" />} onChange={event => setQuery(event.target.value)} /></div> : null}
          {groups.length === 0 && search ? <p className="nd-settings-empty">{copy.settings.searchEmpty}</p> : null}
          {groups.map(({ group, name }) => <div key={group.key} className="nd-settings-row nd-settings-row--wrap" data-testid="nd-source-group">
            <div className="nd-setting-text">
              <span className="nd-setting-title">{name}</span>
              {group.child && app.groups.some(other => other.key !== group.key && other.child?.childName === group.child?.childName)
                ? <details className="nd-settings-group-detail"><summary>{copy.settings.sourceIdentity}</summary>
                  <p>{copy.settings.childSourceIdentity(group.child.childId, group.child.sourceRef)}</p></details> : null}
              {!group.available ? <span className="nd-settings-warning">{copy.sources.sourceUnavailable}</span> : null}
              {group.examples.length > 0 ? <details className="nd-settings-group-detail">
                <summary>{parentos ? copy.settings.sourceChildExamples : copy.settings.sourceExamples}</summary>
                <ul>{group.examples.map((example, index) => <li key={index}>{example}</li>)}</ul>
              </details> : null}
            </div>
            <div className="nd-settings-source-select"><SelectField aria-label={group.child ? copy.settings.associateChild(group.child.childName) : `${app.appName} · ${name}`}
              value={selectedFor(group.key)} options={parentos ? childOptions : groupOptions}
              disabled={parentos && (!group.available || directoryStatus !== 'ready')}
              onValueChange={value => actions.setSourceGroup({ key: group.key, appId: app.appId, circleId: value === 'auto' ? null : value })} /></div>
          </div>)}
          {!parentos && app.ungrouped.count > 0 ? <p className="nd-settings-feedback">{copy.settings.sourceUngrouped(app.ungrouped.examples.join('、'))}</p> : null}
        </div> : null}
      </div>
    </details>
    <Dialog open={childrenOpen} onOpenChange={setChildrenOpen}>
      <DialogContent onClose={() => setChildrenOpen(false)}>
        <DialogHeader className="sr-only"><DialogTitle>{copy.childSources.title}</DialogTitle></DialogHeader>
        <DialogBody>{childrenOpen ? <ParentOSChildren contentLayer="dialog" /> : null}</DialogBody>
        <DialogFooter><Button tone="secondary" onClick={() => setChildrenOpen(false)}>{copy.common.close}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Surface>;
}

export function SettingsSources() {
  const { copy, activity } = useNimiDay();
  const { sourceApps, activityStatus } = useEngine();
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visible = sourceApps.filter(app => app.appName.toLocaleLowerCase().includes(search));
  const loading = activityStatus === 'idle' || activityStatus === 'loading';
  return <>
    <div className="nd-split nd-settings-source-toolbar"><p className="nd-settings-intro">{copy.settings.sourceIntro}</p>
      <Button tone="secondary" size="sm" disabled={loading} onClick={() => activity.retry()}><RefreshCw size={13} aria-hidden="true" />{copy.settings.refresh}</Button>
    </div>
    {activityStatus === 'no-access' ? <div className="nd-settings-empty" role="status"><p>{copy.today.sourcesNoAccess}</p><p>{copy.today.sourcesNoAccessBody}</p></div>
      : <>
        {loading || activityStatus === 'unavailable' ? <p className="nd-settings-feedback" role="status">{loading ? copy.common.loading : copy.settings.sourceUnavailable}</p> : null}
        {sourceApps.length > 0 || query ? <div className="nd-settings-source-search nd-settings-app-search"><TextField type="search" aria-label={copy.settings.sourceSearch} placeholder={copy.settings.sourceSearch} value={query}
          leading={<Search size={16} aria-hidden="true" />} onChange={event => setQuery(event.target.value)} /></div> : null}
        {activityStatus === 'ready' && sourceApps.length === 0 ? <p className="nd-settings-empty">{copy.settings.sourcesEmpty}</p> : null}
        {search && visible.length === 0 ? <p className="nd-settings-empty">{copy.settings.searchEmpty}</p> : null}
        <div className="nd-settings-source-list">{sourceApps.map(app => <SourceSettings key={app.appId} app={app} hidden={!visible.includes(app)} />)}</div>
        <SourceCoverageNote />
      </>}
    <InlineAlert tone="neutral" className="nd-settings-note" icon={<ShieldCheck size={16} aria-hidden="true" />}>
      <strong>{copy.settings.sourcePrivacy}</strong>
      <p>{copy.settings.sourcesHint}</p>
    </InlineAlert>
  </>;
}
