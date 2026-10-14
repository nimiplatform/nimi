import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createNimiNavigation } from '@nimiplatform/kit/core/navigation';
import { NimiAppChrome } from '../src/app-chrome/chrome.js';
import { NimiMenubar } from '../src/app-chrome/menubar.js';
import { createNimiChromeEditingOwner } from '../src/app-chrome/editing.js';
import { TooltipProvider } from '../src/components/tooltip.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../src/components/dialog.js';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<TooltipProvider>{element}</TooltipProvider>));
}
const key = async (target: Element, value: string, options: KeyboardEventInit = {}) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options })); });
const click = async (target: Element) => act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label)!;

it('updates command ordering and grouping on rerender and visibly projects checked state', async () => {
  const render = (changed: boolean) => <NimiAppChrome metadata={{ name: 'Test', version: '1' }} commands={[
    { id: 'test.first', label: 'First', menu: 'file', order: changed ? 90 : 10, group: changed ? 'other' : 'same', state: () => ({ enabled: true, visible: true, checked: changed }), execute() {} },
    { id: 'test.second', label: 'Second', menu: 'file', order: 20, group: 'same', state: () => ({ enabled: true, visible: true }), execute() {} },
  ]} />;
  await mount(render(false));
  await click(button('File'));
  const items = () => [...document.querySelectorAll('[role="menu"] [data-nimi-command-id]')];
  expect(items().map(item => item.getAttribute('data-nimi-command-id'))).toEqual(['test.first', 'test.second']);
  expect(document.querySelector('[role="separator"]')).toBeNull();
  expect(items()[0].textContent).not.toContain('✓');
  await act(async () => root!.render(<TooltipProvider>{render(true)}</TooltipProvider>));
  expect(items().map(item => item.getAttribute('data-nimi-command-id'))).toEqual(['test.second', 'test.first']);
  expect(document.querySelector('[role="separator"]')).not.toBeNull();
  expect(items()[1].getAttribute('aria-checked')).toBe('true');
  expect(items()[1].textContent).toContain('✓');
});

it('Alt navigation works as a full press sequence from body and menu focus; Alt alone activates the menu', async () => {
  const navigation = createNimiNavigation({ initial: { id: 'a' }, validate: value => value as { id: string } });
  await navigation.push({ id: 'b' });
  await mount(<NimiAppChrome metadata={{ name: 'Test', version: '1' }} navigation={navigation} commands={[
    { id: 'test.file', label: 'File action', menu: 'file', state: () => ({ enabled: true, visible: true }), execute() {} },
    { id: 'test.edit', label: 'Edit action', menu: 'edit', state: () => ({ enabled: true, visible: true }), execute() {} },
  ]} />);
  const sequence = async (arrow: string) => {
    await key(document.activeElement ?? document.body, 'Alt', { altKey: true });
    await key(document.activeElement ?? document.body, arrow, { altKey: true });
    await act(async () => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true })); });
  };
  await sequence('ArrowLeft'); expect(navigation.getSnapshot().current.destination.id).toBe('a');
  button('File').focus(); await sequence('ArrowRight'); expect(navigation.getSnapshot().current.destination.id).toBe('b');
  await key(document.body, 'Alt', { altKey: true });
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true })); });
  expect(document.activeElement).toBe(button('File'));
  await key(button('File'), 'ArrowRight'); expect(document.activeElement).toBe(button('Edit'));
});

it('uses the same history for toolbar, menu and renderer shortcuts, and hides absent sidebar controls', async () => {
  const navigation = createNimiNavigation({ initial: { id: 'home' }, validate: value => value as { id: string } });
  await navigation.push({ id: 'detail' });
  await mount(<NimiAppChrome metadata={{ name: 'Test', version: '1' }} navigation={navigation} />);
  expect(button('Back').disabled).toBe(false);
  expect(button('Show sidebar')).toBeUndefined();
  await click(button('Back'));
  expect(navigation.getSnapshot().current.destination.id).toBe('home');
  await key(document.body, 'ArrowRight', { altKey: true });
  expect(navigation.getSnapshot().current.destination.id).toBe('detail');
  await click(button('View'));
  await click(document.querySelector('[role="menu"] [data-nimi-command-id="nimi.navigation.back"]')!);
  expect(navigation.getSnapshot().current.destination.id).toBe('home');
  await click(button('Help')); await click(button('Keyboard shortcuts'));
  expect(document.body.textContent).not.toContain('Ctrl+B');
});

