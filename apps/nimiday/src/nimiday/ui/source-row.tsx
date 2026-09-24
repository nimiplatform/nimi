import { useState } from 'react';
import { Button, nimiToast } from '@nimiplatform/kit/ui';
import { linkedSource, sourceLinkFor, type SourceChange } from '../domain/sources.js';
import { isActive } from '../domain/reminders.js';
import { toLocalDate } from '../domain/time.js';
import { formatDay, timeAgo } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { Chip, MenuButton } from './common.js';
import { useUi } from './ui-context.js';

/**
 * Hand the user over to the App that owns a record, saying what happened.
 * Opening it is not doing it: that App's own state stays as it is.
 */
export async function openSourceWithFeedback(
  engine: ReturnType<typeof useNimiDay>['engine'],
  copy: ReturnType<typeof useNimiDay>['copy'],
  change: SourceChange,
): Promise<void> {
  // A source app that is not running yet can take a while to start.
  const opening = setTimeout(() => nimiToast.show({ tone: 'info', message: copy.sources.opening(change.appName), durationMs: 6000 }), 1500);
  try {
    const result = await engine.openSource(change);
    const message = copy.sources.openFailed[result.reason as keyof typeof copy.sources.openFailed] ?? copy.sources.openFailedGeneric;
    nimiToast.show({ tone: result.outcome === 'opened' ? 'success' : 'warning', message, durationMs: 5000 });
  } finally {
    clearTimeout(opening);
  }
}

export function SourceRow({ change, showCircle = true }: { readonly change: SourceChange; readonly showCircle?: boolean }) {
  const { engine, copy } = useNimiDay();
  const { now } = useEngine();
  const { state } = useDayStore();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const circle = showCircle && change.circleId ? state.circles.find((entry) => entry.id === change.circleId) : undefined;
  const natureTone = change.nature === 'reminder' ? 'warning' : change.nature === 'interpretation' ? 'info' : undefined;
  // NimiDay's own arrangement for this reminder, if one is still active.
  const arranged = state.items.find((item) => isActive(item) && item.source && linkedSource(item.source, [change]) !== null) ?? null;

  const open = async () => {
    setBusy(true);
    try {
      await openSourceWithFeedback(engine, copy, change);
    } finally {
      setBusy(false);
    }
  };

  const todoNote = change.todoState === 'completed'
    ? copy.sources.completedIn(change.appName)
    : change.todoState === 'cancelled'
      ? copy.sources.cancelled
      : null;

  return (
    <div className="nd-row nd-source-row" data-testid="nd-source-row">
      <span className="nd-status-dot" data-tone={change.unread ? 'busy' : 'off'} aria-hidden="true" style={{ marginTop: 7 }} />
      <div className="nd-row-body">
        <span className="nd-row-title">{change.title}</span>
        {change.summary ? <div className="nd-faint" style={{ marginTop: 2 }}>{change.summary}</div> : null}
        <div className="nd-row-meta">
          <span>{change.appName}</span>
          <Chip tone={natureTone}>{copy.kinds.nature[change.nature]}</Chip>
          {circle ? <Chip tone="accent">{circle.name}</Chip> : null}
          <span>{timeAgo(copy, change.occurredAt, now)}</span>
          {todoNote ? <Chip tone="success">{todoNote}</Chip> : null}
          {arranged ? (
            <Chip tone="accent">
              {arranged.date
                ? copy.sources.arrangedOn(`${formatDay(copy, arranged.date, toLocalDate(now))}${arranged.time ? ` ${arranged.time}` : ''}`)
                : copy.sources.arranged}
            </Chip>
          ) : null}
        </div>
        {change.nature === 'interpretation' ? <div className="nd-faint" style={{ marginTop: 4 }}>{copy.sources.interpretationNote}</div> : null}
      </div>
      <div className="nd-row-actions">
        {change.openable ? (
          <Button size="sm" tone="secondary" loading={busy} onClick={() => { void open(); }}>
            {change.known === 'parentos-growth-record' && change.todoState === 'open'
              ? copy.sources.parentosAction
              : change.known === 'parentos-care-reminder' && change.todoState === 'open'
                ? copy.sources.parentosCareAction
                : change.nature === 'reminder' && change.todoState === 'open' ? copy.sources.openIn(change.appName) : copy.sources.open}
          </Button>
        ) : null}
        <MenuButton
          label={copy.common.more}
          items={[
            arranged ? {
              id: 'arranged',
              label: copy.sources.seeArrangement,
              onSelect: () => ui.openItem(arranged.id),
            } : change.nature === 'reminder' && change.todoState !== 'completed' && change.todoState !== 'cancelled' ? {
              id: 'plan',
              label: copy.sources.planIt,
              onSelect: () => ui.newItem({
                title: change.title,
                notes: [change.summary, copy.sources.planNotes(change.appName)].filter(Boolean).join('\n'),
                kind: change.known === 'parentos-care-reminder' ? 'appointment' : 'todo',
                circleId: change.circleId,
                source: sourceLinkFor(change),
              }),
            } : null,
            change.unread ? {
              id: 'ack',
              label: copy.sources.ack,
              onSelect: () => {
                void engine.acknowledgeSource(change).then(() => nimiToast.show({ tone: 'info', message: copy.sources.ackHint, durationMs: 3000 }));
              },
            } : null,
            { id: 'hide', label: copy.sources.hide, onSelect: () => engine.hideSource(change) },
          ]}
        />
      </div>
    </div>
  );
}

/**
 * Said under a list of other Apps' changes whenever it is not the whole
 * picture: open reminders that could not all be loaded, or recent activity
 * that stops at the newest records. Loading more is the user's choice.
 */
export function SourceCoverageNote() {
  const { activity, copy } = useNimiDay();
  const { activityStatus, activityCoverage, activityHasMore } = useEngine();
  if (activityStatus !== 'ready') return null;
  const lines = [
    activityCoverage.openTodos === 'partial' ? copy.sources.openPartial : null,
    activityCoverage.recent === 'partial' ? copy.sources.recentPartial(activityCoverage.recentCount) : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <div className="nd-inline-actions nd-faint" style={{ marginTop: 10 }} data-testid="nd-source-coverage">
      <span>{lines.join(' ')}</span>
      {activityHasMore ? <button type="button" className="nd-link" onClick={activity.loadMore}>{copy.sources.loadEarlier}</button> : null}
    </div>
  );
}
