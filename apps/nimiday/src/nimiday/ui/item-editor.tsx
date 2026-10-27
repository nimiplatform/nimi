import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  SelectField,
  TextareaField,
  TextField,
  Toggle,
  nimiToast,
} from '@nimiplatform/kit/ui';
import type { ItemDraft } from '../domain/items.js';
import { addDays, toLocalDate, toLocalTime, weekdayOf } from '../domain/time.js';
import type { Importance, ItemKind, LifeItem } from '../domain/types.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { TimeField, timeFieldLabels } from './time-field.js';
import { isEditorScheduleValid, nextScheduleMinute, updateEditorSchedule, type EditorSchedule } from './item-editor-schedule.js';
import { ItemDecision } from './item-decision.js';
import { OriginNote } from './common.js';
import { formatWhen } from '../i18n/index.js';
import { captureItemText, editItemFields, initialItemComposer, itemFormValues, type ItemComposerState, type ItemForm, type RemindChoice } from './item-composer-state.js';
import './item-editor.css';

export function ItemEditor({
  itemId,
  draft,
  onClose,
  savedDraft,
  onDraftChange,
  onCreated,
}: {
  readonly itemId: string | null;
  readonly draft?: Partial<ItemDraft>;
  readonly onClose: () => void;
  readonly savedDraft?: ItemComposerState;
  readonly onDraftChange?: (value: ItemComposerState | null) => void;
  readonly onCreated?: (item: LifeItem) => void;
}) {
  const timeLabelId = useId();
  const { actions, copy, store } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const [checkedAt, setCheckedAt] = useState(() => new Date());
  const currentTime = now > checkedAt ? now : checkedAt;
  const today = toLocalDate(currentTime);
  const item = itemId ? state.items.find((entry) => entry.id === itemId) ?? null : null;
  const [composer, setComposer] = useState(() => savedDraft ?? initialItemComposer(item, draft));
  const form = composer.form;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDecision, setEditingDecision] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => {
    setComposer(current => editItemFields(current, { [key]: value }));
  };
  const setSchedule = (patch: Partial<EditorSchedule>) => {
    const clock = new Date();
    setCheckedAt(clock);
    setComposer(current => {
      const edited = editItemFields(current, patch);
      return { ...edited, form: updateEditorSchedule(edited.form, patch, clock) };
    });
  };
  const pause = () => {
    if (inFlight.current) return;
    if (!itemId) onDraftChange?.(form.title.trim() || form.date || form.place || form.notes ? composer : null);
    onClose();
  };

  const circles = state.circles.filter((circle) => circle.status !== 'ended' || circle.id === form.circleId);
  const circleOptions = useMemo(() => [
    { value: 'none', label: copy.common.unassigned },
    ...circles.map((circle) => ({ value: circle.id, label: circle.name })),
  ], [circles, copy]);

  const scheduleValid = isEditorScheduleValid(form, item, currentTime);
  const canSave = form.title.trim().length > 0 && scheduleValid;
  const earliestMinute = nextScheduleMinute(currentTime);
  const timeUnavailable = Boolean(form.date && form.date < toLocalDate(earliestMinute));
  const minPickerTime = form.date === toLocalDate(earliestMinute) ? toLocalTime(earliestMinute) : undefined;

  const save = async () => {
    if (inFlight.current) return;
    const clock = new Date();
    setCheckedAt(clock);
    if (!form.title.trim() || !isEditorScheduleValid(form, item, clock)) return;
    if (store.getSnapshot().status !== 'ready') { setSaveError(copy.capture.saveFailed); return; }
    inFlight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const values = itemFormValues(form);
      let id = itemId ?? composer.pendingItemId;
      if (id) {
        if (!store.getSnapshot().state.items.some(entry => entry.id === id)) throw new Error(copy.capture.itemUnavailable);
        actions.editItem(id, values);
      } else {
        id = actions.addItem({ ...values, ...(draft?.source ? { source: draft.source } : {}) }).id;
        const pending = { ...composer, pendingItemId: id };
        setComposer(pending);
        onDraftChange?.(pending);
      }
      const outcome = await store.persist();
      if (!mounted.current || store.getSnapshot().status === 'closed') return;
      if (!outcome.ok) { setSaveError(copy.capture.saveFailed); return; }
      const saved = store.getSnapshot().state.items.find(entry => entry.id === id);
      if (!saved) throw new Error(copy.capture.itemUnavailable);
      if (!itemId) {
        onDraftChange?.(null);
        onCreated?.(saved);
        nimiToast.show({ tone: 'success', message: saved.date ? copy.capture.addedWhen(saved.title, formatWhen(copy, saved, today)) : copy.capture.added(saved.title) });
      }
      onClose();
    } catch (error) {
      if (mounted.current) setSaveError(error instanceof Error ? error.message : copy.capture.saveFailed);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const quiet = state.profile.quiet;
  const dropLabel = item?.repeat ? copy.item.stopRepeat : copy.item.drop;
  const deleteHint = copy.item.deleteConfirm(item?.state === 'dropped' ? null : dropLabel);

  const dateShortcuts = [
    { key: 'today', label: copy.time.today, value: today },
    { key: 'tomorrow', label: copy.time.tomorrow, value: addDays(today, 1) },
    { key: 'none', label: copy.time.noDate, value: '' },
  ] as const;

  // Items can be scheduled arbitrarily far ahead; the shared DatePicker
  // otherwise clamps its wheel to today.
  const maxPickerDate = `${Number(today.slice(0, 4)) + 50}-12-31`;
  const pickerCopy = copy.time.picker;
  const datePickerLabels = {
    panelTitle: copy.item.date,
    yearHeader: pickerCopy.year,
    monthHeader: pickerCopy.month,
    dayHeader: pickerCopy.day,
    yearWheelAriaLabel: pickerCopy.yearWheel,
    monthWheelAriaLabel: pickerCopy.monthWheel,
    dayWheelAriaLabel: pickerCopy.dayWheel,
    todayButton: copy.time.today,
    clearButton: pickerCopy.clear,
    confirmButton: pickerCopy.confirm,
    clearValueAriaLabel: pickerCopy.clearDate,
  };

  if (item?.decision && !editingDecision) return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-item-decision">
        <DialogHeader><DialogTitle>{item.state === 'waiting' ? copy.items.waiting : copy.item.decisionRecord}</DialogTitle></DialogHeader>
        <DialogBody>
          <h3 className="nd-decision-question">{item.decision.question}</h3>
          <div className="nd-faint"><OriginNote item={item} /></div>
          {item.state === 'dropped' ? <p className="nd-faint">{copy.item.events.dropped}</p> : null}
          <ItemDecision item={item} onFollowUp={onClose} />
        </DialogBody>
        <DialogFooter>
          <Button tone="ghost" size="sm" onClick={() => setEditingDecision(true)}>{copy.item.editDetails}</Button>
          <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <Dialog open onOpenChange={open => { if (!open) pause(); }}>
      <DialogContent onClose={pause} data-testid="nd-item-editor" className="nd-item-composer">
        <DialogHeader className="nd-item-composer-header"><DialogTitle>{itemId ? copy.item.editTitle : copy.capture.new}</DialogTitle>
          <button type="button" className="nd-item-composer-close" aria-label={copy.common.close} disabled={saving} onClick={pause}><X size={20} aria-hidden="true" /></button>
        </DialogHeader>
        <DialogBody>
          <fieldset className="nd-item-composer-fields nd-dialog-scroll" disabled={saving} aria-busy={saving}>
            {(item?.source ?? draft?.source) ? <p className="nd-faint" data-testid="nd-item-source-note">
              {copy.item.sourceArrangement((item?.source ?? draft!.source)!.appName, (item?.source ?? draft!.source)!.title)}
            </p> : null}
            {item?.decision ? <p className="nd-decision-question">{item.decision.question}</p> : <TextField
              autoFocus
              aria-label={itemId ? copy.item.title : copy.capture.inputLabel}
              value={itemId ? form.title : composer.text}
              placeholder={itemId ? copy.item.titlePlaceholder : copy.capture.placeholder}
              maxLength={200}
              className="nd-item-composer-title"
              onChange={event => itemId ? set('title', event.target.value) : setComposer(current => captureItemText(current, event.target.value, circles, new Date()))}
              onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }}
            />}
            <div className="nd-item-composer-schedule">
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.date}</span>
                <DatePicker contentLayer="dialog" value={form.date} onValueChange={value => setSchedule({ date: value })}
                  placeholder={copy.time.noDate} allowClear minDate={today} maxDate={maxPickerDate} labels={datePickerLabels} />
              </label>
              <div className="nd-field">
                <span className="nd-field-label nd-split">
                  <span id={timeLabelId}>{copy.item.time}</span>
                  <span className="nd-inline-actions nd-item-all-day">{copy.item.allDay}
                    <Toggle checked={form.allDay} onValueChange={value => setSchedule({ allDay: value })} ariaLabel={copy.item.allDay} disabled={!form.date} />
                  </span>
                </span>
                <TimeField contentLayer="dialog" aria-labelledby={timeLabelId} value={form.time}
                  disabled={form.allDay || !form.date || timeUnavailable} minTime={minPickerTime}
                  onValueChange={value => setSchedule({ time: value })} labels={timeFieldLabels(copy, copy.item.time)} />
              </div>
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.circle}</span>
                <SelectField options={circleOptions} value={form.circleId} onValueChange={value => set('circleId', value)} contentLayer="dialog" aria-label={copy.item.circle} />
              </label>
            </div>
            <div className="nd-date-chips" role="group" aria-label={copy.item.date}>
              {dateShortcuts.map(shortcut => <button key={shortcut.key} type="button" className="nd-date-chip" aria-pressed={form.date === shortcut.value}
                onClick={() => setSchedule({ date: shortcut.value })}>{shortcut.label}</button>)}
            </div>
            {!scheduleValid ? <p role="alert" className="nd-item-composer-error">{copy.item.futureScheduleRequired}</p> : null}
            <details className="nd-item-composer-section" open={composer.detailsOpen} onToggle={event => {
              const open = event.currentTarget.open;
              setComposer(current => current.detailsOpen === open ? current : { ...current, detailsOpen: open });
            }}>
              <summary><ChevronDown size={16} aria-hidden="true" />{copy.capture.details}</summary>
              <div className="nd-form">
                <div className="nd-field-row">
                  <label className="nd-field">
                    <span className="nd-field-label">{copy.item.remind}</span>
                    <SelectField contentLayer="dialog" aria-label={copy.item.remind} disabled={!form.date}
                      value={form.date ? form.remind : 'none'} onValueChange={value => set('remind', value as RemindChoice)}
                      options={(['none', 'at-time', '10', '30', '60', '1440'] as const).map(value => ({ value, label: copy.item.remindOptions[value] }))} />
                  </label>
                  <label className="nd-field">
                    <span className="nd-field-label">{copy.item.repeat}</span>
                    <SelectField contentLayer="dialog" aria-label={copy.item.repeat} disabled={!form.date}
                      value={form.date ? form.repeat : 'none'} onValueChange={value => set('repeat', value as ItemForm['repeat'])}
                      options={(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map(value => ({ value, label: copy.item.repeatOptions[value] }))} />
                  </label>
                </div>
                {!form.date ? <p className="nd-faint">{copy.capture.scheduleFirst}</p> : null}
                {form.date && form.repeat === 'weekly' ? <div className="nd-field">
                  <span className="nd-field-label">{copy.item.repeatDays}</span>
                  <div className="nd-weekday-picker">
                    {[1, 2, 3, 4, 5, 6, 0].map(weekday => <button key={weekday} type="button" className="nd-weekday"
                      aria-pressed={form.weekdays.includes(weekday) || (form.weekdays.length === 0 && weekdayOf(form.date) === weekday)}
                      onClick={() => set('weekdays', form.weekdays.includes(weekday) ? form.weekdays.filter(value => value !== weekday) : [...form.weekdays, weekday])}>
                      {copy.time.weekdays[weekday]}
                    </button>)}
                  </div>
                </div> : null}
                <label className="nd-field"><span className="nd-field-label">{copy.item.place}</span>
                  <TextField value={form.place} maxLength={200} placeholder={copy.capture.placePlaceholder} onChange={event => set('place', event.target.value)} />
                </label>
                <label className="nd-field"><span className="nd-field-label">{copy.item.notes}</span>
                  <TextareaField value={form.notes} rows={3} maxLength={4000} placeholder={copy.capture.notesPlaceholder} onChange={event => set('notes', event.target.value)} />
                </label>
              </div>
            </details>
            <details className="nd-item-composer-section" open={composer.advancedOpen} onToggle={event => {
              const open = event.currentTarget.open;
              setComposer(current => current.advancedOpen === open ? current : { ...current, advancedOpen: open });
            }}>
              <summary><ChevronDown size={16} aria-hidden="true" />{copy.capture.advanced}</summary>
              <div className="nd-form">
                <div className="nd-field"><span className="nd-field-label">{copy.item.kind}</span>
                  <SegmentedControl ariaLabel={copy.item.kind} size="sm" className="nd-segmented-fill" value={form.kind}
                    onValueChange={value => set('kind', value as ItemKind)}
                    items={(['todo', 'appointment', 'reminder', 'follow-up'] as const).map(kind => ({ value: kind, label: copy.kinds.item[kind] }))} />
                </div>
                <div className="nd-field"><span className="nd-field-label">{copy.item.importance}</span>
                  <SegmentedControl ariaLabel={copy.item.importance} size="sm" className="nd-segmented-fill" value={form.importance}
                    onValueChange={value => set('importance', value as Importance)}
                    items={(['gentle', 'normal', 'important'] as const).map(value => ({ value, label: copy.kinds.importance[value] }))} />
                  <span className="nd-faint">{quiet.enabled && form.importance === 'normal' ? copy.item.quietHint(quiet.start, quiet.end) : copy.kinds.importanceHint[form.importance]}</span>
                </div>
              </div>
            </details>
            {saveError ? <p role="alert" className="nd-item-composer-error">{saveError}</p> : null}
          </fieldset>
        </DialogBody>
        <DialogFooter className="nd-item-composer-footer">
          <div className="nd-item-composer-footer-note">
            {itemId ? <div className="nd-inline-actions">
              {item && item.state !== 'dropped' ? <Button tone="ghost" size="sm" disabled={saving} onClick={() => { actions.dropItem(item.id); onClose(); }}>{dropLabel}</Button> : null}
              <Button tone={confirmDelete ? 'danger' : 'ghost'} size="sm" disabled={saving} onClick={() => {
                if (confirmDelete) { actions.deleteItem(itemId); onClose(); } else setConfirmDelete(true);
              }}>{confirmDelete ? copy.item.delete : copy.common.delete}</Button>
            </div> : <>
              <span>{copy.capture.draftHint}</span>
              {form.title.trim() && !composer.pendingItemId ? <button type="button" className="nd-link" disabled={saving} onClick={() => {
                if (confirmDiscard) { onDraftChange?.(null); onClose(); } else setConfirmDiscard(true);
              }}>{confirmDiscard ? copy.capture.confirmDiscard : copy.capture.discard}</button> : null}
            </>}
          </div>
          <div className="nd-inline-actions">
            <Button tone="secondary" disabled={saving} onClick={pause}>{itemId ? copy.common.cancel : copy.capture.later}</Button>
            <Button tone="primary" disabled={!canSave || saving} loading={saving} onClick={() => { void save(); }}>{itemId ? copy.common.save : copy.capture.add}</Button>
          </div>
          {confirmDelete ? <p className="nd-faint">{deleteHint}</p> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
