import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDismissFloatingMenu } from '../src/shell/renderer/features/chat/chat-floating-menu.js';

test('shouldDismissFloatingMenu keeps the menu open when the pointer lands inside the menu', () => {
  const insideTarget = { id: 'inside' };
  const container = {
    contains(target: unknown) {
      return target === insideTarget;
    },
  } as unknown as { contains: (target: Node | null) => boolean };

  assert.equal(shouldDismissFloatingMenu({
    container,
    target: insideTarget as unknown as EventTarget,
  }), false);
});

test('shouldDismissFloatingMenu dismisses when the pointer lands outside or target is missing', () => {
  const container = {
    contains(target: unknown) {
      return target === 'inside';
    },
  } as unknown as { contains: (target: Node | null) => boolean };

  assert.equal(shouldDismissFloatingMenu({
    container,
    target: 'outside' as unknown as EventTarget,
  }), true);
  assert.equal(shouldDismissFloatingMenu({
    container,
    target: null,
  }), true);
});
