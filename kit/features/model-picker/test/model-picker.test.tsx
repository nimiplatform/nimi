import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPickerDialog } from '../src/components/model-picker-dialog.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe('public Model Picker contract', () => {
  it('loads owner candidates without auto-selecting or mutating until explicit confirmation', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ModelPickerDialog
          open
          title="Choose target"
          adapter={{
            listCandidates: async () => [
              { id: 'a', label: 'Model A', provider: 'provider-a' },
              { id: 'b', label: 'Model B', provider: 'provider-b' },
            ],
            getId: (candidate) => candidate.id,
            getTitle: (candidate) => candidate.label,
            getSource: (candidate) => candidate.provider,
          }}
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
      await Promise.resolve();
    });
    await flush();

    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use selection') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();

    const candidate = Array.from(document.body.querySelectorAll('[data-nimi-model-picker="true"] button'))
      .find((button) => button.textContent?.includes('Model B')) as HTMLButtonElement;
    expect(candidate.className).toContain('focus-visible:ring');
    act(() => { candidate.click(); });
    expect(confirm.disabled).toBe(false);
    await act(async () => { confirm.click(); await Promise.resolve(); });

    expect(onConfirm).toHaveBeenCalledWith({ id: 'b', label: 'Model B', provider: 'provider-b' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps declared routes visible and prevents a hidden-route selection from being confirmed', async () => {
    const onConfirm = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ModelPickerDialog
          open
          presentation="route"
          title="Choose model"
          selectedId="local-model"
          initialSourceFilter="local"
          sourceOptions={['local', 'cloud']}
          adapter={{
            listCandidates: async () => [{ id: 'local-model', label: 'Local Model', source: 'local' }],
            getId: (candidate) => candidate.id,
            getTitle: (candidate) => candidate.label,
            getSource: (candidate) => candidate.source,
          }}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      await Promise.resolve();
    });
    await flush();

    const cloud = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'cloud') as HTMLButtonElement;
    expect(cloud).toBeTruthy();
    act(() => { cloud.click(); });

    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use selection') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('exposes focus ring and aria-pressed selection state on route candidates', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ModelPickerDialog
          open
          presentation="route"
          title="Choose model"
          initialSourceFilter="local"
          sourceOptions={['local', 'cloud']}
          adapter={{
            listCandidates: async () => [
              { id: 'a', label: 'Model A', source: 'local' },
              { id: 'b', label: 'Model B', source: 'local' },
            ],
            getId: (candidate) => candidate.id,
            getTitle: (candidate) => candidate.label,
            getSource: (candidate) => candidate.source,
          }}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    await flush();

    const localTab = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'local') as HTMLButtonElement;
    expect(localTab.className).toContain('focus-visible:ring');

    const tabGroup = document.body.querySelector('[role="radiogroup"]');
    expect(tabGroup).toBeTruthy();
    expect(localTab.getAttribute('role')).toBe('radio');
    expect(localTab.getAttribute('aria-checked')).toBe('true');

    const rowA = document.body.querySelector('[data-nimi-model-picker-candidate="a"]') as HTMLButtonElement;
    const rowB = document.body.querySelector('[data-nimi-model-picker-candidate="b"]') as HTMLButtonElement;
    expect(rowA.className).toContain('focus-visible:ring');
    expect(rowA.getAttribute('aria-pressed')).toBe('false');
    expect(rowB.getAttribute('aria-pressed')).toBe('false');

    act(() => { rowB.click(); });
    expect(rowB.getAttribute('aria-pressed')).toBe('true');
    expect(rowA.getAttribute('aria-pressed')).toBe('false');
  });
});
