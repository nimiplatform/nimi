import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, SelectField, TextField } from '@nimiplatform/kit/ui';
import { ChevronDown, ListChecks, Plus, Search } from 'lucide-react';
import { isActive } from '../domain/reminders.js';
import { addDays, toLocalDate } from '../domain/time.js';
import type { LifeItem } from '../domain/types.js';
import { formatDate } from '../i18n/index.js';
import { useCopy, useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { PageHead } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { useUi } from './ui-context.js';
import { completedItemEntries, matchesItemSearch, pendingItemGroups } from './item-list-model.js';
import './items-page.css';

type Tab = 'upcoming' | 'waiting' | 'recurring' | 'done';

function ItemGroup({ title, count, danger, children, newItemId }: { title: string; count: number; danger?: boolean; children: ReactNode; newItemId: string | null }) {
  const copy = useCopy();
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLElement>(null);
  const revealedItem = useRef<string | null>(null);
  const rows = Children.toArray(children);
  const newIndex = rows.findIndex(row => isValidElement<{ item?: LifeItem }>(row) && row.props.item?.id === newItemId);
  useEffect(() => {
    if (newIndex < 0 || revealedItem.current === newItemId) return;
    revealedItem.current = newItemId;
    setPage(Math.floor(newIndex / 40));
    setOpen(true);
  }, [newItemId, newIndex]);
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 40) - 1));
  const start = current * 40;
  const changePage = (next: number) => {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  };
  return <details className="nd-items-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary ref={heading} className="nd-items-group-title" data-tone={danger ? 'danger' : undefined}>
      <ChevronDown size={14} aria-hidden="true" /><h2>{title}</h2><span>{count}</span>
    </summary>
    {open ? <>
      <div className="nd-list">{rows.slice(start, start + 40)}</div>
      {rows.length > 40 ? <div className="nd-items-pagination" aria-label={title + ' · ' + copy.items.pagination}>
        <span role="status">{copy.items.pageRange(start + 1, Math.min(start + 40, rows.length), rows.length)}</span>
        <Button tone="ghost" size="sm" disabled={current === 0} onClick={() => changePage(current - 1)}>{copy.items.previousPage}</Button>
        <Button tone="ghost" size="sm" disabled={start + 40 >= rows.length} onClick={() => changePage(current + 1)}>{copy.items.nextPage}</Button>
      </div> : null}
    </> : null}
  </details>;
}

