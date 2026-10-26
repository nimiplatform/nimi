import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfirmDialog, nimiToast, StatusBadge } from '@nimiplatform/kit/ui';
import { ChevronRight, LayoutList, ListFilter, NotebookText, Pin, Plus, Search, Sparkles } from 'lucide-react';
import { isActive } from '../domain/reminders.js';
import { CARE_REVIEW_SKILL } from '../domain/skills.js';
import { attentionOrder, PARENTOS_APP_ID, type SourceChange } from '../domain/sources.js';
import type { CareCircle } from '../domain/types.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Card, Chip, CircleIcon, Hint, MenuButton, PageHead } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import { useUi } from './ui-context.js';
import { careChanges, careItems } from './care-summary.js';
import { SourceChildAction } from './parentos-children.js';
import { SourceBrowser } from './source-browser.js';
import type { SourceListTarget } from '../domain/source-attention.js';

type CareSection = 'changes' | 'items' | 'notes';
const CHANGE_PREVIEW_COUNT = 6;

// @nimi-authority: rule.nimi.nimiday.assistant.child-source-association
// @nimi-authority: rule.nimi.nimiday.assistant.source-attention-summary
export function CarePage({ circleId, sources }: { readonly circleId?: string; readonly sources?: SourceListTarget }) {
  const { copy, navigate } = useNimiDay();
  const { state } = useDayStore();
  const { changes, activityStatus } = useEngine();
  const ui = useUi();
  const pageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<CareSection>('changes');
  const [query, setQuery] = useState('');
  const [updateQuery, setUpdateQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  useEffect(() => {
    if (sources) setSection('changes');
    setUpdateQuery('');
    setUnreadOnly(false);
  }, [circleId, sources]);
  const circle = state.circles.find(entry => entry.id === circleId);
  const circles = useMemo(() => [...state.circles].sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended')), [state.circles]);
  const shownCircles = circles.filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const { grouped, pending, unknown, other } = useMemo(() => careChanges(changes, circles), [changes, circles]);
  const allUpdates = attentionOrder(grouped.flatMap(group => group.list));
  // Only explicitly associated records may enter a person's workspace.
  const updates = circle ? attentionOrder(changes.filter(change => change.circleId === circle.id)) : allUpdates;
  const items = circle ? careItems(state.items, circle.id) : state.items.filter(item => isActive(item) && circles.some(entry => entry.id === item.circleId))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? ''));
  const notes = state.notes.filter(note => !circle || note.circleId === circle.id);
  const unread = updates.filter(change => change.unread).length;
  const tabs = [
    { id: 'changes' as const, label: copy.care.updates, count: updates.length },
    { id: 'items' as const, label: copy.care.items, count: items.length },
    { id: 'notes' as const, label: copy.care.notes, count: notes.length },
  ];
  const select = (id?: string) => {
    navigate({ view: 'care', ...(id ? { circleId: id } : {}) });
    if (sources) setSection('changes');
    setQuery('');
    pageRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div ref={pageRef} className="nd-page nd-care-workspace" data-testid="nd-care">
      <PageHead title={copy.care.title}
        action={<Button tone="primary" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editCircle(null)}>{copy.care.add}</Button>} />
      <section className="nd-care-content" aria-label={circle?.name ?? copy.care.everyone}>
        <header className="nd-care-context">
          <div><h2>{circle?.name ?? copy.care.everyone}</h2>{circle ? <p>{copy.kinds.circle[circle.kind]}</p> : null}</div>
          {circle ? <CircleActions key={circle.id} circle={circle} /> : null}
        </header>
        {circle ? <div className="nd-care-focus">
          <span className="nd-care-focus-icon"><Pin size={14} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="nd-care-label">{copy.care.watchLabel}</span>
          <button type="button" className="nd-link nd-care-focus-value" onClick={() => ui.editCircle(circle.id)}>
            <span>{circle.watch || copy.care.addWatch}</span>
            <ChevronRight size={13} aria-hidden="true" />
          </button>
          {circle.focus.map(tag => <Chip key={tag}>{tag}</Chip>)}
          {circle.status !== 'active' ? <StatusBadge tone="neutral">{copy.kinds.circleStatus[circle.status]}</StatusBadge> : null}
        </div> : null}
        <nav className="nd-care-people" aria-label={copy.care.people}>
          <label className="nd-care-mobile-picker"><span>{copy.care.people}</span><select value={circle?.id ?? ''} onChange={event => select(event.target.value || undefined)}><option value="">{copy.care.everyone}</option>{circles.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.status !== 'active' ? ' · ' + copy.kinds.circleStatus[entry.status] : ''}</option>)}</select></label>
          <div className="nd-care-people-heading">{copy.care.people}<span>{circles.length}</span></div>
          {circles.length > 8 ? <label className="nd-care-search"><Search size={15} aria-hidden="true" /><input aria-label={copy.care.findPerson} placeholder={copy.care.findPerson} value={query} onChange={event => setQuery(event.target.value)} /></label> : null}
          <div className="nd-care-person-list">
            <button type="button" className="nd-care-person" aria-current={!circle ? 'true' : undefined} onClick={() => select()}>
              <span className="nd-care-all-icon"><LayoutList size={18} aria-hidden="true" /></span><span className="nd-care-person-name">{copy.care.everyone}</span>
              <span className="nd-care-count">{allUpdates.length}</span>
            </button>
            {shownCircles.map(entry => {
              const fresh = changes.filter(change => change.circleId === entry.id && change.unread).length;
              return <button key={entry.id} type="button" className="nd-care-person" aria-current={circle?.id === entry.id ? 'true' : undefined} onClick={() => select(entry.id)}>
                <CircleIcon kind={entry.kind} size={17} />
                <span className="nd-care-person-text"><span className="nd-care-person-name">{entry.name}</span><span className="nd-care-person-kind">{entry.status === 'active' ? (entry.name === copy.kinds.circle[entry.kind] ? '' : copy.kinds.circle[entry.kind]) : copy.kinds.circleStatus[entry.status]}</span></span>
                {fresh > 0 ? <span className="nd-care-count" aria-label={copy.care.unreadChanges(fresh)}>{fresh}</span> : null}
              </button>;
            })}
          </div>
          {query && shownCircles.length === 0 ? <p className="nd-care-section-hint">{copy.care.noMatches}</p> : null}
          {circles.length === 0 ? <p className="nd-care-section-hint">{copy.care.emptyBody}</p> : null}
        </nav>
        <div className="nd-care-tabs-row">
          <div className="nd-care-tabs" role="tablist" aria-label={copy.care.contentLabel}>
            {tabs.map(tab => <button key={tab.id} id={'care-tab-' + tab.id} type="button" role="tab" aria-selected={section === tab.id} aria-controls="care-panel" tabIndex={section === tab.id ? 0 : -1}
              onClick={() => setSection(tab.id)} onKeyDown={event => {
                const index = tabs.findIndex(entry => entry.id === tab.id);
                const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                if (next !== null) { event.preventDefault(); setSection(tabs[next]!.id); document.getElementById('care-tab-' + tabs[next]!.id)?.focus(); }
              }}>{tab.label}<span>{tab.count}</span></button>)}
          </div>
          {section === 'changes' && !sources ? <div className="nd-care-update-tools">
            <label className="nd-care-search nd-care-update-search">
              <Search size={15} aria-hidden="true" />
              <input type="search" aria-label={copy.care.findUpdate} placeholder={copy.care.findUpdate} value={updateQuery} onChange={event => setUpdateQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setUpdateQuery(''); }} />
            </label>
            <button type="button" className="nd-care-filter-button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(value => !value)}><ListFilter size={15} aria-hidden="true" />{copy.care.onlyUnread}</button>
          </div> : null}
        </div>
        <div id="care-panel" role="tabpanel" aria-labelledby={'care-tab-' + section} tabIndex={0} className="nd-care-panel">
          {section === 'changes' ? sources ? <SourceBrowser key={JSON.stringify([circle?.id, sources])} target={sources} circleId={circle?.id} /> : <>
            <div className="nd-care-section-intro nd-care-source-notice">
              <Sparkles size={16} aria-hidden="true" />
              <p>{copy.care.updatesHint}</p>
              {unread > 0 ? <span>{copy.care.unreadChanges(unread)}</span> : null}
              <button type="button" className="nd-care-source-notice-link" aria-label={copy.sourceAttention.allSources} title={copy.sourceAttention.allSources} onClick={() => navigate({ view: 'care', sources: { mode: 'pending' } })}><ChevronRight size={17} aria-hidden="true" /></button>
            </div>
            {!circle && activityStatus !== 'no-access' && activityStatus !== 'unavailable' ? <UnassignedChanges pending={pending} unknown={unknown} other={other} /> : null}
            {activityStatus === 'no-access' ? <div className="nd-care-blank"><p>{copy.today.sourcesNoAccess}</p><p>{copy.today.sourcesNoAccessBody}</p></div>
              : activityStatus === 'unavailable' ? <Hint>{copy.care.changesUnavailable}</Hint>
              : updates.length === 0 ? <div className="nd-care-blank"><p>{activityStatus === 'ready' ? copy.care.noChanges : copy.common.loading}</p><p>{copy.care.noChangesHint}</p></div>
              : <ChangePreview key={circle?.id ?? 'all'} changes={updates} showCircle={!circle} query={updateQuery} unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly} showHeading />}
            <SourceCoverageNote />
          </> : section === 'items' ? <>
            <div className="nd-care-section-intro"><p>{circle ? copy.care.itemsHint : copy.care.allItemsHint}</p>{circle ? <Button size="sm" tone="secondary" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.newItem({ circleId: circle.id })}>{copy.item.new}</Button> : null}</div>
            {circle ? <QuickCapture key={circle.id} circleId={circle.id} /> : null}
            {items.length === 0 ? <Hint>{copy.care.noItems}</Hint> : <div className="nd-list">{items.map(item => <ItemRow key={item.id} item={item} layout="title-first" showFullDate showSnooze />)}</div>}
          </> : <HandbookCard key={circle?.id ?? 'all'} circleId={circle?.id ?? null} />}
        </div>
      </section>
    </div>
  );
}

