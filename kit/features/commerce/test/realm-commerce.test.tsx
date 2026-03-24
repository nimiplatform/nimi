import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRealmCommerceGiftAdapter,
  loadRealmGiftTransaction,
  useRealmGiftInbox,
  type RealmCommerceGiftService,
} from '../src/realm.js';

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
  service,
}: {
  service: RealmCommerceGiftService;
}) {
  const state = useRealmGiftInbox({
    service,
    currentUserId: 'user-1',
    selectedGiftTransactionId: 'gift-2',
  });

  return (
    <div>
      <div data-testid="count">{state.items.length}</div>
      <div data-testid="selected">{state.selectedGift?.id || ''}</div>
      <div data-testid="status">{state.selectedGiftStatus}</div>
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

describe('commerce realm helpers', () => {
  it('normalizes gift catalog through the realm adapter', async () => {
    const adapter = createRealmCommerceGiftAdapter({
      service: {
        listGiftCatalog: async () => ({
          items: [
            { id: 'rose', name: 'Rose', emoji: '🌹', sparkCost: 10 },
            { id: 'invalid', name: 'Invalid' },
          ],
        }),
        sendGift: async () => {},
        listReceivedGifts: async () => ({ items: [], nextCursor: '' }),
        listSentGifts: async () => ({ items: [], nextCursor: '' }),
        acceptGift: async () => {},
        rejectGift: async () => {},
      } as unknown as RealmCommerceGiftService,
    });

    await expect(adapter.listGiftCatalog()).resolves.toEqual([
      { id: 'rose', name: 'Rose', emoji: '🌹', iconUrl: null, sparkCost: 10 },
    ]);
  });

  it('loads gift detail by searching received then sent feeds', async () => {
    const service = {
      listGiftCatalog: async () => ({ items: [] }),
      sendGift: async () => {},
      listReceivedGifts: async () => ({
        items: [{ id: 'gift-1', sparkCost: 10, status: 'PENDING' }],
        nextCursor: '',
      }),
      listSentGifts: async () => ({
        items: [{
          id: 'gift-2',
          sparkCost: 20,
          gemToReceiver: 5,
          status: 'ACCEPTED',
          sender: { id: 'user-1', displayName: 'Taylor' },
          receiver: { id: 'user-2', displayName: 'Alex' },
        }],
        nextCursor: '',
      }),
      acceptGift: async () => {},
      rejectGift: async () => {},
    } as unknown as RealmCommerceGiftService;

    await expect(loadRealmGiftTransaction('gift-2', service)).resolves.toMatchObject({
      id: 'gift-2',
      status: 'ACCEPTED',
      sparkCost: 20,
    });
  });

  it('binds runtime inbox service into the headless inbox hook', async () => {
    const acceptGift = vi.fn(async () => {});
    const service = {
      listGiftCatalog: async () => ({ items: [] }),
      sendGift: async () => {},
      listReceivedGifts: async () => ({
        items: [{
          id: 'gift-1',
          sparkCost: 10,
          status: 'PENDING',
          sender: { displayName: 'Alex' },
          receiver: { id: 'user-1', displayName: 'Taylor' },
        }],
        nextCursor: '',
      }),
      listSentGifts: async () => ({
        items: [{
          id: 'gift-2',
          sparkCost: 20,
          gemToReceiver: 5,
          status: 'PENDING',
          sender: { displayName: 'Alex' },
          receiver: { id: 'user-1', displayName: 'Taylor' },
        }],
        nextCursor: '',
      }),
      acceptGift,
      rejectGift: async () => {},
    } as unknown as RealmCommerceGiftService;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness service={service} />);
      await flush();
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('gift-2');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('PENDING');

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(acceptGift).toHaveBeenCalledWith('gift-2');
  });
});
