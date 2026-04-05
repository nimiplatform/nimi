import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error node --test resolves the source file directly with its TypeScript extension.
import { routeFeedback } from '../src/shell/renderer/features/feedback/feedback-router.ts';

test('feedback router keeps fatal failures global and persistent state in strips', () => {
  assert.equal(routeFeedback({ intent: 'fatal_error', trigger: 'bootstrap' }), 'global_banner');
  assert.equal(routeFeedback({ intent: 'persistent_state', trigger: 'passive_state' }), 'top_strip');
});

test('feedback router silences passive/background success noise', () => {
  assert.equal(routeFeedback({ intent: 'background_event', trigger: 'background' }), 'silent');
  assert.equal(routeFeedback({ intent: 'contextual_success', trigger: 'passive_state' }), 'silent');
});

test('feedback router keeps contextual actions inline by default', () => {
  assert.equal(routeFeedback({ intent: 'contextual_error', trigger: 'user_action' }), 'page_inline');
  assert.equal(routeFeedback({ intent: 'contextual_success', trigger: 'user_action' }), 'control_inline');
  assert.equal(routeFeedback({ intent: 'long_task_status', trigger: 'background' }), 'job_toast');
});