function ChangePreview({ changes, associationInGroup = false, showCircle = true, query = '', unreadOnly: controlledUnreadOnly, onUnreadOnlyChange, showHeading = false }: {
  readonly changes: readonly SourceChange[];
  readonly associationInGroup?: boolean;
  readonly showCircle?: boolean;
  readonly query?: string;
  readonly unreadOnly?: boolean;
  readonly onUnreadOnlyChange?: (value: boolean) => void;
  readonly showHeading?: boolean;
}) {
  const { copy } = useNimiDay();
  const { state } = useDayStore();
  const [visible, setVisible] = useState(CHANGE_PREVIEW_COUNT);
  const [localUnreadOnly, setLocalUnreadOnly] = useState(false);
  const unreadOnly = controlledUnreadOnly ?? localUnreadOnly;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = changes.filter(change => {
    if (unreadOnly && !change.unread) return false;
    if (!normalizedQuery) return true;
    const circleName = change.circleId ? state.circles.find(circle => circle.id === change.circleId)?.name ?? '' : '';
    return [change.title, change.summary ?? '', change.appName, change.child?.childName ?? '', circleName]
      .join(' ').toLocaleLowerCase().includes(normalizedQuery);
  });
  useEffect(() => { setVisible(CHANGE_PREVIEW_COUNT); }, [query, unreadOnly]);
  const updateUnreadOnly = (value: boolean) => {
    if (onUnreadOnlyChange) onUnreadOnlyChange(value);
    else setLocalUnreadOnly(value);
  };
  return <>
    {showHeading ? <div className="nd-care-updates-heading"><h3>{copy.care.linkedChanges}<span>{list.length}</span></h3></div> : null}
    {!onUnreadOnlyChange ? <div className="nd-care-filter"><label><input type="checkbox" checked={unreadOnly} onChange={event => updateUnreadOnly(event.target.checked)} />{copy.care.onlyUnread}</label></div> : null}
    <div className="nd-list">{list.slice(0, visible).map(change => <SourceRow key={change.id} change={change} presentation="care" showCircle={showCircle} associationInGroup={associationInGroup} />)}</div>
    {list.length === 0 ? <Hint>{normalizedQuery ? copy.care.noMatchingUpdates : copy.care.noUnread}</Hint> : null}
    {list.length > CHANGE_PREVIEW_COUNT ? <div className="nd-care-list-footer">
      <span className="nd-muted">{copy.care.showingChanges(Math.min(visible, list.length), list.length)}</span>
      {visible < list.length ? <button type="button" className="nd-link" onClick={() => setVisible(count => count + CHANGE_PREVIEW_COUNT)}>{copy.care.loadMoreUpdates(Math.min(CHANGE_PREVIEW_COUNT, list.length - visible))}</button> : null}
      {visible > CHANGE_PREVIEW_COUNT ? <button type="button" className="nd-link" onClick={() => setVisible(CHANGE_PREVIEW_COUNT)}>{copy.care.showLessChanges}</button> : null}
    </div> : null}
  </>;
}

