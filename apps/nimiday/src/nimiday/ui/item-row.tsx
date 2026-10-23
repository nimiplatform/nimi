import { Button, nimiToast } from '@nimiplatform/kit/ui';
import { AlarmClock, BellOff, MapPin, Repeat } from 'lucide-react';
import { snoozeInstant, snoozeOptions, isOverdue } from '../domain/reminders.js';
import { linkedSource } from '../domain/sources.js';
import { parseInstant, toLocalDate } from '../domain/time.js';
import type { LifeItem, LocalDate, LocalTime } from '../domain/types.js';
import { describeRepeat, formatDate, formatDay, formatInstant } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { CheckButton, Chip, MenuButton, OriginNote } from './common.js';
import { openSourceWithFeedback } from './source-row.js';
import { useUi } from './ui-context.js';
import { ItemDecision } from './item-decision.js';

export function ItemRow({
  item,
  date,
  time,
  done = false,
  projected = false,
  showDay = false,
  showFullDate = false,
  showSnooze = false,
  showReschedule = false,
  hideOverdue = false,
  layout = 'timeline',
}: {
  readonly item: LifeItem;
  readonly date?: LocalDate | null;
  readonly time?: LocalTime | null;
  readonly done?: boolean;
  readonly projected?: boolean;
  readonly showDay?: boolean;
  readonly showFullDate?: boolean;
  readonly showSnooze?: boolean;
  readonly showReschedule?: boolean;
  readonly hideOverdue?: boolean;
  readonly layout?: 'timeline' | 'title-first';
}) {
  const { actions, copy, engine } = useNimiDay();
  const { now, changes } = useEngine();
  const { state } = useDayStore();
  const ui = useUi();
  const today = toLocalDate(now);
  const circle = item.circleId ? state.circles.find((entry) => entry.id === item.circleId) : undefined;
  const occurrenceDate = date ?? item.date;
  const occurrenceTime = time !== undefined ? time : item.time;
  const closed = item.state === 'done' || item.state === 'dropped';
  const snoozed = parseInstant(item.snoozedUntil);
  const snoozePending = snoozed !== null && snoozed.getTime() > now.getTime();
  const overdue = !done && !projected && isOverdue(item, now);
  const settings = { allDayRemindTime: state.profile.allDayRemindTime, quiet: state.profile.quiet };
  const linked = item.source ? linkedSource(item.source, changes) : null;

  const timeLabel = occurrenceTime ?? (occurrenceDate ? copy.time.allDay : '');
  const dayLabel = showFullDate
    ? occurrenceDate ? formatDate(copy, occurrenceDate, today) : copy.time.noDate
    : showDay && occurrenceDate ? formatDay(copy, occurrenceDate, today) : null;

  const reopen = () => {
    actions.reopenItem(item.id);
    if (item.decision) nimiToast.show({ tone: 'info', message: copy.item.reconsidered, durationMs: 6000 });
  };

  return (
    <div className="nd-row" data-layout={layout} data-done={done || closed} data-decision={Boolean(item.decision)} data-item-id={item.id} data-testid="nd-item-row">
      {item.decision ? (
        <span style={{ width: 20 }} aria-hidden="true" />
      ) : (
        <CheckButton
          checked={done || closed}
          disabled={done || projected}
          label={done ? copy.today.done : closed ? copy.item.reopen : projected ? copy.items.repeatPreview : item.repeat ? copy.item.completeOccurrence : copy.item.complete}
          onClick={() => {
            if (done || projected) return;
            if (closed) {
              reopen();
              return;
            }
            actions.completeItem(item.id);
            // Finishing NimiDay's arrangement leaves the other App's reminder as it is; say where to finish it.
            if (linked && item.source && linked.todoState === 'open') {
              const source = linked;
              nimiToast.show({
                tone: 'info',
                message: copy.item.sourceStillOpen(item.source.appName, item.source.title),
                durationMs: 9000,
                ...(source.openable ? { action: { label: copy.sources.openIn(item.source.appName), onClick: () => { void openSourceWithFeedback(engine, copy, source); } } } : {}),
              });
            }
          }}
        />
      )}
      {layout === 'timeline' ? <div className="nd-row-time">
        {dayLabel ? <div>{dayLabel}</div> : null}
        {timeLabel}
      </div> : null}
      <div className="nd-row-body">
        <button type="button" className="nd-link" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => ui.openItem(item.id)}>
          <span className="nd-row-title">{item.decision ? item.decision.question : item.title}</span>
        </button>
        <div className="nd-row-meta">
          {layout === 'title-first' && (dayLabel || timeLabel) ? (
            <span className="nd-item-schedule">{[dayLabel, timeLabel].filter(Boolean).join(' · ')}</span>
          ) : null}
          {circle ? <Chip tone="accent">{circle.status === 'ended' ? `${circle.name} · ${copy.care.endedTag}` : circle.name}</Chip> : null}
          {item.kind !== 'todo' ? <Chip>{copy.kinds.item[item.kind]}</Chip> : null}
          {overdue && !hideOverdue ? <Chip tone="danger">{copy.today.overdue}</Chip> : null}
          {item.state === 'waiting' && !item.decision ? <Chip>{copy.items.waiting}</Chip> : null}
          {!done && item.state === 'dropped' ? <Chip>{item.repeat ? copy.item.repeatStopped : copy.item.events.dropped}</Chip> : null}
          {done ? <Chip tone="success">{copy.today.done}</Chip> : null}
          {item.source ? (
            <Chip tone={linked?.todoState === 'completed' ? 'success' : undefined}>
              {linked?.todoState === 'completed' ? copy.item.sourceDone(item.source.appName)
                : linked?.todoState === 'cancelled' ? copy.item.sourceCancelled(item.source.appName)
                  : linked?.todoState === 'open' ? copy.item.sourceOpen(item.source.appName)
                    : copy.item.sourceFor(item.source.appName)}
            </Chip>
          ) : null}
          {item.importance === 'important' ? <Chip tone="warning">{copy.kinds.importance.important}</Chip> : null}
          {item.repeat ? (
            <span className="nd-inline-actions" style={{ gap: 4 }}>
              <Repeat size={12} aria-hidden="true" />
              {projected ? copy.items.repeatPreview : describeRepeat(copy, item.repeat)}
            </span>
          ) : null}
          {item.place ? (
            <span className="nd-inline-actions" style={{ gap: 4 }}>
              <MapPin size={12} aria-hidden="true" />
              {item.place}
            </span>
          ) : null}
          {item.date && item.remind.kind === 'none' && !snoozePending && !closed && !done ? (
            <span className="nd-inline-actions" style={{ gap: 4 }} data-testid="nd-no-remind">
              <BellOff size={12} aria-hidden="true" />
              {copy.item.remindOptions.none}
            </span>
          ) : null}
          {snoozePending && !closed ? (
            <span className="nd-inline-actions" style={{ gap: 4 }} data-testid="nd-snoozed">
              <AlarmClock size={12} aria-hidden="true" />
              {copy.item.remindAgain(formatInstant(copy, snoozed.toISOString(), today))}
            </span>
          ) : null}
          <OriginNote item={item} />
        </div>
        {item.decision ? <ItemDecision item={item} /> : null}
      </div>
      {!done && !projected ? (
        <div className="nd-row-actions">
          {showReschedule && !closed ? <Button size="sm" tone="ghost" onClick={() => ui.openItem(item.id)}>{copy.items.reschedule}</Button> : null}
          {showSnooze && !closed ? (
            <MenuButton
              label={copy.snooze.label}
              trigger={<Button size="sm" tone="ghost" leadingIcon={<AlarmClock size={14} aria-hidden="true" />}>{copy.snooze.label}</Button>}
              items={snoozeOptions(now, settings).map((option) => ({
                id: option.choice,
                label: `${copy.snooze[option.choice]} · ${formatInstant(copy, option.at.toISOString(), today)}`,
                onSelect: () => {
                  const until = snoozeInstant(option.choice, new Date(), settings);
                  actions.snoozeItem(item.id, until);
                  nimiToast.show({ tone: 'success', message: copy.snooze.saved(formatInstant(copy, until, today)), durationMs: 5000 });
                },
              }))}
            />
          ) : null}
          <MenuButton
            label={copy.common.more}
            items={[
              { id: 'edit', label: copy.common.edit, onSelect: () => ui.openItem(item.id) },
              !closed && item.repeat ? { id: 'skip', label: copy.item.skip, onSelect: () => actions.skipOccurrence(item.id) } : null,
              !closed ? { id: 'drop', label: item.repeat ? copy.item.stopRepeat : copy.item.drop, onSelect: () => actions.dropItem(item.id) } : null,
              closed ? { id: 'reopen', label: item.decision ? copy.item.reconsider : copy.item.reopen, onSelect: reopen } : null,
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
