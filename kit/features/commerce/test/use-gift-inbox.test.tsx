import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useGiftInbox,
  type CommerceGiftInboxAdapter,
} from '../src/headless.js';

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
  adapter,
  onActionSuccess,
}: {
  adapter: CommerceGiftInboxAdapter;
  onActionSuccess?: (kind: 'accept' | 'reject') => void | Promise<void>;
}) {
  const state = useGiftInbox({
    adapter,
    currentUserId: 'user-1',
    selectedGiftTransactionId: 'gift-1',
    onActionSuccess,
  });

  return (
    <div>
      <div data-testid="items-count">{state.items.length}</div>
      <div data-testid="selected-status">{state.selectedGiftStatus}</div>
      <div data-testid="is-receiver">{state.isReceiver ? 'yes' : 'no'}</div>
      <textarea
        value={state.rejectReason}
        onChange={(event) => state.setRejectReason(event.target.value)}
      />
      <button type="button" onClick={() => {
        void state.handleAccept();
      }}>
        accept
      </button>
      <button type="button" onClick={() => {
        void state.handleReject();
      }}>
        reject
      </button>
    </div>
  );
}

describe('useGiftInbox', () => {
  it('loads list and detail, then refreshes after accept', async () => {
    let listCall = 0;
    let detailCall = 0;
    const acceptGift = vi.fn(async () => {});
    const onActionSuccess = vi.fn(async () => {});
    const adapter: CommerceGiftInboxAdapter = {
      listReceivedGifts: async () => {
        listCall += 1;
        return [
          {
            id: 'gift-1',
            sparkCost: 20,
            gemToReceiver: 5,
            status: listCall > 1 ? 'ACCEPTED' : 'PENDING',
            sender: { displayName: 'Alex' },
            receiver: { id: 'user-1', displayName: 'Taylor' },
          },
        ];
      },
      getGiftTransaction: async () => {
        detailCall += 1;
        return {
          id: 'gift-1',
          sparkCost: 20,
          gemToReceiver: 5,
          status: detailCall > 1 ? 'ACCEPTED' : 'PENDING',
          sender: { displayName: 'Alex' },
          receiver: { id: 'user-1', displayName: 'Taylor' },
        };
      },
      acceptGift,
      rejectGift: async () => {},
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness adapter={adapter} onActionSuccess={onActionSuccess} />);
      await flush();
      await flush();
    });

    expect(document.querySelector('[data-testid="items-count"]')?.textContent).toBe('1');
    expect(document.querySelector('[data-testid="selected-status"]')?.textContent).toBe('PENDING');
    expect(document.querySelector('[data-testid="is-receiver"]')?.textContent).toBe('yes');

    await act(async () => {
      document.querySelectorAll('button')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(acceptGift).toHaveBeenCalledWith('gift-1');
    expect(onActionSuccess).toHaveBeenCalledWith('accept');
    expect(document.querySelector('[data-testid="selected-status"]')?.textContent).toBe('ACCEPTED');
  });

  it('passes trimmed reject reason to adapter', async () => {
    const rejectGift = vi.fn(async () => {});
    const adapter: CommerceGiftInboxAdapter = {
      listReceivedGifts: async () => [
        {
          id: 'gift-1',
          sparkCost: 20,
          gemToReceiver: 5,
          status: 'PENDING',
          sender: { displayName: 'Alex' },
          receiver: { id: 'user-1', displayName: 'Taylor' },
        },
      ],
      getGiftTransaction: async () => ({
        id: 'gift-1',
        sparkCost: 20,
        gemToReceiver: 5,
        status: 'PENDING',
        sender: { displayName: 'Alex' },
        receiver: { id: 'user-1', displayName: 'Taylor' },
      }),
      acceptGift: async () => {},
      rejectGift,
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
        descriptor?.set?.call(textarea, '  not now  ');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await flush();
    });

    await act(async () => {
      document.querySelectorAll('button')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(rejectGift).toHaveBeenCalledWith('gift-1', {
      reason: 'not now',
    });
  });
});
