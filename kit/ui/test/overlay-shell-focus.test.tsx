import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { OverlayShell } from '../src/components/dialog.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  container?.remove();
  root = null;
  container = null;
});

function FocusJourney({ conditional }: { conditional: boolean }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const overlay = <OverlayShell open={open} title="Add a service" onClose={() => setOpen(false)} data-testid="focus-overlay">
    <input autoFocus aria-label="Find a service" />
    <button type="button" onClick={() => { setOpen(false); setSubmitted(true); }}>Save and continue</button>
  </OverlayShell>;
  return <>
    <button type="button" data-testid="open-overlay" onClick={() => setOpen(true)}>Add service</button>
    {submitted ? <input autoFocus aria-label="Next page" /> : null}
    {conditional ? open && overlay : overlay}
  </>;
}

async function openJourney(conditional: boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<FocusJourney conditional={conditional} />));
  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="open-overlay"]')!;
  trigger.focus();
  await act(async () => trigger.click());
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Find a service"]'));
  return trigger;
}

test.each([false, true])('autoFocus children do not replace the return target when conditional mount is %s', async conditional => {
  const trigger = await openJourney(conditional);
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[data-testid="focus-overlay"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

test('conditional closing preserves the next page focus even when the old trigger remains mounted', async () => {
  const trigger = await openJourney(true);
  const save = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="focus-overlay"] button')].find(button => button.textContent === 'Save and continue')!;
  await act(async () => save.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(trigger.isConnected).toBe(true);
  expect(document.querySelector('[data-testid="focus-overlay"]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Next page"]'));
});