it('keeps a writable editor out of navigation/fold shortcuts and restores focus before a rail is hidden', async () => {
  const navigation = createNimiNavigation({ initial: { id: 'home' }, validate: value => value as { id: string } });
  await navigation.push({ id: 'detail' }); let visible = true; let focusedAtFold = '';
  await mount(<><NimiAppChrome metadata={{ name: 'Test', version: '1' }} navigation={navigation}
    sidebar={{ visible, onVisibleChange(value) { visible = value; focusedAtFold = document.activeElement?.getAttribute('aria-label') ?? ''; } }} /><input aria-label="Draft" /></>);
  const input = document.querySelector('input')!;
  await act(async () => input.focus());
  await key(input, 'ArrowLeft', { altKey: true }); await key(input, 'b', { ctrlKey: true });
  expect(navigation.getSnapshot().current.destination.id).toBe('detail'); expect(visible).toBe(true);
  await click(button('Hide sidebar')); expect(visible).toBe(false); expect(focusedAtFold).toBe('Hide sidebar');
});

it('supports roving top focus, skips disabled items and returns focus on Escape', async () => {
  await mount(<NimiMenubar locale="en" compact={false} onExecute={() => undefined} onCaptureSelection={() => undefined} onRestoreEditFocus={() => undefined} commands={[
    { id: 'app.disabled', label: 'Disabled', menu: 'view', state: { enabled: false, visible: true } },
    { id: 'app.first', label: 'First', menu: 'view', state: { enabled: true, visible: true } },
    { id: 'app.last', label: 'Last', menu: 'view', state: { enabled: true, visible: true } },
    { id: 'app.help', label: 'About', menu: 'help', state: { enabled: true, visible: true } },
  ]} />);
  await act(async () => button('View').focus()); await key(button('View'), 'ArrowRight');
  expect(document.activeElement).toBe(button('Help'));
  await key(button('Help'), 'ArrowLeft'); await key(button('View'), 'ArrowDown');
  expect(document.activeElement).toBe(button('First'));
  await key(button('First'), 'ArrowDown'); expect(document.activeElement).toBe(button('Last'));
  await key(button('Last'), 'Escape'); expect(document.activeElement).toBe(button('View'));
  expect(button('View').getAttribute('aria-expanded')).toBe('false');
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  for (const shiftKey of [false, true]) {
    await key(button('View'), 'ArrowDown');
    await key(button('First'), 'Tab', { shiftKey });
    expect(button('View').getAttribute('aria-expanded')).toBe('false');
  }
});

it('switches open menus on hover without opening idle menus or restoring the outgoing trigger focus', async () => {
  const capture = vi.fn();
  await mount(<NimiMenubar locale="en" compact={false} onExecute={() => undefined} onCaptureSelection={capture} onRestoreEditFocus={() => undefined} commands={[
    { id: 'app.edit', label: 'Edit action', menu: 'edit', state: { enabled: true, visible: true } },
    { id: 'app.view', label: 'View action', menu: 'view', state: { enabled: true, visible: true } },
    { id: 'app.help', label: 'Help action', menu: 'help', state: { enabled: true, visible: true } },
  ]} />);
  const hover = async (label: string, pointerType = 'mouse') => act(async () => {
    const event = new MouseEvent('pointerover', { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    button(label).dispatchEvent(event);
  });
  await hover('View'); expect(button('View').getAttribute('aria-expanded')).toBe('false');
  await click(button('Edit'));
  await hover('View', 'touch'); expect(button('Edit').getAttribute('aria-expanded')).toBe('true');
  await hover('View');
  expect(button('Edit').getAttribute('aria-expanded')).toBe('false');
  expect(button('View').getAttribute('aria-expanded')).toBe('true');
  await vi.waitFor(() => expect(document.querySelector('[role="menu"][aria-label="Edit"]')).toBeNull());
  expect(document.activeElement).toBe(button('View action'));
  await hover('Help'); await hover('Edit');
  await vi.waitFor(() => expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1));
  expect(document.activeElement).toBe(button('Edit action'));
  expect(capture).toHaveBeenCalledTimes(1);
  await key(button('Edit action'), 'Escape');
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  expect(document.activeElement).toBe(button('Edit'));
  await hover('View'); expect(button('View').getAttribute('aria-expanded')).toBe('false');
});

it('restores readonly input/document selections for copy and rejects stale/hidden targets', () => {
  document.body.innerHTML = '<input readonly value="Read only result"><div id="output">Selected result</div><button role="menuitem">Copy</button>';
  const input = document.querySelector('input')!; input.focus(); input.setSelectionRange(0, 4);
  const owner = createNimiChromeEditingOwner(document); owner.capture();
  document.querySelector('button')!.focus(); owner.restore('copy');
  expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(4); expect(owner.canExecute('cut')).toBe(false); expect(owner.canExecute('paste')).toBe(false);
  input.blur(); const output = document.querySelector('#output')!; const range = document.createRange(); range.selectNodeContents(output);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); owner.capture(); document.querySelector('button')!.focus();
  owner.restore('copy'); expect(document.getSelection()!.toString()).toBe('Selected result'); expect(owner.canExecute('paste')).toBe(false);
  output.remove(); expect(() => owner.restore('copy')).toThrow('no longer available');
});

