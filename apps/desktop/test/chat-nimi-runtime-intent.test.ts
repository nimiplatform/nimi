import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDesktopNimiTextCapabilityRequest } from '../src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.js';

test('Nimi Chat execution request carries CapabilityContract intent without App target authority', () => {
  const built = buildDesktopNimiTextCapabilityRequest({
    client: { ai: {} as never },
    prompt: 'Hello Runtime',
  });
  assert.deepEqual(built, {
    messages: [{ role: 'user', text: 'Hello Runtime' }],
  });
  assert.doesNotMatch(
    JSON.stringify(built),
    /model|binding|target|implementation|readiness|fallback|llama/i,
  );
});