function UnassignedChanges({ pending, unknown, other }: Pick<ReturnType<typeof careChanges>, 'pending' | 'unknown' | 'other'>) {
  const { copy } = useNimiDay();
  const { sourceApps } = useEngine();
  const sourceChildren = sourceApps.find(app => app.appId === PARENTOS_APP_ID)?.groups ?? [];
  if (!pending.length && !unknown.length && !other.length) return null;
  return <details className="nd-care-unassigned">
    <summary>{copy.care.unassigned} <span>{pending.reduce((count, group) => count + group.list.length, 0) + unknown.length + other.length}</span></summary>
    <p className="nd-care-section-hint">{copy.care.unassignedHint}</p>
              {pending.length > 0 ? (
                <section aria-label={copy.care.pendingAssociation} className="nd-care-pending">
                  <h3 className="nd-care-section-title">{copy.care.pendingAssociation}</h3>
                  <p className="nd-care-section-hint">{copy.care.pendingHint}</p>
                  {pending.map(({ key, list }) => (
                    <section key={key} className="nd-care-source-group">
                      <div className="nd-circle-group-head">
                        <CircleIcon kind="child" size={16} />
                        <div className="nd-care-source-person">
                          <span className="nd-circle-group-name">{list[0]!.child!.childName}</span>
                          <span className="nd-muted">{copy.care.updatesFrom(list[0]!.appName)}</span>
                        </div>
                      </div>
                      <p className="nd-care-group-examples">{[...new Set(list.map((change) => change.title))].slice(0, 2).join(' · ')}</p>
                      {!list.some((change) => change.sourceAvailable) ? <p className="nd-care-section-hint">{copy.sources.sourceUnavailable}</p> : null}
                      {sourceChildren.find(group => group.key === key) ? <SourceChildAction group={sourceChildren.find(group => group.key === key)!} /> : null}
                      <details className="nd-care-change-disclosure">
                        <summary>{copy.care.browseChanges(list.length)}</summary>
                        <ChangePreview changes={list} associationInGroup />
                        <details className="nd-care-source-identity">
                          <summary>{copy.care.recordDetails}</summary>
                          <p>{copy.settings.childSourceIdentity(list[0]!.child!.childId, list[0]!.child!.sourceRef)}</p>
                        </details>
                      </details>
                    </section>
                  ))}
                </section>
              ) : null}
              {unknown.length > 0 ? (
                <details className="nd-care-unconfirmed">
                  <summary>{copy.care.unconfirmedRecords(unknown.length)}</summary>
                  <p className="nd-care-section-hint">{copy.care.unconfirmedHint}</p>
                  <ChangePreview changes={unknown} />
                </details>
              ) : null}

    {other.length > 0 ? <section><h3 className="nd-care-section-title">{copy.care.otherChanges}</h3><ChangePreview changes={other} /></section> : null}
  </details>;
}

