import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SelectField,
  TextareaField,
  TextField,
  Toggle,
} from '@nimiplatform/kit/ui';
import { CIRCLE_TEMPLATES } from '../domain/defaults.js';
import type { ItemDraft } from '../domain/items.js';
import { toLocalDate } from '../domain/time.js';
import type { CircleKind } from '../domain/types.js';
import { formatInstant } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { AppointPanel } from './appoint-panel.js';
import { CIRCLE_ICONS, RunStateChip } from './common.js';
import { ItemEditor } from './item-editor.js';
import { RunCard } from './run-card.js';
import { UiContext, type NoteTarget, type UiApi } from './ui-context.js';

type Overlay =
  | { readonly kind: 'item'; readonly itemId: string | null; readonly draft?: Partial<ItemDraft> }
  | { readonly kind: 'run'; readonly runId: string }
  | { readonly kind: 'circle'; readonly circleId: string | null }
  | { readonly kind: 'note'; readonly target: NoteTarget }
  | { readonly kind: 'appoint' };

export function UiHost({ children }: { readonly children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const close = () => setOverlay(null);
  const api = useMemo<UiApi>(() => ({
    openItem: (itemId) => setOverlay({ kind: 'item', itemId }),
    newItem: (draft) => setOverlay({ kind: 'item', itemId: null, draft }),
    openRun: (runId) => setOverlay({ kind: 'run', runId }),
    editCircle: (circleId) => setOverlay({ kind: 'circle', circleId }),
    editNote: (target) => setOverlay({ kind: 'note', target }),
    appointAgent: () => setOverlay({ kind: 'appoint' }),
  }), []);

  return (
    <UiContext.Provider value={api}>
      {children}
      {overlay?.kind === 'item' ? <ItemEditor key={overlay.itemId ?? 'new'} itemId={overlay.itemId} draft={overlay.draft} onClose={close} /> : null}
      {overlay?.kind === 'run' ? <RunDetail runId={overlay.runId} onClose={close} /> : null}
      {overlay?.kind === 'circle' ? <CircleEditor circleId={overlay.circleId} onClose={close} /> : null}
      {overlay?.kind === 'note' ? <NoteEditor target={overlay.target} onClose={close} /> : null}
      {overlay?.kind === 'appoint' ? <AppointDialog onClose={close} /> : null}
    </UiContext.Provider>
  );
}

function AppointDialog({ onClose }: { readonly onClose: () => void }) {
  const { copy, desk } = useNimiDay();
  useEffect(() => { void desk.refreshReferences(); }, [desk]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-appoint-dialog">
        <DialogHeader><DialogTitle>{copy.onboarding.chooseTitle}</DialogTitle></DialogHeader>
        <DialogBody>
          <AppointPanel onDone={onClose} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function RunDetail({ runId, onClose }: { readonly runId: string; readonly onClose: () => void }) {
  const { copy } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const run = state.runs.find((entry) => entry.id === runId);
  const today = toLocalDate(now);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-run-detail">
        <DialogHeader><DialogTitle>{copy.run.detail}</DialogTitle></DialogHeader>
        <DialogBody>
          {!run ? <p className="nd-empty">{copy.routines.runsEmpty}</p> : (
            <>
              <dl className="nd-detail-grid">
                <dt>{copy.routines.rhythmSkill}</dt><dd>{run.skillName} <RunStateChip state={run.state} /></dd>
                <dt>{copy.run.agent}</dt><dd>{run.agentName ?? '—'}</dd>
                <dt>{copy.run.request}</dt><dd>{run.requestText || '—'}</dd>
                <dt>{copy.run.startedAt}</dt><dd>{run.startedAt ? formatInstant(copy, run.startedAt, today) : '—'}</dd>
                <dt>{copy.run.finishedAt}</dt><dd>{run.finishedAt ? formatInstant(copy, run.finishedAt, today) : '—'}</dd>
              </dl>
              {run.toolCalls.length > 0 ? (
                <>
                  <h3 className="nd-field-label" style={{ margin: '16px 0 0' }}>{copy.run.toolCalls}</h3>
                  <ul className="nd-changes-list">
                    {run.toolCalls.map((call) => (
                      <li key={call.callId} style={{ color: call.ok ? undefined : 'var(--nimi-status-danger)' }}>
                        {copy.skills.toolNames[call.name] ?? call.name} · {call.summary}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <RunCard run={run} compact />
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function CircleEditor({ circleId, onClose }: { readonly circleId: string | null; readonly onClose: () => void }) {
  const { copy, actions, navigate } = useNimiDay();
  const { state } = useDayStore();
  const circle = circleId ? state.circles.find((entry) => entry.id === circleId) : undefined;
  const [kind, setKind] = useState<CircleKind>(circle?.kind ?? 'child');
  const [name, setName] = useState(circle?.name ?? '');
  const [watch, setWatch] = useState(circle?.watch ?? '');
  const [focus, setFocus] = useState((circle?.focus ?? []).join(', '));
  const tags = focus.split(/[,，、]/u).map((tag) => tag.trim()).filter(Boolean);

  const save = () => {
    if (!name.trim()) return;
    if (circle) actions.editCircle(circle.id, { kind, name, watch, focus: tags });
    else {
      const created = actions.addCircle({ kind, name, watch, focus: tags });
      navigate({ view: 'care', circleId: created.id });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-circle-editor">
        <DialogHeader><DialogTitle>{circle ? copy.care.edit : copy.care.add}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            <div className="nd-field">
              <span className="nd-field-label">{copy.care.kind}</span>
              <div className="nd-kind-picker">
                {CIRCLE_TEMPLATES.map((template) => {
                  const Icon = CIRCLE_ICONS[template.kind];
                  return (
                    <button key={template.kind} type="button" className="nd-kind-option" aria-pressed={kind === template.kind} onClick={() => setKind(template.kind)}>
                      <Icon size={14} aria-hidden="true" />{copy.kinds.circle[template.kind]}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="nd-field">
              <span className="nd-field-label">{copy.care.name}</span>
              <TextField value={name} autoFocus placeholder={copy.kinds.circlePlaceholder[kind]} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.care.watch}</span>
              <TextareaField value={watch} rows={3} maxLength={1000} placeholder={copy.care.watchPlaceholder} onChange={(event) => setWatch(event.target.value)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.care.focus}</span>
              <TextField value={focus} maxLength={240} placeholder={copy.care.focusPlaceholder} onChange={(event) => setFocus(event.target.value)} />
            </label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
          <Button tone="primary" size="sm" disabled={!name.trim()} onClick={save}>{copy.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteEditor({ target, onClose }: { readonly target: NoteTarget; readonly onClose: () => void }) {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const note = target.noteId ? state.notes.find((entry) => entry.id === target.noteId) : undefined;
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [circleId, setCircleId] = useState(note?.circleId ?? target.circleId ?? 'none');
  const [pinned, setPinned] = useState(note?.pinned ?? false);

  const save = () => {
    if (!title.trim()) return;
    actions.saveNote({ ...(note ? { id: note.id } : {}), circleId: circleId === 'none' ? null : circleId, title, body, pinned });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-note-editor">
        <DialogHeader><DialogTitle>{note ? note.title : copy.handbook.add}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            <label className="nd-field">
              <span className="nd-field-label">{copy.handbook.noteTitle}</span>
              <TextField value={title} autoFocus={!note} placeholder={copy.handbook.noteTitlePlaceholder} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.handbook.body}</span>
              <TextareaField value={body} rows={6} maxLength={4000} placeholder={copy.handbook.bodyPlaceholder} onChange={(event) => setBody(event.target.value)} />
            </label>
            <div className="nd-field-row">
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.circle}</span>
                <SelectField
                  contentLayer="dialog"
                  aria-label={copy.item.circle}
                  value={circleId}
                  onValueChange={setCircleId}
                  options={[{ value: 'none', label: copy.common.unassigned }, ...state.circles.map((circle) => ({ value: circle.id, label: circle.name }))]}
                />
              </label>
              <div className="nd-field">
                <span className="nd-field-label">{copy.handbook.pin}</span>
                <Toggle checked={pinned} onValueChange={setPinned} ariaLabel={copy.handbook.pin} />
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="nd-split" style={{ width: '100%' }}>
            {note ? <Button tone="ghost" size="sm" onClick={() => { actions.deleteNote(note.id); onClose(); }}>{copy.common.delete}</Button> : <span />}
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" disabled={!title.trim()} onClick={save}>{copy.common.save}</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
