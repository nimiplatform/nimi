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
  assert.match(projected.message, /draft is saved.*try sending again/u);
  assert.doesNotMatch(projected.message, /private business material/u);
});

test('local configuration and unsupported behavior failures explain the next action', async () => {
  await changeLocale('zh');
  try {
    for (const reasonCode of ['AI_LOCAL_CONFIGURATION_NOT_CONFIGURED', 'ai-local-configuration-not-configured', 'AI_TEXT_BEHAVIOR_UNSUPPORTED']) {
      const projected = toChatUserFacingRuntimeError({ reasonCode, message: reasonCode }, 'Agent response failed', i18n.t);
      assert.match(projected.message, /AI 能力/u);
      assert.doesNotMatch(projected.message, /AI_LOCAL_|AI_TEXT_|ai-local-/u);
    }
  } finally { await changeLocale('en'); }
});

test('Nimi Chat explains a stale saved model instead of showing its raw reason code', () => {
  const projected = toChatUserFacingRuntimeError(
    { reasonCode: 'AI_REMOTE_MODEL_CATALOG_STALE', message: 'AI_REMOTE_MODEL_CATALOG_STALE' },
    'Nimi Chat could not complete this request.',
    i18n.t,
  );
  assert.match(projected.message, /Select it again in AI Capabilities/u);
  assert.doesNotMatch(projected.message, /AI_REMOTE_MODEL_CATALOG_STALE/u);
});

test('provider request and credential failures give localized recovery without raw payload', async () => {
  try {
    for (const locale of ['en', 'zh'] as const) {
      await changeLocale(locale);
      for (const reasonCode of ['AI_INPUT_INVALID', 'AI_PROVIDER_AUTH_FAILED']) {
        const projected = toChatUserFacingRuntimeError(
          { reasonCode, message: 'private provider payload secret=test' },
          'Request failed',
          i18n.t,
        );
        assert.equal(projected.code, reasonCode);
        assert.doesNotMatch(projected.message, /AI_INPUT_INVALID|AI_PROVIDER_AUTH_FAILED|private provider|secret=/u);
        assert.match(projected.message, locale === 'zh' ? /请/ : /Check|Update/u);
      }
    }
  } finally { await changeLocale('en'); }
});

test('ChatGPT plan usage limit points to usage management instead of a generic rate limit', () => {
  // App carriers deliver only the reason code; the committed route names the plan.
  const carried = { reasonCode: 'AI_PROVIDER_RATE_LIMITED', actionHint: 'retry_later', message: 'rate limited' };
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


test('LocalAgent configuration errors name the integration and point to Agent Center', () => {
 for (const reasonCode of ['AI_TEXT_BEHAVIOR_UNSUPPORTED','AI_CONFIG_INVALID','AI_LOCAL_CONFIGURATION_NOT_CONFIGURED','AI_REMOTE_MODEL_CATALOG_STALE']) {
  const result=toChatUserFacingRuntimeError({reasonCode,message:'private prompt'},'failed',i18n.t,{localAgent:true});
  assert.match(result.message,/Agent Center/);
  assert.doesNotMatch(result.message,/model does not support|AI Capabilities|private prompt/);
 }
});

test('uncertain immediate cloud outcomes disclose unknown result and possible provider charges', () => {
  const fromInterruption = toChatUserFacingRuntimeError(
    {
      reasonCode: 'AI_PROVIDER_TIMEOUT',
      message: 'request timed out',
      interruption: {
        cause: 'unspecified',
        resubmitDisposition: 'outcome-uncertain',
      },
    },
    'Nimi Chat could not complete this request.',
    i18n.t,
  );
  assert.equal(fromInterruption.code, 'AI_PROVIDER_TIMEOUT');
  assert.match(fromInterruption.message, /outcome is unknown/i);
  assert.match(fromInterruption.message, /charges may already have accrued/i);
  assert.match(fromInterruption.message, /additional charges/i);

  const fromActionHint = toChatUserFacingRuntimeError(
    {
      reasonCode: 'AI_EXECUTION_INTERRUPTED',
      actionHint: 'confirm_outcome_and_charges_before_new_request',
      message: 'Execution interrupted',
    },
    'Agent response failed',
    i18n.t,
  );
  assert.match(fromActionHint.message, /outcome is unknown/i);
  assert.match(fromActionHint.message, /charges may already have accrued/i);
  assert.match(fromActionHint.message, /additional charges/i);

  const fromLocalPremature = toChatUserFacingRuntimeError(
    {
      reasonCode: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
      actionHint: 'confirm_local_execution_before_new_request',
      message: 'Nimi stream ended without done evidence.',
      details: { route: 'local', outcomeStatus: 'unknown' },
    },
    'Nimi Chat could not complete this request.',
    i18n.t,
  );
  assert.equal(fromLocalPremature.code, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
  assert.doesNotMatch(fromLocalPremature.message, /cloud|charges|bill/i);
  assert.match(fromLocalPremature.message, /do not assume local execution has already stopped/i);
});
