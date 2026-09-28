import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeLocale,
  i18n,
  initI18n,
} from '../src/shell/renderer/i18n/index.js';
import { toChatUserFacingRuntimeError } from '../src/shell/renderer/features/chat/chat-runtime-error-message.js';

test.before(async () => {
  await initI18n();
  await changeLocale('en');
});

test('Agent Chat does not parse internal capacity text into product truth', () => {
  const internal = new Error(
    'context_capacity_exceeded: required=13820 available=2304 required_window=15612 current_window=4096 blocking_lane=source_identity',
  );
  const error = new Error('Agent response failed', { cause: internal });

  const projected = toChatUserFacingRuntimeError(error, 'Agent response failed', i18n.t);
  assert.equal(projected.message, 'Runtime call failed.');
  assert.doesNotMatch(projected.message, /required=|available=|source_identity/u);
});

test('Agent busy gives a bounded retry explanation without business detail', () => {
  const projected = toChatUserFacingRuntimeError({ reasonCode: 'AGENT_BUSY', message: 'private business material' }, 'Agent response failed', i18n.t);
  assert.match(projected.message, /input is saved.*try sending again/u);
  assert.doesNotMatch(projected.message, /private business material/u);
});

test('Nimi Chat explains a stale saved model instead of showing its raw reason code', () => {
  const projected = toChatUserFacingRuntimeError(
    { reasonCode: 'AI_REMOTE_MODEL_CATALOG_STALE', message: 'AI_REMOTE_MODEL_CATALOG_STALE' },
    'Nimi Chat could not complete this request.',
    i18n.t,
  );
  assert.match(projected.message, /Choose it again in AI Capabilities/u);
  assert.doesNotMatch(projected.message, /AI_REMOTE_MODEL_CATALOG_STALE/u);
});
