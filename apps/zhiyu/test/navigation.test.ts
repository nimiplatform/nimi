import assert from 'node:assert/strict';
import test from 'node:test';
import { createZhiyuNavigation } from '../src/shell/app/navigation.js';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

test('partner and configuration references share one history and explicit unavailable references survive', async () => {
  const navigation = createZhiyuNavigation();
  const agentHandle = 'opaque-partner-a' as NimiLocalAppAgentHandle;
  const partner = { id: 'partner' as const, agentHandle, conversationAnchorId: 'runtime-anchor-a' };
  await navigation.push(partner);
  await navigation.push({ ...partner, panel: 'appearance' });
  await navigation.push({ ...partner, panel: 'behavior' });
  await navigation.back(); assert.equal(navigation.getSnapshot().current.destination.panel, 'appearance');
  await navigation.back(); assert.deepEqual(navigation.getSnapshot().current.destination, partner);
  await navigation.forward(); assert.equal(navigation.getSnapshot().current.destination.conversationAnchorId, 'runtime-anchor-a');
  const entry = navigation.getSnapshot().current;
  assert.equal((await navigation.push({ id: 'partner', draft: 'business text' } as never)).status, 'invalid');
  assert.equal(navigation.getSnapshot().current, entry);
  navigation.reset({ id: 'partner', agentHandle: 'unavailable-reference' as NimiLocalAppAgentHandle });
  assert.equal(navigation.getSnapshot().current.destination.agentHandle, 'unavailable-reference');
  assert.equal(navigation.getSnapshot().canGoBack, false);
  navigation.dispose();
});
