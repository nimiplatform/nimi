import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

function readRelaySource(...segments: string[]): string {
  return readFileSync(path.join(testDir, '..', 'src', ...segments), 'utf8');
}

describe('relay fallback hardcut regressions', () => {
  it('media execution does not synthesize default image/video mime types', () => {
    const source = readRelaySource('main', 'media', 'media-execution-pipeline.ts');
    assert.ok(!source.includes("mimeType || 'image/png'"));
    assert.ok(!source.includes("mimeType || 'video/mp4'"));
  });

  it('send flow does not synthesize marker override intents for explicit-media turns', () => {
    const source = readRelaySource('main', 'chat-pipeline', 'send-flow.ts');
    assert.ok(!source.includes('fallbackMediaBeatId'));
    assert.ok(!source.includes('synthesizing marker override'));
    assert.ok(!source.includes('plannerConfidence: 0.74'));
  });

  it('ipc handlers do not swallow send-flow import failures or fall back to direct SDK streaming', () => {
    const source = readRelaySource('main', 'ipc-handlers.ts');
    assert.ok(!source.includes("import('./chat-pipeline/send-flow.js').catch(() => null)"));
    assert.ok(!source.includes('Fallback: direct SDK streaming'));
    assert.ok(!source.includes("const sendFlowModule = await import('./chat-pipeline/send-flow.js').catch(() => null);"));
  });

  it('agent pickers do not expose manual agent-id fallback when realm is unreachable', () => {
    const selectorSource = readRelaySource('renderer', 'features', 'agent', 'components', 'agent-selector.tsx');
    const popoverSource = readRelaySource('renderer', 'features', 'agent', 'components', 'agent-picker-popover.tsx');
    assert.ok(!selectorSource.includes('placeholder="agent-id"'));
    assert.ok(!popoverSource.includes('placeholder="agent-id"'));
    assert.ok(!selectorSource.includes('selectAgent({ id, name: id })'));
    assert.ok(!popoverSource.includes('selectAgent({ id, name: id })'));
  });
});
