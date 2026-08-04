import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDesktopNimiTextCapabilityRequest } from '../src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.js';

test('Nimi Chat execution request carries CapabilityContract intent without App target authority', () => {
  const built = buildDesktopNimiTextCapabilityRequest({
    runtime: { ai: {} as never },
    appId: 'nimi.desktop',
    prompt: 'Hello Runtime',
    subjectUserId: 'account-1',
  });
  const request = {
    appId: built.appId,
    capabilityId: built.capabilityId,
    prompt: built.prompt,
    scenarioId: built.scenarioId,
    subjectUserId: built.subjectUserId,
    surfaceId: built.surfaceId,
  };

  assert.deepEqual(request, {
    appId: 'nimi.desktop',
    capabilityId: 'text.generate',
    prompt: 'Hello Runtime',
    scenarioId: 'desktop-nimi-chat',
    subjectUserId: 'account-1',
    surfaceId: 'desktop.chat.nimi',
  });
  assert.doesNotMatch(
    JSON.stringify(request),
    /model|binding|target|implementation|readiness|fallback|llama/i,
  );
});