// @nimi-authority: definition.nimi.nimiday.assistant.business
export function ItemsPage({ focusItemId }: { readonly focusItemId?: string }) {
  const { copy } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const ui = useUi();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [circleFilter, setCircleFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const [showPreviews, setShowPreviews] = useState(false);
  const searching = query.trim().length > 0;
  const today = toLocalDate(now);

  useEffect(() => {
    if (focusItemId) ui.openItem(focusItemId);
    // Only react to a new focus request from navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);
  useEffect(() => { setLimit(40); }, [tab, circleFilter, query]);

  const filtered = useMemo(() => ({ ...state, items: state.items.filter(item => circleFilter === 'all' || (circleFilter === 'none' ? item.circleId === null : item.circleId === circleFilter)) }), [state, circleFilter]);
  const groups = useMemo(() => pendingItemGroups(filtered, now), [filtered, now]);
  const previewCount = groups.days.reduce((count, day) => count + day.entries.filter(entry => entry.kind === 'item' && entry.projected).length, 0);
  const visibleDays = groups.days.map(day => ({ ...day, entries: day.entries.filter(entry => entry.kind === 'item' && (showPreviews || !entry.projected)) })).filter(day => day.entries.length > 0);
  const waiting = filtered.items.filter(item => item.state === 'waiting');
  const recurring = filtered.items.filter(item => isActive(item) && item.repeat);
  const done = completedItemEntries(filtered.items);
  const searchResults = filtered.items.filter(item => matchesItemSearch(item, query, state.circles));
  // Ended care remains findable: the filter must not strand its saved arrangements.
  const circles = state.circles.filter(circle => circle.status !== 'ended' || state.items.some(item => item.circleId === circle.id));
  const circleName = circleFilter === 'all' ? copy.items.allCircles : circleFilter === 'none' ? copy.common.unassigned : circles.find(circle => circle.id === circleFilter)?.name;
  const tabs = [
    { value: 'upcoming' as const, label: copy.items.upcoming, count: groups.pending.length },
    { value: 'waiting' as const, label: copy.items.waiting, count: waiting.length },
    { value: 'recurring' as const, label: copy.items.recurring, count: recurring.length },
    { value: 'done' as const, label: copy.items.done, count: done.length },
  ];
  const list = searching ? searchResults : tab === 'waiting' ? waiting : recurring;
  const empty = searching ? copy.items.noMatches : tab === 'waiting' ? copy.items.waitingEmpty : tab === 'recurring' ? copy.items.recurringEmpty : tab === 'done' ? copy.items.doneEmpty : circleFilter !== 'all' ? copy.items.filteredEmpty : copy.items.empty;
  const isEmpty = searching ? !searchResults.length : tab === 'upcoming' ? !groups.pending.length : tab === 'done' ? !done.length : !list.length;
  const switchTab = (next: Tab) => { setTab(next); setQuery(''); setLimit(40); };
  const created = (item: LifeItem) => {
    switchTab('upcoming');
    if (circleFilter !== 'all' && (circleFilter === 'none' ? item.circleId !== null : item.circleId !== circleFilter)) setCircleFilter('all');
    setNewItemId(item.id);
  };

  return <div className="nd-page nd-items-page" data-testid="nd-items">
    <PageHead title={copy.items.title} sub={copy.items.workspaceHint}
      action={<div className="nd-items-head-actions">
        <TextField type="search" aria-label={copy.items.search} placeholder={copy.items.searchShort} value={query}
          leading={<Search size={15} aria-hidden="true" />} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
        <Button tone="secondary" size="sm" leadingIcon={<Plus size={15} aria-hidden="true" />} onClick={() => { switchTab('upcoming'); ui.newItem({ date: today, circleId: circleFilter === 'all' || circleFilter === 'none' ? null : circleFilter }); }}>{copy.item.new}</Button>
      </div>} />
    <div className="nd-items-workspace">
      <div className="nd-items-toolbar">
      <nav className="nd-items-tabs" aria-label={copy.items.title}>
        {tabs.map(entry => <button key={entry.value} type="button" aria-current={!searching && tab === entry.value ? 'page' : undefined} onClick={() => switchTab(entry.value)}>
          {entry.label}{entry.count > 0 ? <span>{entry.count}</span> : null}
        </button>)}
      </nav>
        <div className="nd-items-person"><SelectField aria-label={copy.items.filterCircle} value={circleFilter} onValueChange={setCircleFilter}
          options={[{ value: 'all', label: copy.items.allCircles }, ...circles.map(circle => ({ value: circle.id, label: circle.status === 'ended' ? circle.name + ' · ' + copy.care.endedTag : circle.name })), { value: 'none', label: copy.common.unassigned }]} /></div>
      </div>
      <div className="nd-items-capture"><QuickCapture circleId={circleFilter !== 'all' && circleFilter !== 'none' ? circleFilter : null} onCreated={created} /></div>
      {!searching && tab === 'upcoming' && previewCount > 0 ? <div className="nd-items-preview-control">
        <button type="button" className="nd-link" aria-pressed={showPreviews} onClick={() => setShowPreviews(value => !value)}>{showPreviews ? copy.items.hidePreviews : copy.items.showPreviews(previewCount)}</button>
      </div> : null}
      {searching || circleFilter !== 'all' ? <div className="nd-items-context" role="status">
        <span>{searching ? (circleFilter !== 'all' ? circleName + ' · ' : '') + copy.items.searchCount(searchResults.length) : copy.items.showingCircle(circleName ?? '')}</span>
        {!isEmpty ? <button type="button" className="nd-link" onClick={() => { setQuery(''); setCircleFilter('all'); }}>{copy.items.resetFilters}</button> : null}
      </div> : null}
      <div className="nd-items-content" data-testid="nd-items-list">
        {isEmpty ? <div className="nd-items-empty">
          <ListChecks size={28} strokeWidth={1.4} aria-hidden="true" />
          <h2>{empty}</h2>
          {!searching && tab === 'upcoming' && circleFilter === 'all' ? <p>{copy.items.emptyHint}</p> : null}
          {searching || circleFilter !== 'all' ? <Button tone="ghost" size="sm" onClick={() => { setQuery(''); setCircleFilter('all'); }}>{copy.items.resetFilters}</Button> : null}
        </div> : null}
        {!searching && tab === 'upcoming' ? <>
          {groups.overdue.length ? <ItemGroup newItemId={newItemId} key={circleFilter + ':overdue'} title={copy.today.overdue} count={groups.overdue.length} danger>
            {groups.overdue.map(item => <ItemRow key={item.id} item={item} layout="title-first" showFullDate showSnooze showReschedule hideOverdue />)}
          </ItemGroup> : null}
          {visibleDays.map(day => <ItemGroup newItemId={newItemId} key={circleFilter + ':' + day.date} title={(day.date === today ? copy.time.today + ' · ' : day.date === addDays(today, 1) ? copy.time.tomorrow + ' · ' : '') + formatDate(copy, day.date, today)} count={day.entries.length}>
            {day.entries.map(entry => entry.kind === 'item' ? <ItemRow key={entry.key} item={entry.item} date={entry.date} time={entry.time} projected={entry.projected} layout="title-first" /> : null)}
          </ItemGroup>)}
          {groups.later.length ? <ItemGroup newItemId={newItemId} key={circleFilter + ':later'} title={copy.items.later} count={groups.later.length}>
            {groups.later.map(item => <ItemRow key={item.id} item={item} layout="title-first" showFullDate />)}
          </ItemGroup> : null}
          {groups.undated.length ? <ItemGroup newItemId={newItemId} key={circleFilter + ':undated'} title={copy.items.someday} count={groups.undated.length}>
            {groups.undated.map(item => <ItemRow key={item.id} item={item} layout="title-first" />)}
          </ItemGroup> : null}
        </> : null}
        {searching || tab === 'waiting' || tab === 'recurring' ? <div className="nd-list">{list.slice(0, limit).map(item => <ItemRow key={item.id} item={item} layout="title-first" showFullDate />)}</div> : null}
        {!searching && tab === 'done' ? <div className="nd-list">{done.slice(0, limit).map(entry => <ItemRow key={entry.key} item={entry.item} date={entry.date} done={entry.occurrence} layout="title-first" showFullDate />)}</div> : null}
        {(searching ? searchResults.length : tab === 'done' ? done.length : tab === 'upcoming' ? 0 : list.length) > limit ? <Button tone="ghost" size="sm" onClick={() => setLimit(value => value + 40)}>{copy.items.moreItems}</Button> : null}
      </div>
    </div>
  </div>;
}
