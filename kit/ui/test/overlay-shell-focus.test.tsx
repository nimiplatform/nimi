import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { OverlayShell } from '../src/components/dialog.js';
import { Popover, PopoverContent, PopoverTrigger } from '../src/components/popover.js';
import { SelectField } from '../src/components/select.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

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

test('exiting OverlayShell immediately yields pointer-events so background clicks succeed mid-exit', async () => {
  let backgroundClicks = 0;
  function ExitClickJourney() {
    const [open, setOpen] = useState(true);
    return <>
      <button type="button" data-testid="bg-action" onClick={() => { backgroundClicks += 1; }}>Background Action</button>
      <OverlayShell
        open={open}
        title="Quick settings"
        onClose={() => setOpen(false)}
        data-testid="exit-overlay"
        footer={<button type="button" data-testid="done-btn" onClick={() => setOpen(false)}>Done</button>}
      >
        <p>Body</p>
      </OverlayShell>
    </>;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ExitClickJourney />));

  const backdropBefore = document.querySelector<HTMLElement>('.nimi-overlay-backdrop')!;
  const panelBefore = document.querySelector<HTMLElement>('[data-testid="exit-overlay"]')!;
  expect(backdropBefore.style.pointerEvents).toBe('auto');
  expect(panelBefore.style.pointerEvents).not.toBe('none');

  const doneBtn = document.querySelector<HTMLButtonElement>('[data-testid="done-btn"]')!;
  await act(async () => doneBtn.click());

  // While exit animation is still running (or immediately after closing), neither backdrop
  // nor panel nor document.body may intercept pointer input.
  const backdropDuringExit = document.querySelector<HTMLElement>('.nimi-overlay-backdrop');
  const panelDuringExit = document.querySelector<HTMLElement>('[data-testid="exit-overlay"]');
  if (backdropDuringExit) {
    expect(backdropDuringExit.style.pointerEvents).toBe('none');
    expect(backdropDuringExit.className).toContain('pointer-events-none');
  }
  if (panelDuringExit) {
    expect(panelDuringExit.style.pointerEvents).toBe('none');
    expect(panelDuringExit.getAttribute('aria-hidden')).toBe('true');
  }
  expect(document.body.style.pointerEvents).not.toBe('none');

  const bgButton = container.querySelector<HTMLButtonElement>('[data-testid="bg-action"]')!;
  await act(async () => bgButton.click());
  expect(backgroundClicks).toBe(1);
});

test('closing SelectField immediately releases document.body pointer-events while exit ghost finishes', async () => {
  let bgClicks = 0;
  function SelectExitJourney() {
    const [open, setOpen] = useState(true);
    return <>
      <button type="button" data-testid="select-bg-action" onClick={() => { bgClicks += 1; }}>Background</button>
      <SelectField
        open={open}
        onOpenChange={setOpen}
        value="a"
        aria-label="Route"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />
      <button type="button" data-testid="close-select" onClick={() => setOpen(false)}>Close Select</button>
    </>;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<SelectExitJourney />));
  expect(document.querySelector('[role="listbox"]')).toBeTruthy();

  const closeBtn = container.querySelector<HTMLButtonElement>('[data-testid="close-select"]')!;
  await act(async () => closeBtn.click());

  // Immediately after closing, body pointer-events must NOT stay locked to 'none',
  // and any visual exit ghost must be inert & pointer-events: none.
  expect(document.body.style.pointerEvents).not.toBe('none');
  const ghost = document.querySelector<HTMLElement>('[data-nimi-overlay-exit-ghost="true"]');
  if (ghost) {
    expect(ghost.style.pointerEvents).toBe('none');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.hasAttribute('inert')).toBe(true);
  }
  const bgBtn = container.querySelector<HTMLButtonElement>('[data-testid="select-bg-action"]')!;
  await act(async () => bgBtn.click());
  expect(bgClicks).toBe(1);
});

test('closing modal Popover immediately releases document.body pointer-events while exit ghost finishes', async () => {
  let bgClicks = 0;
  function ModalPopoverExitJourney() {
    const [open, setOpen] = useState(true);
    return <>
      <button type="button" data-testid="popover-bg-action" onClick={() => { bgClicks += 1; }}>Usage Tab</button>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <button type="button" data-testid="popover-trigger">Cloud Services</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" data-testid="popover-close" onClick={() => setOpen(false)}>Select Provider</button>
        </PopoverContent>
      </Popover>
    </>;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<ModalPopoverExitJourney />));
  expect(document.querySelector('[data-testid="popover-close"]')).toBeTruthy();

  const closeBtn = document.querySelector<HTMLButtonElement>('[data-testid="popover-close"]')!;
  await act(async () => closeBtn.click());

  expect(document.body.style.pointerEvents).not.toBe('none');
  const ghost = document.querySelector<HTMLElement>('[data-nimi-overlay-exit-ghost="true"]');
  if (ghost) {
    expect(ghost.style.pointerEvents).toBe('none');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.hasAttribute('inert')).toBe(true);
  }
  const bgBtn = container.querySelector<HTMLButtonElement>('[data-testid="popover-bg-action"]')!;
  await act(async () => bgBtn.click());
  expect(bgClicks).toBe(1);
});

