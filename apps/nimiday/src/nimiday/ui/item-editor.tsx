import { useId, useMemo, useState } from 'react';
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
} from '@nimiplatform/kit/ui';
import type { ItemDraft } from '../domain/items.js';
import { addDays, toLocalDate, toLocalTime, weekdayOf } from '../domain/time.js';
import type { Importance, ItemKind, LifeItem, RemindRule, RepeatFreq } from '../domain/types.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { TimeField, timeFieldLabels } from './time-field.js';
import { isEditorScheduleValid, nextScheduleMinute, updateEditorSchedule, type EditorSchedule } from './item-editor-schedule.js';
import { ItemDecision } from './item-decision.js';
import { OriginNote } from './common.js';

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
  const [checkedAt, setCheckedAt] = useState(() => new Date());
  const currentTime = now > checkedAt ? now : checkedAt;
  const today = toLocalDate(currentTime);
  const item = itemId ? state.items.find((entry) => entry.id === itemId) ?? null : null;
  const [form, setForm] = useState<FormState>(() => initialForm(item, draft, today));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDecision, setEditingDecision] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setSchedule = (patch: Partial<EditorSchedule>) => {
    const clock = new Date();
    setCheckedAt(clock);
    setForm((current) => updateEditorSchedule(current, patch, clock));
  };

  const circles = state.circles.filter((circle) => circle.status !== 'ended' || circle.id === item?.circleId);
  const circleOptions = useMemo(() => [
    { value: 'none', label: copy.common.unassigned },
    ...circles.map((circle) => ({ value: circle.id, label: circle.name })),
  ], [circles, copy]);

  const scheduleValid = isEditorScheduleValid(form, item, currentTime);
  const canSave = form.title.trim().length > 0 && scheduleValid;
  const earliestMinute = nextScheduleMinute(currentTime);
  const timeUnavailable = Boolean(form.date && form.date < toLocalDate(earliestMinute));
  const minPickerTime = form.date === toLocalDate(earliestMinute) ? toLocalTime(earliestMinute) : undefined;

  const save = () => {
    const clock = new Date();
    setCheckedAt(clock);
    if (!form.title.trim() || !isEditorScheduleValid(form, item, clock)) return;
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
              {item?.decision ? <p className="nd-decision-question">{item.decision.question}</p> : <TextField
                value={form.title}
                placeholder={copy.item.titlePlaceholder}
                maxLength={200}
                inputClassName="nd-item-editor-title"
                onChange={(event) => set('title', event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') save(); }}
              />}
            </label>
            <div className="nd-field">
              <span className="nd-field-label">{copy.item.kind}</span>
              <SegmentedControl
                ariaLabel={copy.item.kind}
                size="sm"
                className="nd-segmented-fill"
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
            <div className="nd-form-section">
              <h3 className="nd-form-section-title">{copy.item.sectionWhen}</h3>
              <div className="nd-field-row nd-item-editor-schedule">
                <label className="nd-field">
                  <span className="nd-field-label">{copy.item.date}</span>
                  <DatePicker
                    contentLayer="dialog"
                    value={form.date}
                    onValueChange={(value) => setSchedule({ date: value })}
                    placeholder={copy.time.noDate}
                    allowClear
                    minDate={today}
                    maxDate={maxPickerDate}
                    labels={datePickerLabels}
                  />
                </label>
                <div className="nd-field">
                  <span className="nd-field-label nd-split">
                    <span id={timeLabelId}>{copy.item.time}</span>
                    <span className="nd-inline-actions" style={{ fontWeight: 400 }}>
                      {copy.item.allDay}
                      <Toggle checked={form.allDay} onValueChange={(value) => setSchedule({ allDay: value })} ariaLabel={copy.item.allDay} disabled={!form.date} />
                    </span>
                  </span>
                  <TimeField
                    contentLayer="dialog"
                    aria-labelledby={timeLabelId}
                    value={form.time}
                    disabled={form.allDay || !form.date || timeUnavailable}
                    minTime={minPickerTime}
                    onValueChange={(value) => setSchedule({ time: value })}
                    labels={timeFieldLabels(copy, copy.item.time)}
                  />
                </div>
              </div>
              <div className="nd-date-chips" role="group" aria-label={copy.item.date}>
                {dateShortcuts.map((shortcut) => (
                  <button
                    key={shortcut.key}
                    type="button"
                    className="nd-date-chip"
                    aria-pressed={form.date === shortcut.value}
                    onClick={() => setSchedule({ date: shortcut.value })}
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
              {!scheduleValid ? <p role="alert" className="nd-faint">{copy.item.futureScheduleRequired}</p> : null}
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
                  className="nd-segmented-fill"
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
            </div>
            <div className="nd-form">
              <label className="nd-field">
                <span className="nd-field-label">{copy.item.notes}</span>
                <TextareaField value={form.notes} rows={3} maxLength={4000} onChange={(event) => set('notes', event.target.value)} />
              </label>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="nd-split" style={{ width: '100%' }}>
            <div className="nd-inline-actions">
              {item && item.state !== 'dropped' ? (
                <Button tone="ghost" size="sm" onClick={() => { actions.dropItem(item.id); onClose(); }}>{dropLabel}</Button>
              ) : null}
              {item ? (
                confirmDelete ? (
                  <Button tone="danger" size="sm" onClick={() => { actions.deleteItem(item.id); onClose(); }} title={deleteHint}>{copy.item.delete}</Button>
                ) : (
                  <Button tone="ghost" size="sm" onClick={() => setConfirmDelete(true)}>{copy.common.delete}</Button>
                )
              ) : null}
            </div>
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" disabled={!canSave} onClick={save}>{item ? copy.common.save : copy.common.add}</Button>
            </div>
          </div>
          {confirmDelete ? <p className="nd-faint" style={{ margin: '8px 0 0' }}>{deleteHint}</p> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
