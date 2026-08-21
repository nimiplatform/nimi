import { act } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSendGiftDialog, type CommerceGiftAdapter } from '../src/headless.js';
import { SendGiftDialog } from '../src/ui.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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
});

function Harness({
  open = true,
  adapter,
}: {
  open?: boolean;
  adapter: CommerceGiftAdapter;
}) {
  const state = useSendGiftDialog({
    open,
    receiverId: 'receiver-1',
    adapter,
  });

  return (
    <SendGiftDialog
      open={open}
      state={state}
      onClose={() => {}}
      recipient={{ id: 'receiver-1', name: 'Alex' }}
    />
  );
}

describe('SendGiftDialog', () => {
  it('loads gift catalog and selects the first gift', async () => {
    const adapter: CommerceGiftAdapter = {
      listGiftCatalog: async () => [
        { id: 'rose', name: 'Rose', emoji: '🌹', iconUrl: null, sparkCost: 10 },
        { id: 'crown', name: 'Crown', emoji: '👑', iconUrl: null, sparkCost: 100 },
      ],
      sendGift: async () => {},
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} />);
      await flush();
      await flush();
    });

    expect(document.body.textContent).toContain('Rose');
    expect(document.body.textContent).toContain('10 SPARK');

    expect(document.body.querySelector('.nimi-overlay-panel--size-s')).toBeTruthy();
    const footer = document.body.querySelector('.nimi-overlay-footer');
    expect(footer?.textContent).toContain('Send Gift');
    expect(document.body.querySelector('button[aria-label="Close"]')).toBeTruthy();

    const giftButton = (label: string) => Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes(label)) as HTMLButtonElement;
    const rose = giftButton('Rose');
    expect(rose.className).toContain('focus-visible:ring');
    expect(rose.getAttribute('aria-pressed')).toBe('true');
    expect(giftButton('Crown').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      giftButton('Crown').click();
      await flush();
    });
    expect(giftButton('Crown').getAttribute('aria-pressed')).toBe('true');
    expect(giftButton('Rose').getAttribute('aria-pressed')).toBe('false');
  });

  it('announces catalog loading and failure states', async () => {
    let rejectCatalog: ((error: Error) => void) | null = null;
    const adapter: CommerceGiftAdapter = {
      listGiftCatalog: () => new Promise((_, reject) => {
        rejectCatalog = reject;
      }),
      sendGift: async () => {},
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} />);
      await flush();
    });

    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('Loading gifts');

    await act(async () => {
      rejectCatalog?.(new Error('Catalog unavailable'));
      await flush();
      await flush();
    });

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Catalog unavailable');
    expect(document.body.querySelector('[role="alert"] button')?.textContent).toContain('Retry');
  });

  it('locks mutable gift fields while a send is pending', async () => {
    let completeSend: (() => void) | null = null;
    const adapter: CommerceGiftAdapter = {
      listGiftCatalog: async () => [
        { id: 'rose', name: 'Rose', emoji: '🌹', iconUrl: null, sparkCost: 10 },
      ],
      sendGift: () => new Promise<void>((resolve) => {
        completeSend = resolve;
      }),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} />);
      await flush();
      await flush();
    });

    await act(async () => {
      const buttons = Array.from(document.body.querySelectorAll('button'));
      buttons[buttons.length - 1]?.click();
      await flush();
    });

    expect((document.body.querySelector('button[aria-pressed]') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((document.body.querySelector('textarea') as HTMLTextAreaElement | null)?.disabled).toBe(true);
    expect((document.body.querySelector('button[aria-label="Close"]') as HTMLButtonElement | null)?.disabled).toBe(true);

    await act(async () => {
      completeSend?.();
      await flush();
      await flush();
    });
  });

  it('announces a send failure', async () => {
    const adapter: CommerceGiftAdapter = {
      listGiftCatalog: async () => [
        { id: 'rose', name: 'Rose', emoji: '🌹', iconUrl: null, sparkCost: 10 },
      ],
      sendGift: async () => {
        throw new Error('Gift could not be sent');
      },
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} />);
      await flush();
      await flush();
    });

    await act(async () => {
      const buttons = Array.from(document.body.querySelectorAll('button'));
      buttons[buttons.length - 1]?.click();
      await flush();
      await flush();
    });

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Gift could not be sent');
  });

  it('submits selected gift and trimmed message through adapter', async () => {
    const sendGift = vi.fn(async () => {});
    const adapter: CommerceGiftAdapter = {
      listGiftCatalog: async () => [
        { id: 'rose', name: 'Rose', emoji: '🌹', iconUrl: null, sparkCost: 10 },
      ],
      sendGift,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} />);
      await flush();
      await flush();
    });

    const textarea = document.body.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea?.getAttribute('aria-label')).toBe('Message (Optional)');
    expect(textarea?.getAttribute('maxlength')).toBe('200');

    await act(async () => {
      if (textarea instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        descriptor?.set?.call(textarea, '  nice gift  ');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await flush();
    });

    await act(async () => {
      const buttons = Array.from(document.body.querySelectorAll('button'));
      buttons[buttons.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(sendGift).toHaveBeenCalledWith({
      receiverId: 'receiver-1',
      giftId: 'rose',
      message: 'nice gift',
    });
  });

});