test('OverlayShell header close button is opt-in, accessible, and calls onClose once', async () => {
  function CloseButtonJourney() {
    const [open, setOpen] = useState(false);
    const [closeCount, setCloseCount] = useState(0);
    return <>
      <button type="button" data-testid="open-closable" onClick={() => setOpen(true)}>Open</button>
      <output data-testid="close-button-count">{closeCount}</output>
      <OverlayShell
        open={open}
        title="Model route"
        closeLabel="关闭"
        onClose={() => {
          setCloseCount((count) => count + 1);
          setOpen(false);
        }}
        data-testid="closable-overlay"
      >
        <p>Body</p>
      </OverlayShell>
    </>;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<CloseButtonJourney />));

  const trigger = container.querySelector<HTMLButtonElement>('[data-testid="open-closable"]')!;
  trigger.focus();
  await act(async () => trigger.click());

  const closeBtn = document.querySelector<HTMLButtonElement>('[data-testid="nimi-overlay-close"]')!;
  expect(closeBtn).toBeTruthy();
  expect(closeBtn.getAttribute('aria-label')).toBe('关闭');

  await act(async () => closeBtn.click());
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[data-testid="closable-overlay"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  expect(container.querySelector('[data-testid="close-button-count"]')?.textContent).toBe('1');
});

test('OverlayShell omits close button by default and when onClose is absent', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(
    <>
      <OverlayShell open title="Default header" onClose={() => {}} data-testid="default-header-overlay">
        <p>Default</p>
      </OverlayShell>
      <OverlayShell open title="Locked header" closeLabel="Close" data-testid="locked-header-overlay">
        <p>Locked</p>
      </OverlayShell>
    </>,
  ));

  expect(document.querySelector('[data-testid="default-header-overlay"] [data-testid="nimi-overlay-close"]')).toBeNull();
  expect(document.querySelector('[data-testid="locked-header-overlay"] [data-testid="nimi-overlay-close"]')).toBeNull();

  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[data-testid="locked-header-overlay"]')).toBeTruthy();
});

test('nested OverlayShell Escape dismisses only the topmost dialog first, then the parent', async () => {
  function NestedOverlayJourney() {
    const [parentOpen, setParentOpen] = useState(true);
    const [childOpen, setChildOpen] = useState(false);
    const [parentCloses, setParentCloses] = useState(0);
    const [childCloses, setChildCloses] = useState(0);
    return (
      <>
        <output data-testid="parent-closes">{parentCloses}</output>
        <output data-testid="child-closes">{childCloses}</output>
        <OverlayShell
          open={parentOpen}
          title="Parent dialog"
          closeLabel="Close"
          onClose={() => {
            setParentCloses((count) => count + 1);
            setParentOpen(false);
          }}
          data-testid="parent-overlay"
        >
          <button type="button" data-testid="open-child" onClick={() => setChildOpen(true)}>
            Open child
          </button>
          <OverlayShell
            open={childOpen}
            title="Child dialog"
            closeLabel="Close"
            className="z-[calc(var(--nimi-z-dialog)+1)]"
            panelClassName="z-[calc(var(--nimi-z-dialog)+1)]"
            onClose={() => {
              setChildCloses((count) => count + 1);
              setChildOpen(false);
            }}
            data-testid="child-overlay"
          >
            <button type="button" data-testid="child-inside">Child action</button>
          </OverlayShell>
        </OverlayShell>
      </>
    );
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<NestedOverlayJourney />));

  const openChild = document.querySelector<HTMLButtonElement>('[data-testid="open-child"]')!;
  await act(async () => openChild.click());
  expect(document.querySelector('[data-testid="child-overlay"]')).toBeTruthy();

  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[data-testid="child-overlay"]')).toBeNull();
  });
  expect(document.querySelector('[data-testid="parent-overlay"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="child-closes"]')?.textContent).toBe('1');
  expect(container.querySelector('[data-testid="parent-closes"]')?.textContent).toBe('0');

  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[data-testid="parent-overlay"]')).toBeNull();
  });
  expect(container.querySelector('[data-testid="parent-closes"]')?.textContent).toBe('1');
});
