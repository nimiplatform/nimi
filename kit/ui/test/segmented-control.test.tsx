import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { SegmentedControl, type SegmentedControlItem } from '../src/components/segmented-control.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(element: React.ReactElement) {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(element));
}

function radio(label: string): HTMLButtonElement {
  const button = [...container!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(item => item.textContent === label);
  expect(button).toBeDefined();
  return button!;
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => document.activeElement!.dispatchEvent(event));
  return event;
}

function expectSelection(label: string) {
  expect(document.activeElement).toBe(radio(label));
  expect(radio(label).getAttribute('aria-checked')).toBe('true');
  const stops = [...container!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(button => button.tabIndex === 0);
  expect(stops).toEqual([radio(label)]);
}

test('radio arrows select and focus enabled options, wrap, and support Home/End', async () => {
  const changed = vi.fn();
  function Controlled() {
    const [value, setValue] = useState('all');
    return <SegmentedControl ariaLabel="Connections" value={value} onValueChange={next => { changed(next); setValue(next); }} items={[
      { value: 'all', label: 'All' },
      { value: 'disabled', label: 'Disabled', disabled: true },
      { value: 'attention', label: 'Attention' },
      { value: 'unchecked', label: 'Unchecked' },
    ]} />;
  }
  await render(<Controlled />);
  expect(changed).not.toHaveBeenCalled();
  radio('All').focus();
  expectSelection('All');
  expect(radio('Disabled').tabIndex).toBe(-1);

  expect((await press('ArrowRight')).defaultPrevented).toBe(true);
  expectSelection('Attention');
  await press('ArrowDown'); expectSelection('Unchecked');
  await press('ArrowRight'); expectSelection('All');
  await press('ArrowLeft'); expectSelection('Unchecked');
  await press('ArrowUp'); expectSelection('Attention');
  await press('Home'); expectSelection('All');
  await press('End'); expectSelection('Unchecked');
  expect(changed.mock.calls.map(([value]) => value)).toEqual(['attention', 'unchecked', 'all', 'unchecked', 'attention', 'all', 'unchecked']);
  expect((await press('Tab')).defaultPrevented).toBe(false);
  expect((await press('ArrowLeft', { altKey: true })).defaultPrevented).toBe(false);
  expectSelection('Unchecked');
});

test('an unselected or disabled current value leaves the first enabled radio reachable without selecting it', async () => {
  const changed = vi.fn();
  const items: SegmentedControlItem[] = [
    { value: 'disabled', label: 'Disabled', disabled: true },
    { value: 'first', label: 'First' },
    { value: 'last', label: 'Last' },
  ];
  await render(<SegmentedControl ariaLabel="Window" value="missing" onValueChange={changed} items={items} />);
  expect(radio('First').tabIndex).toBe(0);
  expect(container!.querySelector('[aria-checked="true"]')).toBeNull();
  radio('First').focus();
  expect((await press(' ')).defaultPrevented).toBe(true);
  expect(changed).toHaveBeenCalledExactlyOnceWith('first');
  expect(container!.querySelector('[aria-checked="true"]')).toBeNull();

  changed.mockClear();
  await render(<SegmentedControl ariaLabel="Window" value="disabled" onValueChange={changed} items={items} />);
  expect(radio('First').tabIndex).toBe(0);
  expect(radio('Disabled').tabIndex).toBe(-1);
  expect(changed).not.toHaveBeenCalled();
  await render(<SegmentedControl ariaLabel="Window" value="last" onValueChange={changed} items={items} />);
  expect(radio('Last').tabIndex).toBe(0);
  expect(radio('First').tabIndex).toBe(-1);
  expect(changed).not.toHaveBeenCalled();
});

test('controlled values remain authoritative and disabled or sole choices do not create keyboard changes', async () => {
  const changed = vi.fn();
  const items = [{ value: 'first', label: 'First' }, { value: 'last', label: 'Last' }];
  await render(<SegmentedControl ariaLabel="Window" value="first" onValueChange={changed} items={items} />);
  radio('First').focus();
  await press('ArrowRight');
  expect(document.activeElement).toBe(radio('Last'));
  expect(changed).toHaveBeenCalledExactlyOnceWith('last');
  expect(radio('First').getAttribute('aria-checked')).toBe('true');
  expect(radio('Last').getAttribute('aria-checked')).toBe('false');

  changed.mockClear();
  await render(<SegmentedControl ariaLabel="Window" value="first" onValueChange={changed} items={items.map(item => ({ ...item, disabled: item.value === 'last' }))} />);
  radio('First').focus();
  await press('ArrowRight'); await press('Home'); await press('End'); await press(' ');
  await act(async () => radio('Last').click());
  expectSelection('First');
  expect(changed).not.toHaveBeenCalled();
  await render(<SegmentedControl ariaLabel="Window" value="first" onValueChange={changed} items={items.map(item => ({ ...item, disabled: true }))} />);
  expect([...container!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].every(button => button.tabIndex === -1)).toBe(true);
});
