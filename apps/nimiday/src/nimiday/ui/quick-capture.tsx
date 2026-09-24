import { useMemo, useState } from 'react';
import { Button, nimiToast, TextField } from '@nimiplatform/kit/ui';
import { Plus } from 'lucide-react';
import { circleMentioned, parseQuickCapture } from '../domain/quick-capture.js';
import { toLocalDate } from '../domain/time.js';
import { describeRepeat, formatWhen } from '../i18n/index.js';
import { alignToRepeat, normalizeRepeat } from '../domain/recurrence.js';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { useUi } from './ui-context.js';

export function QuickCapture({ circleId = null }: { readonly circleId?: string | null }) {
  const { actions, copy } = useNimiDay();
  const { now } = useEngine();
  const { state } = useDayStore();
  const ui = useUi();
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parseQuickCapture(text, now) : null), [text, now]);
  const today = toLocalDate(now);
  const mentioned = parsed && circleId === null ? circleMentioned(parsed.title, state.circles) : null;
  const targetCircle = circleId ?? mentioned;
  const targetName = targetCircle ? state.circles.find((circle) => circle.id === targetCircle)?.name ?? null : null;

  const repeat = parsed?.repeat && parsed.date ? normalizeRepeat({ ...parsed.repeat, anchor: parsed.date }) : null;
  // A repeat starts on its first matching day, which may be later than today.
  const firstDate = repeat && parsed?.date ? alignToRepeat(repeat, parsed.date) : parsed?.date ?? null;
  const preview = parsed && (parsed.date || parsed.repeat || mentioned)
    ? [
      parsed.date ? formatWhen(copy, { date: firstDate, time: parsed.time }, today) : null,
      repeat ? describeRepeat(copy, repeat) : null,
      targetName && circleId === null ? targetName : null,
    ].filter(Boolean).join(' · ')
    : null;

  const submit = () => {
    if (!parsed || !parsed.title) return;
    const item = actions.addItem({
      title: parsed.title,
      kind: parsed.kind,
      circleId: targetCircle,
      date: parsed.date,
      time: parsed.time,
      repeat: parsed.repeat,
    });
    setText('');
    nimiToast.show({
      tone: 'success',
      message: item.date ? copy.capture.addedWhen(item.title, formatWhen(copy, item, today)) : copy.capture.added(item.title),
      durationMs: 4000,
      action: { label: copy.common.edit, onClick: () => ui.openItem(item.id) },
    });
  };

  return (
    <div data-testid="nd-quick-capture">
      <div className="nd-capture">
        <TextField
          value={text}
          placeholder={copy.capture.placeholder}
          aria-label={copy.capture.placeholder}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
          }}
          className="flex-1"
          leading={<Plus size={16} aria-hidden="true" />}
        />
        <Button tone="primary" size="md" disabled={!parsed?.title} onClick={submit}>{copy.capture.add}</Button>
      </div>
      <div className="nd-capture-preview nd-split">
        <span>{preview ?? copy.capture.hint}</span>
        {parsed?.title ? (
          <button
            type="button"
            className="nd-link"
            onClick={() => {
              ui.newItem({
                title: parsed.title,
                kind: parsed.kind,
                circleId: targetCircle,
                date: parsed.date,
                time: parsed.time,
                repeat: parsed.repeat,
              });
              setText('');
            }}
          >
            {copy.capture.more}
          </button>
        ) : null}
      </div>
    </div>
  );
}