it('opens compact submenus with ArrowRight and returns to their parent with ArrowLeft', async () => {
  const executed: string[] = [];
  await mount(<NimiMenubar locale="en" compact onExecute={id => executed.push(id)} onCaptureSelection={() => undefined} onRestoreEditFocus={() => undefined} commands={[
    { id: 'app.open', label: 'Open', menu: 'file', state: { enabled: true, visible: true } },
    { id: 'app.help', label: 'About', menu: 'help', state: { enabled: true, visible: true } },
  ]} />);
  await click(button('Menu')); await key(button('File'), 'ArrowRight');
  expect(document.activeElement).toBe(button('Open'));
  await key(button('Open'), 'ArrowLeft'); expect(document.activeElement).toBe(button('File'));
  await key(button('File'), 'ArrowRight'); await click(button('Open')); expect(executed).toEqual(['app.open']);
  expect(button('Menu').getAttribute('aria-expanded')).toBe('false');
  await click(button('Menu')); await key(button('File'), 'ArrowRight'); await key(button('Open'), 'Tab', { shiftKey: true });
  expect(button('Menu').getAttribute('aria-expanded')).toBe('false');
});

it('orders panel items by explicit order and separates only differing groups', async () => {
  await mount(<NimiMenubar locale="en" compact={false} onExecute={() => undefined} onCaptureSelection={() => undefined} onRestoreEditFocus={() => undefined} commands={[
    { id: 'app.late', label: 'Late', menu: 'view', order: 80, group: 'product', state: { enabled: true, visible: true } },
    { id: 'app.first', label: 'First', menu: 'view', order: 10, group: 'learn', state: { enabled: true, visible: true } },
    { id: 'app.second', label: 'Second', menu: 'view', order: 11, group: 'learn', state: { enabled: true, visible: true } },
    { id: 'app.alpha', label: 'Alpha', menu: 'file', state: { enabled: true, visible: true } },
    { id: 'app.beta', label: 'Beta', menu: 'file', state: { enabled: true, visible: true } },
  ]} />);
  await click(button('View'));
  const viewMenu = document.querySelector('[role="menu"]')!;
  expect([...viewMenu.querySelectorAll('[role="menuitem"]')].map(element => element.textContent)).toEqual(['First', 'Second', 'Late']);
  expect(viewMenu.querySelectorAll('[role="separator"]')).toHaveLength(1);
  await key(document.activeElement ?? document.body, 'Escape');
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  await click(button('File'));
  const fileMenu = document.querySelector('[role="menu"]')!;
  expect([...fileMenu.querySelectorAll('[role="menuitem"]')].map(element => element.textContent)).toEqual(['Alpha', 'Beta']);
  expect(fileMenu.querySelectorAll('[role="separator"]')).toHaveLength(0);
});

