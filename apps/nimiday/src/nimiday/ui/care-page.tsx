import { useMemo, useState } from 'react';
import { Button, ConfirmDialog, nimiToast, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowLeft, ArrowRight, NotebookText, Pin, Plus } from 'lucide-react';
import { isActive, isOverdue } from '../domain/reminders.js';
import { CARE_REVIEW_SKILL } from '../domain/skills.js';
import { attentionOrder, type SourceChange } from '../domain/sources.js';
import { toLocalDate } from '../domain/time.js';
import { formatDate, formatWhen } from '../i18n/index.js';
import type { CareCircle } from '../domain/types.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Card, Chip, CircleIcon, Hint, MenuButton, PageHead } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import { useUi } from './ui-context.js';
import { careChanges, careItems } from './care-summary.js';
import { SourceChildAction } from './parentos-children.js';
import { PARENTOS_APP_ID } from '../domain/sources.js';

export function CarePage({ circleId }: { readonly circleId?: string }) {
  const { state } = useDayStore();
  const circle = circleId ? state.circles.find((entry) => entry.id === circleId) : undefined;
  return circle ? <CircleDetail circle={circle} /> : <CareOverview />;
}

/** A person-first glance shows a few changes per circle, not the whole log. */
const CHANGE_PREVIEW_COUNT = 3;