function CircleActions({ circle }: { readonly circle: CareCircle }) {
  const { copy, navigate, actions, engine } = useNimiDay();
  const desk = useDesk();
  const ui = useUi();
  const agentName = desk.agent?.displayName ?? copy.common.agentFallback;
  const [confirming, setConfirming] = useState<'end' | 'delete' | null>(null);
  const review = async () => {
    const result = await engine.startSkill({ skillId: CARE_REVIEW_SKILL, trigger: 'user', focusCircleId: circle.id });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else navigate({ view: 'routines', runId: result.runId });
  };
  return <div className="nd-care-person-actions">
        <div className="nd-inline-actions">
          <Button tone="secondary" size="sm" disabled={desk.phase !== 'ready' || !desk.canUseWork || circle.status === 'ended'} onClick={() => { void review(); }}>
            {copy.care.review(agentName)}
          </Button>
          <MenuButton
            label={copy.common.more}
            items={[
              { id: 'edit', label: copy.common.edit, onSelect: () => ui.editCircle(circle.id) },
              circle.status === 'active' ? { id: 'pause', label: copy.care.pause, onSelect: () => actions.setCircleStatus(circle.id, 'paused') } : null,
              circle.status !== 'active' ? { id: 'resume', label: copy.care.resume, onSelect: () => actions.setCircleStatus(circle.id, 'active') } : null,
              circle.status !== 'ended' ? { id: 'end', label: copy.care.end, onSelect: () => setConfirming('end') } : null,
              { id: 'delete', label: copy.common.delete, tone: 'danger', onSelect: () => setConfirming('delete') },
            ]}
          />
        </div>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === 'end' ? copy.care.end : copy.common.delete}
        message={confirming === 'end' ? copy.care.endConfirm : copy.care.deleteConfirm}
        confirmLabel={confirming === 'end' ? copy.care.end : copy.common.delete}
        cancelLabel={copy.common.cancel}
        confirmTone={confirming === 'delete' ? 'danger' : 'primary'}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming === 'end') actions.setCircleStatus(circle.id, 'ended');
          if (confirming === 'delete') {
            actions.deleteCircle(circle.id);
            navigate({ view: 'care' });
          }
          setConfirming(null);
        }}
      />
      {desk.phase === 'ready' && !desk.canUseWork ? <p className="nd-faint" style={{ margin: '-8px 0 14px' }}>{copy.skills.needWork}</p> : null}

  </div>;
}

