import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { DatePicker, Dialog, DialogContent } from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)) as unknown as typeof globalThis.requestAnimationFrame;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flush(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function panel(): HTMLElement | null {
  return document.querySelector('.nimi-date-picker-panel');
}

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await flush();
  });
}

async function openPanel(input: HTMLInputElement) {
  await act(async () => { input.click(); });
  // Observe the real two-frame transition instead of assuming a loaded CI host
  // will run both animation frames within a fixed 60 ms sleep.
  await vi.waitFor(async () => {
    await act(async () => { await flush(20); });
    expect(panel()?.style.opacity).toBe('1');
  }, { timeout: 1000 });
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

test('minDate bounds all date wheels without rewriting an existing past field value', async () => {
  const onValueChange = vi.fn();
  await mount(<DatePicker value="2024-01-15" minDate="2024-02-29" maxDate="2025-12-31" onValueChange={onValueChange} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);
  const options = (label: string) => Array.from(panel()!.querySelectorAll(`[aria-label="${label}"] [aria-selected]`)).map((el) => el.textContent);
  expect(input.value).toBe('2024/01/15');
  expect(onValueChange).not.toHaveBeenCalled();
  expect(options('年份')).toEqual(['2024', '2025']);
  expect(options('月份')[0]).toBe('02');
  expect(options('日期')).toEqual(['29']);
  const month = Array.from(panel()!.querySelectorAll('[aria-label="月份"] [aria-selected]')).find((el) => el.textContent === '03') as HTMLElement;
  await act(async () => { month.click(); });
  expect(options('日期')[0]).toBe('01');
  expect(options('日期').at(-1)).toBe('31');
  const february = Array.from(panel()!.querySelectorAll('[aria-label="月份"] [aria-selected]')).find((el) => el.textContent === '02') as HTMLElement;
  await act(async () => { february.click(); });
  const confirm = Array.from(panel()!.querySelectorAll('button')).find((el) => el.textContent === '确定')!;
  await act(async () => { confirm.click(); });
  expect(onValueChange).toHaveBeenCalledWith('2024-02-29');
});

test('today shortcut and confirmation stay inside a future lower bound', async () => {
  const onValueChange = vi.fn();
  await mount(<DatePicker value="" minDate="2090-12-31" maxDate="2090-12-31" onValueChange={onValueChange} />);
  await openPanel(container?.querySelector('input') as HTMLInputElement);
  const today = Array.from(panel()!.querySelectorAll('button')).find((el) => el.textContent === '今天')!;
  await act(async () => { today.click(); });
  const confirm = Array.from(panel()!.querySelectorAll('button')).find((el) => el.textContent === '确定')!;
  await act(async () => { confirm.click(); });
  expect(onValueChange).toHaveBeenCalledWith('2090-12-31');
});

test('Escape closes the open panel and returns focus to the trigger input', async () => {
  await mount(<DatePicker value="2024-05-20" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  expect(input.className).toContain('focus:ring-[length:var(--nimi-focus-ring-width)]');
  expect(input.className).toContain('focus:ring-[var(--nimi-focus-ring-color)]');

  await openPanel(input);
  expect(panel()?.className).toContain('z-[var(--nimi-z-popover)]');

  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
  });
  expect(panel()?.style.opacity).toBe('0');
  expect(document.activeElement).toBe(input);
});

test('labels overrides panel and field copy while omitted keys keep Chinese defaults', async () => {
  await mount(
    <DatePicker
      value="2024-05-20"
      allowClear
      onChange={() => undefined}
      labels={{ panelTitle: 'Pick a date', confirmButton: 'OK', clearValueAriaLabel: 'Reset date' }}
    />,
  );
  expect(container?.querySelector('[aria-label="Reset date"]')).not.toBeNull();

  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);
  const panelEl = panel() as HTMLElement;
  expect(panelEl.textContent).toContain('Pick a date');
  expect(panelEl.textContent).toContain('OK');
  expect(panelEl.textContent).not.toContain('确定');
  // Omitted keys keep the built-in Chinese defaults.
  expect(panelEl.textContent).toContain('年');
  expect(panelEl.textContent).toContain('今天');
  expect(panelEl.querySelector('[aria-label="年份"]')).not.toBeNull();
  expect(panelEl.querySelector('[aria-label="月份"]')).not.toBeNull();
  expect(panelEl.querySelector('[aria-label="日期"]')).not.toBeNull();
});

test('close via confirm or outside mousedown returns focus to the trigger input', async () => {
  const onChange = vi.fn();
  await mount(<DatePicker value="2024-05-20" onChange={onChange} />);
  const input = container?.querySelector('input') as HTMLInputElement;

  await openPanel(input);
  const confirm = Array.from(panel()?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === '确定',
  ) as HTMLButtonElement;
  await act(async () => {
    confirm.click();
    await flush();
  });
  expect(onChange).toHaveBeenCalledWith('2024-05-20');
  expect(panel()?.style.opacity).toBe('0');
  expect(document.activeElement).toBe(input);

  await openPanel(input);
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flush();
  });
  expect(panel()?.style.opacity).toBe('0');
  expect(document.activeElement).toBe(input);
});