function CareOverview() {
  const { copy, navigate } = useNimiDay();
  const { state } = useDayStore();
  const { changes, sourceApps, activityStatus, now } = useEngine();
  const ui = useUi();
  const circles = useMemo(
    () => [...state.circles].sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended')),
    [state.circles],
  );
  const { grouped, pending, unknown, other } = useMemo(() => careChanges(changes, circles), [changes, circles]);
  const sourceChildren = sourceApps.find(app => app.appId === PARENTOS_APP_ID)?.groups ?? [];

  return (
    <div className="nd-page" data-testid="nd-care">
      <PageHead title={copy.care.title} sub={copy.care.subtitle} action={circles.length ? <Button tone="primary" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editCircle(null)}>{copy.care.add}</Button> : undefined} />
      {circles.length === 0 ? (
        <Card>
          <div className="nd-care-empty">
            <CircleIcon kind="other" size={22} />
            <p className="nd-care-empty-title">{copy.care.empty}</p>
            <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{copy.care.emptyBody}</p>
            <Button tone="primary" size="sm" style={{ marginTop: 8 }} onClick={() => ui.editCircle(null)}>{copy.care.add}</Button>
          </div>
        </Card>
      ) : (
        <div className="nd-circle-grid">
          {circles.map((circle) => {
            const items = careItems(state.items, circle.id);
            const next = items[0];
            const fresh = changes.filter((change) => change.circleId === circle.id && change.unread).length;
            return (
              <article key={circle.id} className="nd-circle-card" data-status={circle.status}>
                <div className="nd-circle-card-head">
                  <CircleIcon kind={circle.kind} size={20} />
                  <button type="button" className="nd-link nd-circle-name" onClick={() => navigate({ view: 'care', circleId: circle.id })}>
                    {circle.name}
                    {circle.name !== copy.kinds.circle[circle.kind] ? <span className="nd-muted">{copy.kinds.circle[circle.kind]}</span> : null}
                  </button>
                  {circle.status !== 'active' ? <StatusBadge tone="neutral">{copy.kinds.circleStatus[circle.status]}</StatusBadge> : null}
                </div>
                <div className="nd-care-watch">
                  <span className="nd-care-label">{copy.care.watchLabel}</span>
                  {circle.watch ? <p className="nd-circle-watch" title={circle.watch}>{circle.watch}</p> : (
                    <div className="nd-inline-actions">
                      <span className="nd-muted">{copy.care.watchUnset}</span>
                      <button type="button" className="nd-link" onClick={() => ui.editCircle(circle.id)}>{copy.care.addWatch}</button>
                    </div>
                  )}
                </div>
                <div className="nd-care-item-preview">
                  <span className="nd-care-label">{items.length ? copy.care.openItems(items.length) : copy.care.items}</span>
                  {next ? (
                    <button type="button" className="nd-care-item-link" onClick={() => ui.openItem(next.id)}>
                      <span className="nd-care-item-title">{next.title}</span>
                      <span className="nd-care-item-meta">
                        {isOverdue(next, now) ? <Chip tone="warning">{copy.care.overdue}</Chip> : null}
                        {next.state === 'waiting' ? <Chip>{copy.care.waiting}</Chip> : null}
                        {next.date && next.date.slice(0, 4) !== toLocalDate(now).slice(0, 4)
                          ? `${formatDate(copy, next.date, toLocalDate(now))} · ${next.time ?? copy.time.allDay}`
                          : formatWhen(copy, next, toLocalDate(now))}
                      </span>
                    </button>
                  ) : <span className="nd-muted">{copy.care.noItems}</span>}
                </div>
                <div className="nd-circle-card-foot">
                  <div className="nd-row-meta">
                    {fresh > 0 ? <Chip tone="info">{copy.care.unreadChanges(fresh)}</Chip> : null}
                    {circle.focus.slice(0, 3).map((tag) => <Chip key={tag} tone="accent">{tag}</Chip>)}
                  </div>
                  <button type="button" className="nd-link nd-link-icon" onClick={() => navigate({ view: 'care', circleId: circle.id })}>
                    {copy.care.viewDetails}<ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="nd-columns nd-care-columns" style={{ marginTop: 22 }}>
        <Card title={copy.today.changes} hint={copy.care.changesHint} testId="nd-care-changes">
          {activityStatus === 'no-access' ? (
            <>
              <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{copy.today.sourcesNoAccess}</p>
              <p className="nd-faint" style={{ margin: '6px 0 0' }}>{copy.today.sourcesNoAccessBody}</p>
            </>
          ) : activityStatus === 'unavailable' ? <Hint>{copy.care.changesUnavailable}</Hint>
            : changes.length === 0 ? <Hint>{activityStatus === 'ready' ? copy.today.changesEmpty : copy.common.loading}</Hint> : (
            <div className="nd-circle-groups">
              {grouped.length > 0 ? <h3 className="nd-care-section-title">{copy.care.linkedChanges}</h3> : null}
              {grouped.map(({ circle, list }) => {
                const fresh = list.filter((change) => change.unread).length;
                return (
                  <section key={circle.id} className="nd-circle-group">
                    <div className="nd-circle-group-head">
                      <CircleIcon kind={circle.kind} size={14} />
                      <span className="nd-circle-group-name">{circle.name}</span>
                      {fresh > 0 ? <Chip tone="info">{copy.care.unreadChanges(fresh)}</Chip> : null}
                      {list.length > CHANGE_PREVIEW_COUNT ? (
                        <button type="button" className="nd-link nd-link-icon" onClick={() => navigate({ view: 'care', circleId: circle.id })}>
                          {copy.care.seeAllChanges(list.length)}<ArrowRight size={12} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    <div className="nd-list">
                      {list.slice(0, CHANGE_PREVIEW_COUNT).map((change) => <SourceRow key={change.id} change={change} showCircle={false} presentation="care" />)}
                    </div>
                  </section>
                );
              })}
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
              {other.length > 0 ? (
                <section className="nd-circle-group">
                  <h3 className="nd-care-section-title">{copy.care.otherChanges}</h3>
                  <ChangePreview changes={other} />
                </section>
              ) : null}
            </div>
          )}
          <SourceCoverageNote />
        </Card>
        <HandbookCard circleId={null} />
      </div>
    </div>
  );
}

function ChangePreview({ changes, associationInGroup = false }: { readonly changes: readonly SourceChange[]; readonly associationInGroup?: boolean }) {
  const { copy } = useNimiDay();
  const [visible, setVisible] = useState(CHANGE_PREVIEW_COUNT);
  return (
    <>
      <div className="nd-list">
        {changes.slice(0, visible).map((change) => <SourceRow key={change.id} change={change} presentation="care" associationInGroup={associationInGroup} />)}
      </div>
      {changes.length > CHANGE_PREVIEW_COUNT ? (
        <div className="nd-care-list-footer">
          <span className="nd-muted">{copy.care.showingChanges(Math.min(visible, changes.length), changes.length)}</span>
          {visible < changes.length ? <button type="button" className="nd-link" onClick={() => setVisible((count) => count + CHANGE_PREVIEW_COUNT)}>{copy.care.loadMoreChanges}</button> : null}
          {visible > CHANGE_PREVIEW_COUNT ? <button type="button" className="nd-link" onClick={() => setVisible(CHANGE_PREVIEW_COUNT)}>{copy.care.showLessChanges}</button> : null}
        </div>
      ) : null}
    </>
  );
}

function CircleDetail({ circle }: { readonly circle: CareCircle }) {
  const { copy, navigate, actions, engine } = useNimiDay();
  const { state } = useDayStore();
  const { changes } = useEngine();
  const desk = useDesk();
  const ui = useUi();
  const items = useMemo(() => state.items
    .filter((item) => item.circleId === circle.id && isActive(item))
    .sort((a, b) => `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`)), [state.items, circle.id]);
  const circleChanges = attentionOrder(changes.filter((change) => change.circleId === circle.id));
  const agentName = desk.agent?.displayName ?? copy.common.agentFallback;
  const [confirming, setConfirming] = useState<'end' | 'delete' | null>(null);

  const review = async () => {
    const result = await engine.startSkill({ skillId: CARE_REVIEW_SKILL, trigger: 'user', focusCircleId: circle.id });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else navigate({ view: 'routines', runId: result.runId });
  };

  return (
    <div className="nd-page" data-testid="nd-circle-detail">
      <button type="button" className="nd-link nd-link-icon" onClick={() => navigate({ view: 'care' })} style={{ marginBottom: 14 }}>
        <ArrowLeft size={14} aria-hidden="true" />{copy.care.title}
      </button>
      <div className="nd-hero">
        <div className="nd-inline-actions" style={{ gap: 14, alignItems: 'flex-start' }}>
          <CircleIcon kind={circle.kind} size={22} />
          <div>
            <h1 className="nd-page-title">{circle.name}</h1>
            <p className="nd-page-sub">
              {copy.kinds.circle[circle.kind]} · {copy.kinds.circleStatus[circle.status]}
            </p>
          </div>
        </div>
        <div className="nd-inline-actions">
          <Button tone="secondary" size="sm" disabled={desk.phase !== 'ready' || !desk.canUseWork || circle.status === 'ended'} onClick={() => { void review(); }}>
            {copy.care.review(agentName)}
          </Button>
          <Button tone="ghost" size="sm" onClick={() => ui.editCircle(circle.id)}>{copy.common.edit}</Button>
          <MenuButton
            label={copy.common.more}
            items={[
              circle.status === 'active' ? { id: 'pause', label: copy.care.pause, onSelect: () => actions.setCircleStatus(circle.id, 'paused') } : null,
              circle.status !== 'active' ? { id: 'resume', label: copy.care.resume, onSelect: () => actions.setCircleStatus(circle.id, 'active') } : null,
              circle.status !== 'ended' ? { id: 'end', label: copy.care.end, onSelect: () => setConfirming('end') } : null,
              { id: 'delete', label: copy.common.delete, tone: 'danger', onSelect: () => setConfirming('delete') },
            ]}
          />
        </div>
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

      <Card title={copy.care.watch}>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{circle.watch || <span className="nd-faint">{copy.care.watchPlaceholder}</span>}</p>
        {circle.focus.length > 0 ? (
          <div className="nd-row-meta" style={{ marginTop: 10 }}>
            {circle.focus.map((tag) => <Chip key={tag} tone="accent">{tag}</Chip>)}
          </div>
        ) : null}
      </Card>

      <div className="nd-columns" style={{ marginTop: 18 }}>
        <div className="nd-stack">
          <Card title={copy.care.items}>
            <QuickCapture circleId={circle.id} />
            {items.length === 0 ? <Hint>{copy.care.noItems}</Hint> : (
              <div className="nd-list" style={{ marginTop: 8 }}>
                {items.map((item) => <ItemRow key={item.id} item={item} showDay showSnooze />)}
              </div>
            )}
          </Card>
          <Card title={copy.care.changes}>
            {circleChanges.length === 0 ? <Hint>{copy.care.noChanges}</Hint> : (
              <div className="nd-list">
                {circleChanges.map((change) => <SourceRow key={change.id} change={change} showCircle={false} />)}
              </div>
            )}
          </Card>
        </div>
        <HandbookCard circleId={circle.id} />
      </div>
    </div>
  );
}

export function HandbookCard({ circleId }: { readonly circleId: string | null }) {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const ui = useUi();
  const notes = state.notes
    .filter((note) => circleId === null || note.circleId === circleId)
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.updatedAt < b.updatedAt ? 1 : -1));

  return (
    <Card
      title={<span className="nd-card-title-icon"><NotebookText size={15} aria-hidden="true" />{copy.handbook.title}</span>}
      hint={circleId === null ? copy.handbook.subtitle : undefined}
      action={<Button tone="ghost" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editNote({ circleId })}>{copy.handbook.add}</Button>}
      testId="nd-handbook"
    >
      {notes.length === 0 ? <Hint>{circleId ? copy.care.noNotes : copy.handbook.empty}</Hint> : (
        <div className="nd-handbook-list">
          {notes.map((note) => {
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
    </Card>
  );
}
