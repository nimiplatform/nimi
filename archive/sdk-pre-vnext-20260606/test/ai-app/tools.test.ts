import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAppAiToolRegistry,
  defineAppAiTool,
} from '../../src/ai-app/index.js';

test('app AI tool registry selects registered MingSim-shaped tools explicitly', () => {
  const registry = createAppAiToolRegistry([
    defineAppAiTool({
      name: 'view_state',
      description: 'Read the current simulation state.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => ({ dynasty: 'Ming', treasury: 42 }),
    }),
    defineAppAiTool({
      name: 'submit_report',
      description: 'Submit the visible turn report.',
      stopAfterCall: true,
      showResult: true,
      execute: () => ({ accepted: true }),
    }),
    defineAppAiTool({
      name: 'propose_directive',
      description: 'Propose a state-changing directive for human approval.',
      requiresApproval: true,
      execute: () => ({ directiveId: 'directive-1' }),
    }),
  ]);

  assert.deepEqual(registry.select({ include: ['view_state', 'submit_report'] }).map((tool) => tool.name), [
    'view_state',
    'submit_report',
  ]);
  assert.deepEqual(registry.select({ exclude: ['submit_report'] }).map((tool) => tool.name), [
    'view_state',
    'propose_directive',
  ]);
  assert.throws(() => registry.select({ include: ['missing_tool'] }), /not registered/);
});

test('app AI tool execution fails closed for approval and external execution boundaries', async () => {
  const registry = createAppAiToolRegistry([
    defineAppAiTool({
      name: 'propose_directive',
      description: 'Propose a state-changing directive for human approval.',
      requiresApproval: true,
      showResult: true,
      execute: (args) => ({ args, directiveId: 'directive-1' }),
    }),
    defineAppAiTool({
      name: 'external_world_tick',
      description: 'Request a domain runtime to advance the simulation tick.',
      externalExecutionRequired: true,
      stopAfterCall: true,
    }),
  ]);

  const pending = await registry.execute({
    toolName: 'propose_directive',
    args: { taxRate: 0.08 },
    callId: 'call-approval',
  });
  assert.equal(pending.ok, false);
  if (pending.ok) {
    throw new Error('expected approval-required failure');
  }
  assert.equal(pending.reason, 'approval-required');
  assert.equal(pending.requiresApproval, true);
  assert.equal(pending.showResult, true);

  const approved = await registry.execute({
    toolName: 'propose_directive',
    approved: true,
    args: { taxRate: 0.08 },
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) {
    throw new Error(approved.message);
  }
  assert.deepEqual(approved.result, { args: { taxRate: 0.08 }, directiveId: 'directive-1' });

  const external = await registry.execute({ toolName: 'external_world_tick' });
  assert.equal(external.ok, false);
  if (external.ok) {
    throw new Error('expected external execution failure');
  }
  assert.equal(external.reason, 'external-execution-required');
  assert.equal(external.externalExecutionRequired, true);
  assert.equal(external.stopAfterCall, true);
});

test('app AI tool execution returns typed failure for missing executors and thrown errors', async () => {
  const registry = createAppAiToolRegistry([
    defineAppAiTool({
      name: 'missing_executor',
      description: 'Registered descriptor without local executor.',
    }),
    defineAppAiTool({
      name: 'broken_tool',
      description: 'Throws during execution.',
      execute: () => {
        throw new Error('boom');
      },
    }),
  ]);

  const missingExecutor = await registry.execute({ toolName: 'missing_executor' });
  assert.equal(missingExecutor.ok, false);
  if (missingExecutor.ok) {
    throw new Error('expected executor-missing failure');
  }
  assert.equal(missingExecutor.reason, 'executor-missing');

  const broken = await registry.execute({ toolName: 'broken_tool' });
  assert.equal(broken.ok, false);
  if (broken.ok) {
    throw new Error('expected tool-failed failure');
  }
  assert.equal(broken.reason, 'tool-failed');
  assert.match(broken.message, /boom/);

  const absent = await registry.execute({ toolName: 'absent_tool' });
  assert.equal(absent.ok, false);
  if (absent.ok) {
    throw new Error('expected tool-not-found failure');
  }
  assert.equal(absent.reason, 'tool-not-found');
});
