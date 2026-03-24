import { act } from 'react';
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
