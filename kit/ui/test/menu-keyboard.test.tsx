import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ActionMenu } from '../src/components/menu.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('ActionMenu keyboard interaction', () => {
  it('focuses enabled actions, navigates, and closes without executing disabled actions', async () => {
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const select = vi.fn(); const close = vi.fn();
    await act(async () => root.render(<ActionMenu ariaLabel="Actions" onRequestClose={close} items={[
      { id: 'copy', label: 'Copy', onSelect: select }, { id: 'quote', label: 'Quote', disabled: true, disabledReason: 'Still streaming', onSelect: select }, { id: 'play', label: 'Play', onSelect: select },
    ]} />));
    const buttons = container.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    buttons[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1]!.click(); expect(select).not.toHaveBeenCalled();
    buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(close).toHaveBeenCalledWith('escape');
    await act(async () => root.unmount()); container.remove();
  });
});
