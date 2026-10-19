// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TimeField, timeFieldLabels } from '../src/nimiday/ui/time-field.js';
import { copyFor } from '../src/nimiday/i18n/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps native keyboard time editing and rejects edits before the allowed minute', async () => {
  const changed = vi.fn();
  function Field() {
    const [value, setValue] = useState('14:31');
    return <TimeField value={value} minTime="14:31" aria-label="Time"
      labels={timeFieldLabels(copyFor('en'), 'Time')}
      onValueChange={next => { changed(next); setValue(next); }} />;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Field />); });
    const input = container.querySelector('input')!;
    expect(input.type).toBe('time');
    expect(input.readOnly).toBe(false);
    expect(input.min).toBe('14:31');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const edit = async (value: string) => act(async () => {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await edit('14:30');
    expect(changed).not.toHaveBeenCalled();
    await edit('15:05');
    expect(changed).toHaveBeenLastCalledWith('15:05');
    expect(input.value).toBe('15:05');
    await edit('');
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
