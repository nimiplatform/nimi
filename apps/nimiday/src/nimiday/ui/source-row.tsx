import { useState } from 'react';
import { Button, nimiToast } from '@nimiplatform/kit/ui';
import { linkedSource, PARENTOS_APP_ID, sourceLinkFor, sourceViewKey, type SourceChange } from '../domain/sources.js';
import { sourceEntries } from '../domain/source-attention.js';
import type { SourceView } from '../domain/types.js';
import { isActive } from '../domain/reminders.js';
import { toLocalDate } from '../domain/time.js';
import { formatDay, timeAgo } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { Chip, MenuButton } from './common.js';
import { useUi } from './ui-context.js';
import { saveFailureMessage } from './save-feedback.js';

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

export function SourceRow({ change, showCircle = true, presentation = 'default', associationInGroup = false }: {
  readonly change: SourceChange;
  readonly showCircle?: boolean;
  readonly presentation?: 'default' | 'care' | 'summary';
  readonly associationInGroup?: boolean;
}) {
  const { engine, copy, actions, store, navigate } = useNimiDay();
  const { now } = useEngine();
  const { state } = useDayStore();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const circle = showCircle && change.circleId ? state.circles.find((entry) => entry.id === change.circleId) : undefined;
  const natureTone = change.nature === 'reminder' ? 'warning' : change.nature === 'interpretation' ? 'info' : undefined;
  // NimiDay's own arrangement for this reminder, if one is still active.
  const arranged = state.items.find((item) => isActive(item) && item.source && linkedSource(item.source, [change]) !== null) ?? null;
  const entry = sourceEntries(state, [change], now)[0]!;
  const saveView = async (patch: Partial<Omit<SourceView, 'key'>>) => {
    actions.setSourceView(sourceViewKey(change), patch);
    const saved = await store.persist();
    nimiToast.show({ tone: saved.ok ? 'info' : 'warning', message: saved.ok ? copy.sourceAttention.saved : saveFailureMessage(copy, store.getSnapshot(), copy.sourceAttention.saveFailed), durationMs: 4000 });
  };

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
    <div className="nd-row nd-source-row" data-presentation={presentation} data-testid="nd-source-row" data-activity-id={change.id}>
      <span className="nd-status-dot" data-tone={change.unread ? 'busy' : 'off'} aria-hidden="true" style={{ marginTop: 7, visibility: change.unread ? 'visible' : 'hidden' }} />
      <div className="nd-row-body">
        <span className="nd-row-title">{change.title}</span>
        {presentation === 'care' && change.unread ? <span className="nd-care-unread">{copy.care.unread}</span> : null}
        {change.summary && presentation !== 'summary' ? <div className="nd-faint" style={{ marginTop: 2 }}>{change.summary}</div> : null}
        <div className="nd-row-meta">
          {!associationInGroup ? <span>{change.appName}</span> : null}
          {change.child && !associationInGroup && (presentation !== 'care' || !change.circleId) && (presentation !== 'summary' || !circle) ? <span>{change.child.childName}</span> : null}
          {change.appId === PARENTOS_APP_ID && !change.circleId && !associationInGroup ? <Chip tone="warning">{copy.sources.unassociated}</Chip> : null}
          {presentation !== 'summary' ? <Chip tone={natureTone}>{copy.kinds.nature[change.nature]}</Chip> : null}
          {circle ? <Chip tone="accent">{circle.name}</Chip> : null}
          {presentation !== 'summary' ? <span>{presentation === 'care' ? copy.care.sourceUpdated(timeAgo(copy, change.occurredAt, now)) : timeAgo(copy, change.occurredAt, now)}</span> : null}
          {todoNote ? <Chip tone="success">{todoNote}</Chip> : null}
          {arranged ? (
            <Chip tone="accent">
              {arranged.date
                ? copy.sources.arrangedOn(`${formatDay(copy, arranged.date, toLocalDate(now))}${arranged.time ? ` ${arranged.time}` : ''}`)
                : copy.sources.arranged}
            </Chip>
          ) : null}
        </div>
        {entry.reason ? <div className="nd-source-reason">{copy.sourceAttention.reasons[entry.reason]}</div> : null}
        {entry.hidden ? <div className="nd-faint">{copy.sourceAttention.hidden}</div> : entry.snoozed ? <div className="nd-faint">{copy.sourceAttention.snoozedUntil(new Date(entry.view!.snoozedUntil!).toLocaleString())}</div> : null}
        {change.nature === 'interpretation' ? <div className="nd-faint" style={{ marginTop: 4 }}>{copy.sources.interpretationNote}</div> : null}
        {change.appId === PARENTOS_APP_ID && !change.child ? <div className="nd-faint">{copy.sources.childUnknown}</div> : null}
        {!change.sourceAvailable ? <div className="nd-muted">{copy.sources.sourceUnavailable}</div> : null}
      </div>
      <div className="nd-row-actions">
        {change.child && !change.circleId && change.sourceAvailable && !associationInGroup ? (
          <Button size="sm" tone="ghost" onClick={() => navigate({ view: 'care', sources: { mode: 'association' } })}>{copy.sources.associateChild}</Button>
        ) : null}
        {arranged && (entry.reason === 'terminal' || entry.reason === 'changed') ? <Button size="sm" tone="ghost" onClick={() => ui.openItem(arranged.id)}>{copy.sources.seeArrangement}</Button> : change.openable ? (
          <Button size="sm" tone="ghost" loading={busy} onClick={() => { void open(); }}>
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
                void engine.acknowledgeSource(change).then(() => nimiToast.show({ tone: 'info', message: copy.sources.ackHint, durationMs: 3000 }))
                  .catch(() => nimiToast.show({ tone: 'warning', message: copy.sourceAttention.saveFailed, durationMs: 4000 }));
              },
            } : null,
            entry.reviewSignature && entry.reason ? { id: 'review', label: copy.sourceAttention.reviewed,
              onSelect: () => { void saveView({ reviewedSignature: entry.reviewSignature }); } } : null,
            entry.snoozed ? { id: 'resume', label: copy.sourceAttention.resume,
              onSelect: () => { void saveView({ snoozedUntil: null }); } }
              : change.todoState === 'open' || entry.reason ? { id: 'snooze', label: copy.sourceAttention.snooze,
                onSelect: () => { void saveView({ snoozedUntil: new Date(now.getTime() + 60 * 60_000).toISOString() }); } } : null,
            { id: 'hide', label: entry.hidden ? copy.sourceAttention.restore : copy.sourceAttention.hide,
              onSelect: () => { void saveView({ hidden: !entry.hidden }); } },
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
