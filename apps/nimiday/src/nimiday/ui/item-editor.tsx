import { useId, useMemo, useState } from 'react';
import {
  Button,
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
} from '@nimiplatform/kit/ui';
import type { ItemDraft } from '../domain/items.js';
import { toLocalDate, weekdayOf } from '../domain/time.js';
import type { Importance, ItemKind, LifeItem, RemindRule, RepeatFreq } from '../domain/types.js';
import { formatInstant } from '../i18n/index.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';

type RemindChoice = 'none' | 'at-time' | '10' | '30' | '60' | '1440';

function remindChoice(rule: RemindRule): RemindChoice {
  if (rule.kind === 'none') return 'none';
  if (rule.kind === 'at-time') return 'at-time';
  const known: RemindChoice[] = ['10', '30', '60', '1440'];
  return known.find((value) => Number(value) === rule.minutes) ?? '60';
}

function remindRule(choice: RemindChoice): RemindRule {
  if (choice === 'none') return { kind: 'none' };
  if (choice === 'at-time') return { kind: 'at-time' };
  return { kind: 'before', minutes: Number(choice) };
}

type FormState = {
  title: string;
  kind: ItemKind;
  circleId: string;
  date: string;
  time: string;
  allDay: boolean;
  repeat: RepeatFreq | 'none';
  interval: number;
  weekdays: number[];
  remind: RemindChoice;
  importance: Importance;
  place: string;
  notes: string;
};

function initialForm(item: LifeItem | null, draft: Partial<ItemDraft> | undefined, today: string): FormState {
  if (item) {
    return {
      title: item.title,
      kind: item.kind,
      circleId: item.circleId ?? 'none',
      date: item.date ?? '',
      time: item.time ?? '09:00',
      allDay: item.time === null,
      repeat: item.repeat?.freq ?? 'none',
      interval: item.repeat?.interval ?? 1,
      weekdays: [...(item.repeat?.weekdays ?? [])],
      remind: remindChoice(item.remind),
      importance: item.importance,
      place: item.place,
      notes: item.notes,
    };
  }
  return {
    title: draft?.title ?? '',
    kind: draft?.kind ?? 'todo',
    circleId: draft?.circleId ?? 'none',
    date: draft?.date ?? today,
    time: draft?.time ?? '09:00',
    allDay: draft?.time === undefined || draft?.time === null,
    repeat: draft?.repeat?.freq ?? 'none',
    interval: draft?.repeat?.interval ?? 1,
    weekdays: [...(draft?.repeat?.weekdays ?? [])],
    remind: draft?.remind ? remindChoice(draft.remind) : 'at-time',
    importance: draft?.importance ?? 'normal',
    place: draft?.place ?? '',
    notes: draft?.notes ?? '',
  };
}

