import { skillRunName, resolveSkills } from '../domain/skills.js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { formatWhen } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { AppointPanel } from './appoint-panel.js';
import { CIRCLE_ICONS, RunStateChip, SkillIcon } from './common.js';
import { ItemEditor } from './item-editor.js';
import { ItemRow } from './item-row.js';
import { ParentOSChildren } from './parentos-children.js';
import { RunCard } from './run-card.js';
import { UiContext, useUi, type NewItemOptions, type NoteTarget, type UiApi } from './ui-context.js';
import type { FollowUpDraft } from './followup-draft.js';
import type { ItemComposerState } from './item-composer-state.js';

type Overlay =
  | { readonly kind: 'item'; readonly itemId: string | null; readonly draft?: Partial<ItemDraft>; readonly draftKey?: string; readonly onCreated?: NewItemOptions['onCreated'] }
  | { readonly kind: 'run'; readonly runId: string }
  | { readonly kind: 'circle'; readonly circleId: string | null }
  | { readonly kind: 'note'; readonly target: NoteTarget }
  | { readonly kind: 'appoint' };

export function UiHost({ children }: { readonly children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // UI-session only: navigation keeps the draft; a new App/session starts clean.
  const followUpDraft = useRef<FollowUpDraft | null>(null);
  // Different source arrangements keep their own draft; all Items-page filters
  // use one stable key. Nothing is carried into a new App or account session.
  const itemDrafts = useRef(new Map<string, ItemComposerState>());
  const close = () => setOverlay(null);
  const api = useMemo<UiApi>(() => ({
    followUpDraft,
    openItem: (itemId) => setOverlay({ kind: 'item', itemId }),
    newItem: (draft, options) => setOverlay({ kind: 'item', itemId: null, draft,
      draftKey: options?.draftKey ?? JSON.stringify(draft ?? {}), onCreated: options?.onCreated }),
    openRun: (runId) => setOverlay({ kind: 'run', runId }),
    editCircle: (circleId) => setOverlay({ kind: 'circle', circleId }),
    editNote: (target) => setOverlay({ kind: 'note', target }),
    appointAgent: () => setOverlay({ kind: 'appoint' }),
  }), []);

  return (
    <UiContext.Provider value={api}>
      {children}
      {overlay?.kind === 'item' ? <ItemEditor key={overlay.itemId ?? overlay.draftKey} itemId={overlay.itemId} draft={overlay.draft} onClose={close}
        savedDraft={overlay.draftKey ? itemDrafts.current.get(overlay.draftKey) : undefined}
        onDraftChange={value => {
          if (!overlay.draftKey) return;
          if (value) itemDrafts.current.set(overlay.draftKey, value);
          else itemDrafts.current.delete(overlay.draftKey);
        }} onCreated={overlay.onCreated} /> : null}
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
      <DialogContent onClose={onClose} data-testid="nd-appoint-dialog" className="nd-appoint-dialog">
        <DialogHeader><DialogTitle>{copy.onboarding.chooseTitle}</DialogTitle></DialogHeader>
        <DialogBody>
          <AppointPanel onDone={onClose} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function RunDetail({ runId, onClose }: { readonly runId: string; readonly onClose: () => void }) {
  const { copy, language } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const ui = useUi();
  const run = state.runs.find((entry) => entry.id === runId);
  const today = toLocalDate(now);
  const appointment = state.items.find(item => item.id === run?.focusItemId);
  const decisions = state.items.filter(item => item.state === 'waiting' && item.decision && run?.changes.some(change => change.kind === 'decision-asked' && change.itemId === item.id));
  const skill = run ? resolveSkills(language, state.skillOverrides, state.customSkills).find((entry) => entry.id === run.skillId) : undefined;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-run-detail" className="nd-run-dialog">
        <DialogHeader className="nd-run-hero">
          {skill ? <span className="nd-run-skill-badge" data-icon={skill.icon}><SkillIcon icon={skill.icon} size={20} /></span> : null}
          <div className="nd-run-hero-copy">
            <DialogTitle className="nd-run-hero-title">{run ? skillRunName(run, language) : copy.run.detail}</DialogTitle>
            {skill?.purpose ? <p>{skill.purpose}</p> : null}
          </div>
          {run ? <RunStateChip state={run.state} /> : null}
        </DialogHeader>
        <DialogBody className="nd-run-dialog-body">
          {!run ? <p className="nd-empty">{copy.routines.runsEmpty}</p> : (
            <>
              {appointment ? <div className="nd-task-appointment">
                <span className="nd-field-label">{copy.run.selectedAppointment}</span>
                <button type="button" className="nd-link" onClick={() => ui.openItem(appointment.id)}>{appointment.title}</button>
                <span className="nd-faint">{formatWhen(copy, appointment, today)}{appointment.place ? ` · ${appointment.place}` : ''}</span>
              </div> : null}
              <RunCard key={run.id} run={run}>
                {decisions.length ? <section className="nd-task-decisions">
                  <h3 className="nd-field-label">{copy.run.decisions}</h3>
                  {decisions.map(item => <ItemRow key={item.id} item={item} />)}
                </section> : null}
              </RunCard>
            </>
          )}
        </DialogBody>
        <DialogFooter className="nd-run-dialog-footer"><Button tone={run?.state === 'done' ? 'primary' : 'secondary'} onClick={onClose}>{run?.state === 'done' ? copy.run.acknowledge : copy.common.close}</Button></DialogFooter>
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
  const [manualChild, setManualChild] = useState(false);
  const choosingChild = !circle && kind === 'child' && !manualChild;
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
      <DialogContent onClose={onClose} data-testid="nd-circle-editor" className="nd-circle-editor">
        <DialogHeader><DialogTitle>{circle ? copy.care.edit : copy.care.add}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            <div className="nd-field">
              <div className="nd-kind-picker" role="group" aria-label={copy.care.kind}>
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
            {choosingChild ? (
              <ParentOSChildren contentLayer="dialog" onAdded={created => { navigate({ view: 'care', circleId: created.id }); onClose(); }} />
            ) : <>
              {!circle && kind === 'child' ? <Button tone="ghost" size="sm" onClick={() => setManualChild(false)}>{copy.childSources.back}</Button> : null}
              <label className="nd-field">
                <span className="nd-field-label">{copy.care.name}</span>
                <TextField value={name} autoFocus placeholder={copy.kinds.circlePlaceholder[kind]} maxLength={60} onChange={(event) => setName(event.target.value)} />
              </label>
              <details className="nd-care-optional" open={circle ? true : undefined}>
                <summary>{copy.care.optionalDetails}</summary>
                <div className="nd-form">
                  <label className="nd-field">
                    <span className="nd-field-label">{copy.care.watch}</span>
                    <TextareaField value={watch} rows={3} maxLength={1000} placeholder={copy.care.watchPlaceholder} onChange={(event) => setWatch(event.target.value)} />
                  </label>
                  <label className="nd-field">
                    <span className="nd-field-label">{copy.care.focus}</span>
                    <TextField value={focus} maxLength={240} placeholder={copy.care.focusPlaceholder} onChange={(event) => setFocus(event.target.value)} />
                  </label>
                </div>
              </details>
            </>}
          </div>
        </DialogBody>
        <DialogFooter className="nd-circle-editor-footer">
          {choosingChild ? <Button tone="ghost" size="sm" onClick={() => setManualChild(true)}>{copy.childSources.manual}</Button> : null}
          <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
          {!choosingChild ? <Button tone="primary" size="sm" disabled={!name.trim()} onClick={save}>{circle ? copy.common.save : copy.common.add}</Button> : null}
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
            <div className="nd-field">
              <span className="nd-field-label nd-split">
                <span>{copy.item.circle}</span>
                <span className="nd-inline-actions" style={{ fontWeight: 400 }}>
                  {copy.handbook.pin}
                  <Toggle checked={pinned} onValueChange={setPinned} ariaLabel={copy.handbook.pin} />
                </span>
              </span>
              <SelectField
                contentLayer="dialog"
                aria-label={copy.item.circle}
                value={circleId}
                onValueChange={setCircleId}
                options={[{ value: 'none', label: copy.common.unassigned }, ...state.circles.map((circle) => ({ value: circle.id, label: circle.name }))]}
              />
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
