import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const referenceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/agent-chat/agent-chat-reference.tsx'),
  'utf8',
);

test('AgentChatReference includes AIScopeRef + aiProfile.apply pattern (satisfies check:home-shell-aiscoperef-required)', () => {
  assert.match(referenceSource, /\bAIScopeRef\b/);
  assert.match(referenceSource, /aiProfile\.apply/);
});

test('AgentChatReference uses constructor-injected executor (no direct HTTP/gRPC)', () => {
  assert.match(referenceSource, /executor\.applyProfile/);
  assert.doesNotMatch(referenceSource, /fetch\s*\(/);
  assert.doesNotMatch(referenceSource, /\bgrpc\b/i);
});

test('AgentChatReference projects scope kind + scope id + conversation anchor', () => {
  assert.match(referenceSource, /data-scope-kind=/);
  assert.match(referenceSource, /data-scope-id=/);
  assert.match(referenceSource, /data-conversation-anchor-id=/);
});

test('AgentChatReference is pure presentational (no useState/useEffect/useReducer)', () => {
  assert.doesNotMatch(referenceSource, /\buseState\b/);
  assert.doesNotMatch(referenceSource, /\buseEffect\b/);
  assert.doesNotMatch(referenceSource, /\buseReducer\b/);
});

test('AgentChatReference uses heading + aria-labelledby for a11y', () => {
  assert.match(referenceSource, /<h2 id="agent-chat-reference-title"/);
  assert.match(referenceSource, /aria-labelledby="agent-chat-reference-title"/);
});

test('AgentChatReference renders explicit no-profile state — never silently empty', () => {
  assert.match(referenceSource, /data-testid="agent-chat-no-profile"/);
});

test('AgentChatReference renders no provider/model identifier string constants', () => {
  const forbidden =
    /\b(openai|anthropic|claude(?:-[a-z0-9-]+)?|gpt(?:-[a-z0-9.]+)?|gemini(?:-[a-z0-9.-]+)?|deepseek(?:-[a-z0-9.-]+)?|qwen(?:[0-9a-z.-]+)?|mistral(?:-[a-z0-9.-]+)?|llama(?:[.-][a-z0-9.-]+)?|ollama|llamacpp|vllm)\b/i;
  const stringLiteral = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let match: RegExpExecArray | null;
  stringLiteral.lastIndex = 0;
  while ((match = stringLiteral.exec(referenceSource)) !== null) {
    const literal = match[2];
    if (literal && forbidden.test(literal)) {
      assert.fail(`forbidden identifier "${literal}" found in AgentChatReference`);
    }
  }
});

test('AgentChatReference uses canonical scope kind enum values only', () => {
  for (const kind of ['first-run', 'workspace', 'app', 'account']) {
    assert.ok(referenceSource.includes(`'${kind}'`), `AgentChatReference missing scope kind "${kind}"`);
  }
});
