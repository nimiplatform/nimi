import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { AssistantEntry, CompactionTask, createRegistry, defineExtension, Harness, hook, MemoryStorage, UserEntry } from '@earendil-works/pi-durable';
import { needsCompaction } from '../dist-electron/request-budget.js';

test('unpatched pi-durable@1.6.0 runs official beforeCompact hook with backgroundTokens=0', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  let beforeCompactCalls = 0;
  registry.install(defineExtension({
    name: 'v21-before-compact-hook',
    hooks: [hook(CompactionTask, {
      beforeCompact: async ({ messages }) => {
        beforeCompactCalls += 1;
        assert.ok(messages.length > 0);
        return {
          summary: 'Earlier exchanges retained. User goal remains the same.',
          usage: { input: 120, output: 24, cacheRead: 0, cacheWrite: 0, totalTokens: 144, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
      },
    })],
  }));
  faux.setResponses([
    async transcript => {
      assert.ok(transcript.messages.length < 96, `expected compacted transcript < 96 msgs, got ${transcript.messages.length}`);
      assert.ok(JSON.stringify(transcript).includes('Earlier exchanges retained.'));
      return fauxAssistantMessage('Continued.');
    },
  ]);
  const harness = await Harness.open(new MemoryStorage(), {
    models,
    registry,
    settings: { compaction: { enabled: true, keepRecentTokens: 0, backgroundTokens: 0, reserveTokens: 200_000 } },
  }, context);
  try {
    const root = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
    const seededMessages = [];
    await root.commit(async tx => {
      for (let index = 0; index < 70; index++) {
        const userMsg = { role: 'user', content: `hi ${index}`, timestamp: 0 };
        const assistantMsg = fauxAssistantMessage('ok');
        seededMessages.push(userMsg, assistantMsg);
        await tx.appendEntry(UserEntry, root.id, { model: [userMsg] });
        await tx.appendEntry(AssistantEntry, root.id, { model: [assistantMsg] });
      }
    }, context);
    assert.equal(needsCompaction(seededMessages), true);
    const compactTaskId = await root.compact(undefined, context);
    const compactResult = await harness.waitForTask(compactTaskId, context);
    assert.equal(compactResult?.state?.outcome?.status, 'completed', JSON.stringify(compactResult));
    assert.equal(beforeCompactCalls, 1);

    const submitted = await root.submit({ type: 'input', content: 'Continue the task.' }, context);
    const settled = await submitted.wait(context);
    assert.equal(settled.status, 'done', JSON.stringify(settled));
  } finally {
    await harness.close(context);
  }
});

test('request byte budgeting counts text while images use Artifact references', () => {
  assert.equal(needsCompaction([{ role: 'user', content: 'x'.repeat(260 * 1024), timestamp: 0 }]), true);
  assert.equal(needsCompaction([{ role: 'user', content: [{ type: 'image', data: 'x'.repeat(2 * 1024 * 1024), mimeType: 'image/png' }], timestamp: 0 }]), false);
});