export function ItemEditor({
  itemId,
  draft,
  onClose,
}: {
  readonly itemId: string | null;
  readonly draft?: Partial<ItemDraft>;
  readonly onClose: () => void;
}) {
  const timeLabelId = useId();
  const { actions, copy } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const today = toLocalDate(now);
  const item = itemId ? state.items.find((entry) => entry.id === itemId) ?? null : null;
  const [form, setForm] = useState<FormState>(() => initialForm(item, draft, today));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const circles = state.circles.filter((circle) => circle.status !== 'ended' || circle.id === item?.circleId);
  const circleOptions = useMemo(() => [
    { value: 'none', label: copy.common.unassigned },
    ...circles.map((circle) => ({ value: circle.id, label: circle.name })),
  ], [circles, copy]);

  const canSave = form.title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const hasDate = form.date !== '';
    const repeat = hasDate && form.repeat !== 'none'
      ? {
        freq: form.repeat,
        interval: Math.max(1, form.interval),
        weekdays: form.repeat === 'weekly' ? (form.weekdays.length ? form.weekdays : [weekdayOf(form.date)]) : [],
      }
      : null;
    const values = {
      title: form.title,
      kind: form.kind,
      circleId: form.circleId === 'none' ? null : form.circleId,
      date: hasDate ? form.date : null,
      time: hasDate && !form.allDay ? form.time : null,
      repeat,
      remind: hasDate ? remindRule(form.remind) : { kind: 'none' as const },
      importance: form.importance,
      place: form.place,
      notes: form.notes,
    };
    if (item) actions.editItem(item.id, values);
    else actions.addItem({ ...values, ...(draft?.source ? { source: draft.source } : {}) });
    onClose();
  };

  const quiet = state.profile.quiet;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} data-testid="nd-item-editor">
        <DialogHeader>
          <DialogTitle>{item ? copy.item.editTitle : copy.item.new}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            {(item?.source ?? draft?.source) ? (
              <p className="nd-faint" style={{ margin: 0 }} data-testid="nd-item-source-note">
                {copy.item.sourceArrangement((item?.source ?? draft!.source)!.appName, (item?.source ?? draft!.source)!.title)}
              </p>
            ) : null}
            <label className="nd-field">
              <span className="nd-field-label">{copy.item.title}</span>
              <TextField
                autoFocus={!item}
                value={form.title}
                placeholder={copy.item.titlePlaceholder}
                maxLength={200}
                onChange={(event) => set('title', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
              />
            </label>
            <div className="nd-field">
              <span className="nd-field-label">{copy.item.kind}</span>
              <SegmentedControl
                ariaLabel={copy.item.kind}
                size="sm"
                value={form.kind}
                onValueChange={(value) => set('kind', value as ItemKind)}
                items={(['todo', 'appointment', 'reminder', 'follow-up'] as const).map((kind) => ({ value: kind, label: copy.kinds.item[kind] }))}
              />
            </div>
            <div className="nd-field-row">
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.circle}</span>
                <SelectField options={circleOptions} value={form.circleId} onValueChange={(value) => set('circleId', value)} contentLayer="dialog" aria-label={copy.item.circle} />
              </label>
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.place}</span>
                <TextField value={form.place} maxLength={200} placeholder={copy.common.optional} onChange={(event) => set('place', event.target.value)} />
              </label>
            </div>
            <div className="nd-field-row">
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.date}</span>
                <input className="nd-native-input" type="date" value={form.date} onChange={(event) => set('date', event.target.value)} />
              </label>
              <div className="nd-field">
                <span className="nd-field-label nd-split">
                  <span id={timeLabelId}>{copy.item.time}</span>
                  <span className="nd-inline-actions" style={{ fontWeight: 400 }}>
                    {copy.item.allDay}
                    <Toggle checked={form.allDay} onValueChange={(value) => set('allDay', value)} ariaLabel={copy.item.allDay} disabled={!form.date} />
                  </span>
                </span>
                <input className="nd-native-input" type="time" aria-labelledby={timeLabelId} value={form.time} disabled={form.allDay || !form.date} onChange={(event) => set('time', event.target.value)} />
              </div>
            </div>
            {form.date ? (
              <div className="nd-field-row">
                <label className="nd-field">
                  <span className="nd-field-label">{copy.item.repeat}</span>
                  <SelectField
                    contentLayer="dialog"
                    aria-label={copy.item.repeat}
                    value={form.repeat}
                    onValueChange={(value) => set('repeat', value as FormState['repeat'])}
                    options={(['none', 'daily', 'weekly', 'monthly', 'yearly'] as const).map((value) => ({ value, label: copy.item.repeatOptions[value] }))}
                  />
                </label>
                <label className="nd-field">
                  <span className="nd-field-label">{copy.item.remind}</span>
                  <SelectField
                    contentLayer="dialog"
                    aria-label={copy.item.remind}
                    value={form.remind}
                    onValueChange={(value) => set('remind', value as RemindChoice)}
                    options={(['none', 'at-time', '10', '30', '60', '1440'] as const).map((value) => ({ value, label: copy.item.remindOptions[value] }))}
                  />
                </label>
              </div>
            ) : null}
            {form.date && form.repeat === 'weekly' ? (
              <div className="nd-field">
                <span className="nd-field-label">{copy.item.repeatDays}</span>
                <div className="nd-weekday-picker">
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <button
                      key={weekday}
                      type="button"
                      className="nd-weekday"
                      aria-pressed={form.weekdays.includes(weekday) || (form.weekdays.length === 0 && weekdayOf(form.date) === weekday)}
                      onClick={() => set('weekdays', form.weekdays.includes(weekday)
                        ? form.weekdays.filter((value) => value !== weekday)
                        : [...form.weekdays, weekday])}
                    >
                      {copy.time.weekdays[weekday]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="nd-field">
              <span className="nd-field-label">{copy.item.importance}</span>
              <SegmentedControl
                ariaLabel={copy.item.importance}
                size="sm"
                value={form.importance}
                onValueChange={(value) => set('importance', value as Importance)}
                items={(['gentle', 'normal', 'important'] as const).map((value) => ({ value, label: copy.kinds.importance[value] }))}
              />
              <span className="nd-faint">
                {quiet.enabled && form.importance === 'normal'
                  ? copy.item.quietHint(quiet.start, quiet.end)
                  : copy.kinds.importanceHint[form.importance]}
              </span>
            </div>
            <label className="nd-field">
              <span className="nd-field-label">{copy.item.notes}</span>
              <TextareaField value={form.notes} rows={3} maxLength={4000} onChange={(event) => set('notes', event.target.value)} />
            </label>
            {item && item.history.length > 0 ? (
              <details>
                <summary className="nd-field-label" style={{ cursor: 'pointer' }}>{copy.item.history}</summary>
                <ul className="nd-changes-list">
                  {[...item.history].reverse().slice(0, 12).map((event, index) => (
                    <li key={`${event.at}-${index}`}>
                      {formatInstant(copy, event.at, today)} · {copy.item.by[event.by]} · {copy.item.events[event.kind]}
                      {event.note && event.kind === 'decided' ? ` · ${event.note}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="nd-split" style={{ width: '100%' }}>
            <div className="nd-inline-actions">
              {item && item.state !== 'dropped' ? (
                <Button tone="ghost" size="sm" onClick={() => { actions.dropItem(item.id); onClose(); }}>{copy.item.drop}</Button>
              ) : null}
              {item ? (
                confirmDelete ? (
                  <Button tone="danger" size="sm" onClick={() => { actions.deleteItem(item.id); onClose(); }} title={copy.item.deleteConfirm}>{copy.item.delete}</Button>
                ) : (
                  <Button tone="ghost" size="sm" onClick={() => setConfirmDelete(true)}>{copy.common.delete}</Button>
                )
              ) : null}
            </div>
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" disabled={!canSave} onClick={save}>{copy.common.save}</Button>
            </div>
          </div>
          {confirmDelete ? <p className="nd-faint" style={{ margin: '8px 0 0' }}>{copy.item.deleteConfirm}</p> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
