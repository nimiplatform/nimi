import { useMemo, useState } from 'react';
import { Button, ConfirmDialog, nimiToast, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowLeft, Pin, Plus } from 'lucide-react';
import { isActive } from '../domain/reminders.js';
import { CARE_REVIEW_SKILL } from '../domain/skills.js';
import { attentionOrder } from '../domain/sources.js';
import type { CareCircle } from '../domain/types.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Card, Chip, CircleIcon, Hint, MenuButton, PageHead } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import { useUi } from './ui-context.js';

export function CarePage({ circleId }: { readonly circleId?: string }) {
  const { state } = useDayStore();
  const circle = circleId ? state.circles.find((entry) => entry.id === circleId) : undefined;
  return circle ? <CircleDetail circle={circle} /> : <CareOverview />;
}

function CareOverview() {
  const { copy, navigate } = useNimiDay();
  const { state } = useDayStore();
  const { changes, activityStatus } = useEngine();
  const ui = useUi();
  const circles = [...state.circles].sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended'));

  return (
    <div className="nd-page" data-testid="nd-care">
      <PageHead title={copy.care.title} sub={copy.care.subtitle} action={<Button tone="primary" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editCircle(null)}>{copy.care.add}</Button>} />
      {circles.length === 0 ? (
        <Card>
          <p style={{ margin: 0, fontWeight: 600 }}>{copy.care.empty}</p>
          <p className="nd-muted" style={{ margin: '6px 0 12px', fontSize: 13 }}>{copy.care.emptyBody}</p>
          <Button tone="primary" size="sm" onClick={() => ui.editCircle(null)}>{copy.care.add}</Button>
        </Card>
      ) : (
        <div className="nd-circle-grid">
          {circles.map((circle) => {
            const open = state.items.filter((item) => item.circleId === circle.id && isActive(item)).length;
            const fresh = changes.filter((change) => change.circleId === circle.id && change.unread).length;
            return (
              <button key={circle.id} type="button" className="nd-circle-card" data-status={circle.status} onClick={() => navigate({ view: 'care', circleId: circle.id })}>
                <div className="nd-split">
                  <CircleIcon kind={circle.kind} />
                  {circle.status !== 'active' ? <StatusBadge tone="neutral">{copy.kinds.circleStatus[circle.status]}</StatusBadge> : null}
                </div>
                <strong style={{ fontSize: 15 }}>
                  {circle.name}
                  {circle.name !== copy.kinds.circle[circle.kind] ? <span className="nd-faint" style={{ fontWeight: 400, marginLeft: 8 }}>{copy.kinds.circle[circle.kind]}</span> : null}
                </strong>
                <p className="nd-circle-watch">
                  {circle.watch || <span className="nd-faint">{copy.care.watchPrompt}</span>}
                </p>
                <div className="nd-row-meta" style={{ marginTop: 'auto' }}>
                  {open > 0 ? <Chip>{copy.care.openItems(open)}</Chip> : null}
                  {fresh > 0 ? <Chip tone="warning">{copy.care.newChanges(fresh)}</Chip> : null}
                  {circle.focus.slice(0, 3).map((tag) => <Chip key={tag} tone="accent">{tag}</Chip>)}
                </div>
              </button>
            );
          })}
          <button type="button" className="nd-add-card" onClick={() => ui.editCircle(null)}>
            <span className="nd-inline-actions"><Plus size={16} aria-hidden="true" />{copy.care.add}</span>
          </button>
        </div>
      )}

      <div className="nd-columns" style={{ marginTop: 22 }}>
        <Card title={copy.today.changes}>
          {activityStatus === 'no-access' ? (
            <>
              <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{copy.today.sourcesNoAccess}</p>
              <p className="nd-faint" style={{ margin: '6px 0 0' }}>{copy.today.sourcesNoAccessBody}</p>
            </>
          ) : changes.length === 0 ? <Hint>{copy.today.changesEmpty}</Hint> : (
            <div className="nd-list">
              {attentionOrder(changes).slice(0, 40).map((change) => <SourceRow key={change.id} change={change} />)}
            </div>
          )}
          <SourceCoverageNote />
        </Card>
        <HandbookCard circleId={null} />
      </div>
    </div>
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
      title={copy.handbook.title}
      hint={circleId === null ? copy.handbook.subtitle : undefined}
      action={<Button tone="ghost" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => ui.editNote({ circleId })}>{copy.handbook.add}</Button>}
      testId="nd-handbook"
    >
      {notes.length === 0 ? <Hint>{circleId ? copy.care.noNotes : copy.handbook.empty}</Hint> : (
        <div className="nd-list">
          {notes.map((note) => {
            const owner = note.circleId ? state.circles.find((circle) => circle.id === note.circleId) : undefined;
            return (
              <div key={note.id} className="nd-row">
                <div className="nd-row-body">
                  <button type="button" className="nd-link" style={{ color: 'inherit', textAlign: 'left' }} onClick={() => ui.editNote({ noteId: note.id, circleId: note.circleId })}>
                    <span className="nd-row-title" style={{ fontWeight: 600 }}>
                      {note.pinned ? <Pin size={12} aria-hidden="true" style={{ marginRight: 4 }} /> : null}
                      {note.title}
                    </span>
                  </button>
                  <div className="nd-faint" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{note.body.length > 180 ? `${note.body.slice(0, 180)}…` : note.body}</div>
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