it.each([
  { compact: false, shiftKey: false }, { compact: false, shiftKey: true },
  { compact: true, shiftKey: false }, { compact: true, shiftKey: true },
])('Tab exits the menubar with compact=$compact, shift=$shiftKey, including portalled submenus', async ({ compact, shiftKey }) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 30 } as DOMRect);
  await mount(<><button>Before menu</button><NimiMenubar locale="en" compact={compact}
    onExecute={() => undefined} onCaptureSelection={() => undefined} onRestoreEditFocus={() => undefined}
    commands={[{ id: 'app.help', label: 'About', menu: 'help', state: { enabled: true, visible: true } }]} />
    <button disabled>Disabled after menu</button><span data-radix-focus-guard tabIndex={0} /><button>After menu</button></>);
  const trigger = button(compact ? 'Menu' : 'Help');
  await act(async () => trigger.focus()); await key(trigger, 'ArrowDown');
  if (compact) await key(button('Help'), 'ArrowRight');
  expect(document.activeElement).toBe(button('About'));
  await key(button('About'), 'Tab', { shiftKey });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button(shiftKey ? 'Before menu' : 'After menu'));
  // Closing either the outer or nested portal must not restore its trigger.
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  expect(document.activeElement).toBe(button(shiftKey ? 'Before menu' : 'After menu'));
});

it('returns focus to the connected Help trigger after closing a keyboard-opened help dialog', async () => {
  await mount(<NimiAppChrome metadata={{ name: 'Test', version: '1' }} />);
  await act(async () => button('Help').focus()); await key(button('Help'), 'ArrowDown');
  await click(button('Keyboard shortcuts'));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click(button('Close'));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(button('Help')));
});

it.each([false, true])('preserves Help dialog return focus and the original Edit selection with compact=%s', async compact => {
  const editing = createNimiChromeEditingOwner(document);
  const restoreEditFocus = vi.fn(() => editing.restore('copy'));
  function MenuDialog() {
    const [open, setOpen] = useState(false);
    return <><input aria-label="Draft" defaultValue="Original draft" /><NimiMenubar locale="en" compact={compact}
      onCaptureSelection={() => editing.capture()} onRestoreEditFocus={restoreEditFocus}
      onExecute={id => { if (id === 'nimi.edit.copy') editing.restore('copy'); else setOpen(true); }} commands={[
        { id: 'nimi.edit.copy', label: 'Copy', menu: 'edit', state: { enabled: true, visible: true } },
        { id: 'app.help', label: 'About', menu: 'help', state: { enabled: true, visible: true } },
      ]} /><Dialog open={open} onOpenChange={setOpen}><DialogContent onClose={() => setOpen(false)}>
        <DialogTitle>About app</DialogTitle><DialogDescription>Actual metadata</DialogDescription>
        <button onClick={() => setOpen(false)}>Close</button>
      </DialogContent></Dialog></>;
  }
  await mount(<MenuDialog />);
  await click(button(compact ? 'Menu' : 'Help'));
  if (compact) await key(button('Help'), 'ArrowRight');
  await click(button('About'));
  await key(document.querySelector('[role="dialog"]')!, 'Escape');
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await vi.waitFor(() => expect(document.activeElement).toBe(button(compact ? 'Menu' : 'Help')));
  const input = document.querySelector('input')!;
  await act(async () => { input.focus(); input.setSelectionRange(2, 8); });
  await click(button(compact ? 'Menu' : 'Edit'));
  if (compact) await key(button('Edit'), 'ArrowRight');
  await click(button('Copy'));
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  // Radix restores focus after removing the portal. Wait for both closing
  // scopes in compact mode before asserting focus or unmounting the editor.
  await vi.waitFor(() => expect(restoreEditFocus).toHaveBeenCalledTimes(compact ? 2 : 1));
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);
  expect(input.value).toBe('Original draft');
});

it('keeps the default arrow cursor on chrome controls and menu triggers', async () => {
  const navigation = createNimiNavigation({ initial: { id: 'a' }, validate: value => value as { id: string } });
  await navigation.push({ id: 'b' });
  await mount(<NimiAppChrome metadata={{ name: 'Test', version: '1' }} navigation={navigation}
    sidebar={{ visible: true, onVisibleChange() {} }} />);
  expect(button('Back').style.cursor).toBe('default');
  expect(button('Forward').style.cursor).toBe('default');
  expect(button('Hide sidebar').style.cursor).toBe('default');
  // A disabled chrome control is hover-wrapped by its tooltip; the wrapper is
  // the actual hover surface and must keep the same arrow cursor.
  const wrapper = document.querySelector('span[role="button"][aria-label="Forward"]');
  expect(wrapper).not.toBeNull();
  expect((wrapper as HTMLElement).style.cursor).toBe('default');
  for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-nimi-menu-trigger]')) {
    expect(trigger.style.cursor).toBe('default');
  }
});
