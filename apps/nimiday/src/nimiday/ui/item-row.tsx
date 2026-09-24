import { Button, nimiToast } from '@nimiplatform/kit/ui';
import { AlarmClock, BellOff, MapPin, Repeat } from 'lucide-react';
import { snoozeInstant, snoozeOptions, isOverdue } from '../domain/reminders.js';
import { linkedSource } from '../domain/sources.js';
import { parseInstant, toLocalDate } from '../domain/time.js';
import type { LifeItem, LocalDate, LocalTime } from '../domain/types.js';
import { describeRepeat, formatDay, formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { CheckButton, Chip, MenuButton, OriginNote } from './common.js';
import { openSourceWithFeedback } from './source-row.js';
import { useUi } from './ui-context.js';

export function ItemRow({
  item,
  date,
  time,
  done = false,
  projected = false,
  showDay = false,
  showSnooze = false,
}: {
  readonly item: LifeItem;
  readonly date?: LocalDate | null;
  readonly time?: LocalTime | null;
  readonly done?: boolean;
  readonly projected?: boolean;
  readonly showDay?: boolean;
  readonly showSnooze?: boolean;
}) {
  const { actions, copy, engine, navigate } = useNimiDay();
  const desk = useDesk();
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
  const overdue = !done && !projected && !snoozePending && isOverdue(item, now);
  const settings = { allDayRemindTime: state.profile.allDayRemindTime, quiet: state.profile.quiet };
  const linked = item.source ? linkedSource(item.source, changes) : null;

  const timeLabel = occurrenceTime ?? (occurrenceDate ? copy.time.allDay : '');
  const dayLabel = showDay && occurrenceDate ? formatDay(copy, occurrenceDate, today) : null;

  return (
    <div className="nd-row" data-done={done || closed} data-testid="nd-item-row">
      {item.decision && item.state === 'waiting' ? (
        <span style={{ width: 20 }} aria-hidden="true" />
      ) : (
        <CheckButton
          checked={done || closed}
          label={item.repeat ? copy.item.completeOccurrence : copy.item.complete}
          onClick={() => {
            if (done || projected) return;
            if (closed) {
              actions.reopenItem(item.id);
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
      <div className="nd-row-time" data-tone={overdue ? 'late' : undefined}>
        {dayLabel ? <div>{dayLabel}</div> : null}
        {timeLabel}
      </div>
      <div className="nd-row-body">
        <button type="button" className="nd-link" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => ui.openItem(item.id)}>
          <span className="nd-row-title">{item.decision ? item.decision.question : item.title}</span>
        </button>
        <div className="nd-row-meta">
          {circle ? <Chip tone="accent">{circle.status === 'ended' ? `${circle.name} · ${copy.care.endedTag}` : circle.name}</Chip> : null}
          {item.kind !== 'todo' ? <Chip>{copy.kinds.item[item.kind]}</Chip> : null}
          {overdue ? <Chip tone="danger">{copy.today.overdue}</Chip> : null}
          {item.state === 'dropped' ? <Chip>{copy.item.events.dropped}</Chip> : null}
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
              {projected ? copy.today.projected : describeRepeat(copy, item.repeat)}
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
        {item.decision && item.state === 'waiting' ? (
          <div className="nd-inline-actions" style={{ marginTop: 8 }}>
            {item.decision.options.map((option) => (
              <Button key={option} size="sm" tone="secondary" onClick={() => {
                const question = item.decision!.question;
                actions.decide(item.id, option);
                // A question the assistant left is answered back to the assistant, so it can carry on.
                const agent = desk.phase === 'ready' ? desk.agent : null;
                nimiToast.show({
                  tone: 'success',
                  message: copy.item.decidedToast(option),
                  durationMs: 8000,
                  ...(agent && item.origin.by === 'agent' ? {
                    action: {
                      label: copy.item.decisionFollowUpAction(agent.displayName),
                      onClick: () => {
                        void engine.chat(copy.item.decisionFollowUp(question, option)).then((result) => {
                          if (result.ok) navigate({ view: 'assistant' });
                          else nimiToast.show({ tone: 'warning', message: result.reason === 'busy' ? copy.assistant.busy(agent.displayName) : copy.assistant.sendFailed, durationMs: 5000 });
                        });
                      },
                    },
                  } : {}),
                });
              }}>{option}</Button>
            ))}
          </div>
        ) : null}
        {item.decision?.choice ? <div className="nd-faint" style={{ marginTop: 4 }}>{copy.item.decided(item.decision.choice)}</div> : null}
      </div>
      {!done && !projected ? (
        <div className="nd-row-actions">
          {showSnooze && !closed ? (
            <MenuButton
              label={copy.snooze.label}
              trigger={<Button size="sm" tone="ghost" leadingIcon={<AlarmClock size={14} aria-hidden="true" />}>{copy.snooze.label}</Button>}
              items={snoozeOptions(now, settings).map((option) => ({
                id: option.choice,
                label: copy.snooze[option.choice],
                onSelect: () => actions.snoozeItem(item.id, snoozeInstant(option.choice, new Date(), settings)),
              }))}
            />
          ) : null}
          <MenuButton
            label={copy.common.more}
            items={[
              { id: 'edit', label: copy.common.edit, onSelect: () => ui.openItem(item.id) },
              !closed && item.repeat ? { id: 'skip', label: copy.item.skip, onSelect: () => actions.skipOccurrence(item.id) } : null,
              !closed ? { id: 'drop', label: copy.item.drop, onSelect: () => actions.dropItem(item.id) } : null,
              closed ? { id: 'reopen', label: copy.item.reopen, onSelect: () => actions.reopenItem(item.id) } : null,
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
