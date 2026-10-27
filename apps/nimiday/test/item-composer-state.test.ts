import { expect, it } from 'vitest';
import { createCircle } from '../src/nimiday/domain/defaults.js';
import { captureItemText, editItemFields, initialItemComposer, itemFormValues } from '../src/nimiday/ui/item-composer-state.js';

const now = new Date('2026-10-27T10:00:00+08:00');
const circle = createCircle({ kind: 'child', name: '小米' }, now);

it('keeps an unscheduled capture undated, including explicit null prefills', () => {
  for (const draft of [undefined, { date: null }]) {
    const state = captureItemText(initialItemComposer(null, draft), '买牛奶', [], now);
    expect(itemFormValues(state.form)).toMatchObject({ title: '买牛奶', date: null, time: null, repeat: null, remind: { kind: 'none' } });
  }
});

it('parses a sentence into the same editable draft and keeps deliberate changes', () => {
  const parsed = captureItemText(initialItemComposer(null), '周五 9:30 带小米打疫苗', [circle], now);
  expect(itemFormValues(parsed.form)).toMatchObject({ title: '带小米打疫苗', date: '2026-10-30', time: '09:30', circleId: circle.id });
  const edited = editItemFields(parsed, { time: '10:30', circleId: 'none' });
  expect(edited.text).toBe('带小米打疫苗');
  const continued = captureItemText(edited, '带小米打疫苗，带上疫苗本', [circle], now);
  expect(itemFormValues(continued.form)).toMatchObject({ date: '2026-10-30', time: '10:30', circleId: null });
});

it('lets unedited recognition follow the sentence, including removed dates and repeat rules', () => {
  const parsed = captureItemText(initialItemComposer(null), '每周五 9:30 带小米打疫苗', [circle], now);
  expect(parsed.form.date).toBe('2026-10-30');
  expect(parsed.form.repeat).toBe('weekly');
  const cleared = captureItemText(parsed, '想想周末去哪', [circle], now);
  expect(itemFormValues(cleared.form)).toMatchObject({ date: null, time: null, repeat: null, circleId: null });
});

it('retains deliberate no-date and no-repeat choices after later typing', () => {
  const parsed = captureItemText(initialItemComposer(null), '每周五 9:30 带小米打疫苗', [circle], now);
  const edited = editItemFields(parsed, { date: '', repeat: 'none' });
  const continued = captureItemText(edited, '周六 带小米打疫苗', [circle], now);
  expect(itemFormValues(continued.form)).toMatchObject({ date: null, time: null, repeat: null });
});
