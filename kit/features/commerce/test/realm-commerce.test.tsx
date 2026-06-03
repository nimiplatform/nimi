import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRealmCommerceGiftAdapter,
  createRealmSparkCheckout,
  loadRealmCurrencyBalances,
  loadRealmGiftTransaction,
  loadRealmSparkPackages,
  normalizeRealmCurrencyBalances,
  useRealmGiftInbox,
  type RealmCommerceGiftService,
} from '../src/realm.js';
import {
  normalizeCommerceGiftCatalog,
  resolveSelectedGiftId,
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
  it('normalizes currency balances through the realm adapter', async () => {
    expect(normalizeRealmCurrencyBalances({
      sparkBalance: '42',
      gemBalance: '7',
    })).toEqual({
      sparkBalance: 42,
      gemBalance: 7,
    });

    await expect(loadRealmCurrencyBalances({
      getBalances: async () => ({
        sparkBalance: '5',
        gemBalance: '3',
      }),
    })).resolves.toEqual({
      sparkBalance: 5,
      gemBalance: 3,
    });
  });

  it('normalizes gift catalog through the realm adapter', async () => {
    const adapter = createRealmCommerceGiftAdapter({
      service: {
        getBalances: async () => ({ sparkBalance: '0', gemBalance: '0' }),
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

  it('normalizes gift catalog item payloads and selection fallback', () => {
    expect(normalizeCommerceGiftCatalog([
      { id: 'rose', name: 'Rose', sparkCost: '25', emoji: '🌹' },
      { id: 'coffee', sparkCost: 10 },
    ])).toEqual([
      { id: 'rose', name: 'Rose', sparkCost: 25, emoji: '🌹', iconUrl: null },
      { id: 'coffee', name: 'coffee', sparkCost: 10, emoji: '🎁', iconUrl: null },
    ]);
    expect(normalizeCommerceGiftCatalog({
      items: [{ id: 'rocket', name: 'Rocket', sparkCost: '100', iconUrl: 'https://nimi.test/rocket.png' }],
    })).toEqual([{
      id: 'rocket',
      name: 'Rocket',
      sparkCost: 100,
      emoji: '🎁',
      iconUrl: 'https://nimi.test/rocket.png',
    }]);

    const items = normalizeCommerceGiftCatalog([
      { id: '', name: 'Invalid', sparkCost: '25' },
      { id: 'missing-cost', name: 'Invalid' },
      { id: 'good', name: 'Valid', sparkCost: '12.5', emoji: '🎁' },
    ]);
    expect(items).toEqual([
      { id: 'good', name: 'Valid', sparkCost: 12.5, emoji: '🎁', iconUrl: null },
    ]);
    expect(resolveSelectedGiftId(items, 'missing')).toBe('good');
    expect(resolveSelectedGiftId([], 'good')).toBe('');
  });

  it('calls Spark recharge APIs through the realm helper surface', async () => {
    const capturedCalls: string[] = [];
    const service = {
      listSparkPackages: async () => {
        capturedCalls.push('list-packages');
        return [{ id: 'pkg-1', label: 'Starter', sparkAmount: 100, usdPrice: 1.99, popular: true }];
      },
      createSparkCheckout: async (input: Record<string, unknown>) => {
        capturedCalls.push(`checkout:${String(input.packageId || '')}`);
        return { sessionId: 'session-1', url: 'https://checkout.nimi.example/session-1' };
      },
    } as unknown as RealmCommerceGiftService;

    await expect(loadRealmSparkPackages(service)).resolves.toEqual([
      { id: 'pkg-1', label: 'Starter', sparkAmount: 100, usdPrice: 1.99, popular: true },
    ]);
    await expect(createRealmSparkCheckout({ packageId: 'pkg-1' } as never, service)).resolves.toEqual({
      sessionId: 'session-1',
      url: 'https://checkout.nimi.example/session-1',
    });
    expect(capturedCalls).toEqual(['list-packages', 'checkout:pkg-1']);
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