test('onValueChange is preferred over the deprecated onChange alias', async () => {
  const onValueChange = vi.fn();
  const onChange = vi.fn();
  await mount(<DatePicker value="2024-05-20" onValueChange={onValueChange} onChange={onChange} />);
  const input = container?.querySelector('input') as HTMLInputElement;

  await openPanel(input);
  const confirm = Array.from(panel()?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === '确定',
  ) as HTMLButtonElement;
  await act(async () => {
    confirm.click();
    await flush();
  });
  expect(onValueChange).toHaveBeenCalledWith('2024-05-20');
  expect(onChange).not.toHaveBeenCalled();
});

test('legacy onChange alias still receives committed values', async () => {
  const onChange = vi.fn();
  await mount(<DatePicker value="2024-05-20" onChange={onChange} />);
  const input = container?.querySelector('input') as HTMLInputElement;

  await openPanel(input);
  const confirm = Array.from(panel()?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === '确定',
  ) as HTMLButtonElement;
  await act(async () => {
    confirm.click();
    await flush();
  });
  expect(onChange).toHaveBeenCalledWith('2024-05-20');
});

test('wheel scrolling is handled by a non-passive listener so preventDefault works', async () => {
  await mount(<DatePicker value="2024-05-20" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);

  const columns = panel()?.querySelectorAll('.nimi-date-picker-scroll') ?? [];
  expect(columns.length).toBe(3);
  for (const column of columns) {
    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    column.dispatchEvent(event);
    // A passive listener would leave defaultPrevented false and the browser
    // would scroll natively on top of the component's own row stepping.
    expect(event.defaultPrevented).toBe(true);
  }
});

test('contentLayer="dialog" raises the portalled panel above dialog overlays', async () => {
  await mount(<DatePicker value="2024-05-20" contentLayer="dialog" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);
  expect(panel()?.className).toContain('z-[calc(var(--nimi-z-dialog)+1)]');
  expect(panel()?.className).not.toContain('z-[var(--nimi-z-popover)]');
});

test('an empty value opens the panel on today even with a future maxDate', async () => {
  await mount(<DatePicker value="" maxDate="2099-12-31" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);

  const now = new Date();
  const expected = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  expect(panel()?.querySelector('.font-mono')?.textContent).toBe(expected);
});

test('Escape closes the panel without reaching document bubble listeners', async () => {
  await mount(<DatePicker value="2024-05-20" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);

  // A containing modal overlay listens for Escape on document bubble; the
  // panel's capture-phase close must stop the event from ever reaching it.
  const outerKeydown = vi.fn();
  document.addEventListener('keydown', outerKeydown);
  try {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    expect(outerKeydown).not.toHaveBeenCalled();
    expect(panel()?.style.opacity).toBe('0');
  } finally {
    document.removeEventListener('keydown', outerKeydown);
  }
});

test('pointerdown inside the panel does not reach document listeners', async () => {
  await mount(<DatePicker value="2024-05-20" onChange={() => undefined} />);
  const input = container?.querySelector('input') as HTMLInputElement;
  await openPanel(input);

  // A containing modal overlay closes on pointerdown outside its content;
  // panel presses belong to this component and must not look "outside".
  const outerPointerDown = vi.fn();
  document.addEventListener('pointerdown', outerPointerDown);
  try {
    await act(async () => {
      panel()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      await flush();
    });
    expect(outerPointerDown).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener('pointerdown', outerPointerDown);
  }
});

test('inside a modal Dialog the panel layers above it and Escape/pointer stay contained', async () => {
  const onOpenChange = vi.fn();
  await mount(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DatePicker value="2024-05-20" contentLayer="dialog" onChange={() => undefined} />
      </DialogContent>
    </Dialog>,
  );
  // A modal Radix dialog neutralizes the rest of the document.
  expect(document.body.style.pointerEvents).toBe('none');

  // The kit Dialog portals its content to document.body, outside `container`.
  const input = document.querySelector('[role="dialog"] input, .nimi-overlay-panel input') as HTMLInputElement;
  await openPanel(input);
  const panelEl = panel() as HTMLElement;
  expect(panelEl.className).toContain('z-[calc(var(--nimi-z-dialog)+1)]');
  // The panel re-enables its own hit-testing against the modal body rule.
  expect(panelEl.style.pointerEvents).toBe('auto');

  // A press inside the panel must not look like an outside press to the dialog.
  await act(async () => {
    panelEl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await flush();
  });
  expect(onOpenChange).not.toHaveBeenCalled();

  // Escape closes the panel but not the containing dialog.
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
  });
  expect(panelEl.style.opacity).toBe('0');
  expect(onOpenChange).not.toHaveBeenCalled();
});

test('legacy size aliases normal/small normalize onto the md/sm layouts', async () => {
  await mount(
    <div>
      <DatePicker value="2024-05-20" onChange={() => undefined} size="small" placeholder="legacy-small" />
      <DatePicker value="2024-05-20" onChange={() => undefined} size="sm" placeholder="new-sm" />
      <DatePicker value="2024-05-20" onChange={() => undefined} size="normal" placeholder="legacy-normal" />
      <DatePicker value="2024-05-20" onChange={() => undefined} size="md" placeholder="new-md" />
    </div>,
  );

  const inputOf = (placeholder: string) =>
    container?.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(inputOf('legacy-small').className).toContain('pl-2.5');
  expect(inputOf('new-sm').className).toContain('pl-2.5');
  expect(inputOf('legacy-normal').className).toContain('pl-3');
  expect(inputOf('new-md').className).toContain('pl-3');
  expect(inputOf('new-md').className).toContain('text-[length:var(--nimi-type-body-size)]');
});