export function HandbookCard({ circleId }: { readonly circleId: string | null }) {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const ui = useUi();
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(8);
  const notes = state.notes
    .filter((note) => circleId === null || note.circleId === circleId)
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.updatedAt < b.updatedAt ? 1 : -1));

  const matching = notes.filter(note => [note.title, note.body, state.circles.find(circle => circle.id === note.circleId)?.name ?? ''].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <Card
      title={<span className="nd-card-title-icon"><NotebookText size={15} aria-hidden="true" />{copy.handbook.title}</span>}
      hint={circleId === null ? copy.handbook.subtitle : undefined}
      action={<Button tone="ghost" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editNote({ circleId })}>{copy.handbook.add}</Button>}
      testId="nd-handbook"
    >
      {notes.length > 6 ? <label className="nd-care-search"><Search size={16} aria-hidden="true" /><input aria-label={copy.care.findNote} placeholder={copy.care.findNote} value={search} onChange={event => { setSearch(event.target.value); setVisible(8); }} /></label> : null}
      {search && matching.length === 0 ? <Hint>{copy.care.noMatchingNotes}</Hint> : null}
      {notes.length === 0 ? <Hint>{circleId ? copy.care.noNotes : copy.handbook.empty}</Hint> : (
        <div className="nd-handbook-list">
          {matching.slice(0, visible).map((note) => {
            const owner = note.circleId ? state.circles.find((circle) => circle.id === note.circleId) : undefined;
            return (
              <div key={note.id} className="nd-note" data-pinned={note.pinned}>
                <div className="nd-row-body">
                  <button type="button" className="nd-link" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => ui.editNote({ noteId: note.id, circleId: note.circleId })}>
                    <span className="nd-row-title" style={{ fontWeight: 600 }}>
                      {note.pinned ? <Pin size={12} aria-hidden="true" style={{ marginRight: 4 }} /> : null}
                      {note.title}
                    </span>
                  </button>
                  <div className="nd-faint nd-note-body">{note.body.length > 180 ? `${note.body.slice(0, 180)}…` : note.body}</div>
                  <div className="nd-row-meta">
                    {owner && circleId === null ? <Chip tone="accent">{owner.name}</Chip> : null}
                    {note.origin.by === 'agent' ? <span>{copy.handbook.addedBy.agent(note.origin.agentName)}</span> : null}
                  </div>
                </div>
                <MenuButton
                  label={copy.common.more}
                  items={[
                    { id: 'edit', label: copy.common.edit, onSelect: () => ui.editNote({ noteId: note.id, circleId: note.circleId }) },
                    { id: 'pin', label: note.pinned ? copy.handbook.unpin : copy.handbook.pin, onSelect: () => actions.toggleNotePin(note.id) },
                    { id: 'delete', label: copy.common.delete, tone: 'danger', onSelect: () => actions.deleteNote(note.id) },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
      {matching.length > visible ? <button type="button" className="nd-link nd-care-more-notes" onClick={() => setVisible(count => count + 8)}>{copy.care.moreNotes(matching.length - visible)}</button> : null}
    </Card>
  );
}
