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

test('ChatGPT plan usage limit points to usage management instead of a generic rate limit', () => {
  // App carriers deliver only the reason code; the committed route names the plan.
  const carried = { reasonCode: 'AI_PROVIDER_RATE_LIMITED', actionHint: 'refresh_local_app_runtime_projection', message: 'rate limited' };
  const projected = toChatUserFacingRuntimeError(carried, 'Nimi Chat could not complete this request.', i18n.t, { chatGPTPlanRoute: true });
  assert.equal(projected.code, 'AI_PROVIDER_RATE_LIMITED');
  assert.equal(projected.chatGPTPlanUsageLimited, true);
  assert.match(projected.message, /ChatGPT plan has reached its usage limit/u);

  const hinted = toChatUserFacingRuntimeError(
    { reasonCode: 'AI_PROVIDER_RATE_LIMITED', actionHint: 'manage_chatgpt_plan_usage', message: 'ChatGPT plan request failed' },
    'Agent response failed',
    i18n.t,
  );
  assert.equal(hinted.chatGPTPlanUsageLimited, true);

  const otherRoute = toChatUserFacingRuntimeError(carried, 'Nimi Chat could not complete this request.', i18n.t, { chatGPTPlanRoute: false });
  assert.equal(otherRoute.chatGPTPlanUsageLimited, undefined);
  assert.doesNotMatch(otherRoute.message, /ChatGPT/u);
});

test('Ended ChatGPT sign-in asks for explicit sign-in again', () => {
  for (const reasonCode of ['AI_CONNECTOR_CREDENTIAL_MISSING', 'ai-connector-credential-missing']) {
    const projected = toChatUserFacingRuntimeError(
      { reasonCode, message: 'credential missing' },
      'Nimi Chat could not complete this request.',
      i18n.t,
      { chatGPTPlanRoute: true },
    );
    assert.equal(projected.chatGPTPlanUsageLimited, undefined);
    assert.match(projected.message, /Sign in to ChatGPT again in Cloud Services/u, reasonCode);
  }
  const apiKeyRoute = toChatUserFacingRuntimeError(
    { reasonCode: 'AI_CONNECTOR_CREDENTIAL_MISSING', message: 'credential missing' },
    'Nimi Chat could not complete this request.',
    i18n.t,
  );
  assert.doesNotMatch(apiKeyRoute.message, /ChatGPT/u);
});

test('A ChatGPT plan model the account does not offer asks for another model', () => {
  const projected = toChatUserFacingRuntimeError(
    { reasonCode: 'AI_MODEL_NOT_FOUND', message: 'ai-model-not-found' },
    'Nimi Chat could not complete this request.',
    i18n.t,
    { chatGPTPlanRoute: true },
  );
  assert.equal(projected.code, 'AI_MODEL_NOT_FOUND');
  assert.match(projected.message, /doesn't offer the selected model/u);
});
