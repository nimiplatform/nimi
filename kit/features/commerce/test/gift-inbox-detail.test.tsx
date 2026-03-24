import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GiftInboxDetail } from '../src/ui.js';

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

describe('GiftInboxDetail', () => {
  it('renders pending receiver actions and wires callbacks', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onRejectReasonChange = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <GiftInboxDetail
          gift={{
            id: 'gift-1',
            sparkCost: 20,
            gemToReceiver: 5,
            status: 'PENDING',
            createdAt: '2026-03-24T10:00:00.000Z',
            message: 'welcome',
            gift: { name: 'Rose', emoji: '🌹' },
            sender: { displayName: 'Alex' },
            receiver: { displayName: 'Taylor' },
          }}
          status="PENDING"
          isReceiver
          rejectReason=""
          pendingAction={null}
          onRejectReasonChange={onRejectReasonChange}
          onAccept={onAccept}
          onReject={onReject}
          onOpenWallet={() => {}}
          formatDate={(value) => String(value || '--')}
          getPartyDisplayName={(party) => String(party?.displayName || 'Unknown')}
          getStatusLabel={(status) => status}
          sparkAmountLabel={(amount) => `${amount} Spark`}
          gemAmountLabel={(amount) => `${amount} Gem`}
        />,
      );
      await flush();
    });

    expect(document.body.textContent).toContain('Rose');
    expect(document.body.textContent).toContain('Respond to this gift');

    const textarea = document.body.querySelector('textarea');
    expect(textarea).toBeTruthy();

    await act(async () => {
      if (textarea instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        descriptor?.set?.call(textarea, 'later');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await flush();
    });

    expect(onRejectReasonChange).toHaveBeenCalledWith('later');

    await act(async () => {
      const buttons = Array.from(document.body.querySelectorAll('button'));
      buttons.find((button) => button.textContent?.includes('Accept'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons.find((button) => button.textContent?.includes('Reject'))?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onAccept).toHaveBeenCalled();
    expect(onReject).toHaveBeenCalled();
  });
});
