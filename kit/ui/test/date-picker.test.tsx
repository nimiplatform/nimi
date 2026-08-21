import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { DatePicker } from '../src/index.js';

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
  await act(async () => {
    input.click();
    // openPanel defers through two requestAnimationFrame ticks.
    await flush(60);
  });
  expect(panel()?.style.opacity).toBe('1');
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
