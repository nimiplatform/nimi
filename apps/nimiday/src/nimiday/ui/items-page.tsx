import { useEffect, useMemo, useState } from 'react';
import { Button, PillTabs } from '@nimiplatform/kit/ui';
import { Plus } from 'lucide-react';
import { isActive } from '../domain/reminders.js';
import { addDays, toLocalDate } from '../domain/time.js';
import { buildAgenda, undatedItems } from '../domain/today.js';
import type { LifeItem } from '../domain/types.js';
import { formatDate, formatDay } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { Card, Hint, PageHead } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { useUi } from './ui-context.js';

type Tab = 'upcoming' | 'waiting' | 'recurring' | 'done';

export function ItemsPage({ focusItemId }: { readonly focusItemId?: string }) {
  const { copy } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const ui = useUi();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [circleFilter, setCircleFilter] = useState<string>('all');
  const today = toLocalDate(now);

  useEffect(() => {
    if (focusItemId) ui.openItem(focusItemId);
    // Only react to a new focus request from navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);

  const matches = (item: LifeItem) => circleFilter === 'all' || (circleFilter === 'none' ? item.circleId === null : item.circleId === circleFilter);
  const filtered = useMemo(() => ({ ...state, items: state.items.filter(matches) }), [state, circleFilter]);
  const agenda = useMemo(() => buildAgenda(filtered, today, 14), [filtered, today]);
  const horizon = addDays(today, 13);
  const later = filtered.items
    .filter((item) => isActive(item) && item.date !== null && item.date > horizon && !item.repeat)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const overdue = filtered.items.filter((item) => isActive(item) && item.date !== null && item.date < today && !item.repeat);
  const someday = undatedItems(filtered);
  const waiting = filtered.items.filter((item) => item.state === 'waiting');
  const recurring = filtered.items.filter((item) => isActive(item) && item.repeat);
  const done = filtered.items
    .filter((item) => item.state === 'done' || item.state === 'dropped')
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
    .slice(0, 80);

  const circles = state.circles.filter((circle) => circle.status !== 'ended');

  return (
    <div className="nd-page nd-page--narrow" data-testid="nd-items">
      <PageHead
        title={copy.items.title}
        action={<Button tone="primary" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.newItem({ date: today })}>{copy.item.new}</Button>}
      />
      <Card>
        <QuickCapture circleId={circleFilter !== 'all' && circleFilter !== 'none' ? circleFilter : null} />
      </Card>
      <div className="nd-split" style={{ margin: '18px 0 12px', flexWrap: 'wrap' }}>
        <PillTabs
          ariaLabel={copy.items.title}
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          items={[
            { value: 'upcoming', label: copy.items.upcoming },
            { value: 'waiting', label: `${copy.items.waiting}${waiting.length ? ` ${waiting.length}` : ''}` },
            { value: 'recurring', label: copy.items.recurring },
            { value: 'done', label: copy.items.done },
          ]}
        />
        {circles.length > 0 ? (
          <div className="nd-kind-picker" aria-label={copy.items.filterCircle}>
            {[{ id: 'all', name: copy.common.all }, ...circles.map((circle) => ({ id: circle.id, name: circle.name })), { id: 'none', name: copy.common.unassigned }].map((entry) => (
              <button key={entry.id} type="button" className="nd-kind-option" aria-pressed={circleFilter === entry.id} onClick={() => setCircleFilter(entry.id)}>
                {entry.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === 'upcoming' ? (
        <div className="nd-stack">
          {overdue.length > 0 ? (
            <Card title={copy.today.overdue}>
              <div className="nd-list">{overdue.map((item) => <ItemRow key={item.id} item={item} showDay showSnooze />)}</div>
            </Card>
          ) : null}
          <Card title={copy.items.next14}>
            {agenda.every((day) => day.entries.every((entry) => entry.kind !== 'item')) ? <Hint>{copy.items.empty}</Hint> : agenda.map((day) => {
              const entries = day.entries.filter((entry) => entry.kind === 'item');
              if (entries.length === 0) return null;
              return (
                <div key={day.date} className="nd-day-group">
                  <h3 className="nd-day-label">
                    {formatDay(copy, day.date, today)}
                    <span>{formatDate(copy, day.date, today)}</span>
                  </h3>
                  <div className="nd-list">
                    {entries.map((entry) => entry.kind === 'item' ? (
                      <ItemRow key={entry.key} item={entry.item} date={entry.date} time={entry.time} done={entry.done} projected={entry.projected} />
                    ) : null)}
                  </div>
                </div>
              );
            })}
          </Card>
          {later.length > 0 ? (
            <Card title={copy.items.later}>
              <div className="nd-list">{later.map((item) => <ItemRow key={item.id} item={item} showDay />)}</div>
            </Card>
          ) : null}
          <Card title={copy.items.someday}>
            {someday.length === 0 ? <Hint>{copy.items.empty}</Hint> : (
              <div className="nd-list">{someday.map((item) => <ItemRow key={item.id} item={item} />)}</div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'waiting' ? (
        <Card>
          {waiting.length === 0 ? <Hint>{copy.items.waitingEmpty}</Hint> : (
            <div className="nd-list">{waiting.map((item) => <ItemRow key={item.id} item={item} />)}</div>
          )}
        </Card>
      ) : null}

      {tab === 'recurring' ? (
        <Card>
          {recurring.length === 0 ? <Hint>{copy.items.recurringEmpty}</Hint> : (
            <div className="nd-list">{recurring.map((item) => <ItemRow key={item.id} item={item} showDay />)}</div>
          )}
        </Card>
      ) : null}

      {tab === 'done' ? (
        <Card>
          {done.length === 0 ? <Hint>{copy.items.doneEmpty}</Hint> : (
            <div className="nd-list">{done.map((item) => <ItemRow key={item.id} item={item} showDay />)}</div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
