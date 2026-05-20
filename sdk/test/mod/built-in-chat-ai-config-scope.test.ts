import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFirstRunBuiltInChatAIConfig,
  applyFirstRunBuiltInChatAIConfigs,
  assertBuiltInChatAIScopeRef,
  builtInChatAIScopeRefs,
  createBuiltInChatAIScopeRef,
  isBuiltInChatAIScopeRef,
  type AIProfile,
  type AIScopeRef,
} from '../../src/mod/runtime/ai-config.js';

const FIRST_RUN_PROFILE: AIProfile = {
  profileId: 'factory:local-speech-ready',
  title: 'Default Local Speech Ready',
  description: 'First-run local baseline factory AIProfile.',
  tags: ['factory-ai-profile', 'local-speech-ready'],
  capabilities: {
    'text.generate': { binding: null },
    'audio.transcribe': { binding: null },
    'audio.synthesize': { binding: null },
  },
};

// ---------------------------------------------------------------------------
// Positive: canonical feature-shape scope factory (P-AISC-006)
// ---------------------------------------------------------------------------

test('createBuiltInChatAIScopeRef produces the canonical feature shape for both surfaces', () => {
  assert.deepEqual(createBuiltInChatAIScopeRef('nimi'), {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'nimi',
  });
  assert.deepEqual(createBuiltInChatAIScopeRef('agent'), {
    kind: 'feature',
    ownerId: 'desktop.chat',
    surfaceId: 'agent',
  });
});

test('builtInChatAIScopeRefs returns exactly the two canonical scopes in stable order', () => {
  const refs = builtInChatAIScopeRefs();
  assert.equal(refs.length, 2);
  assert.equal(refs[0]?.surfaceId, 'nimi');
  assert.equal(refs[1]?.surfaceId, 'agent');
  for (const ref of refs) {
    assert.ok(isBuiltInChatAIScopeRef(ref));
  }
});

test('assertBuiltInChatAIScopeRef accepts the exact canonical scopes', () => {
  for (const ref of builtInChatAIScopeRefs()) {
    assert.deepEqual(assertBuiltInChatAIScopeRef(ref), ref);
  }
});

// ---------------------------------------------------------------------------
// Negative: generic / retired / omitted scope shapes are rejected
// ---------------------------------------------------------------------------

test('generic app:desktop:chat scope is rejected as a built-in chat scope', () => {
  const generic: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };
  assert.equal(isBuiltInChatAIScopeRef(generic), false);
  assert.throws(() => assertBuiltInChatAIScopeRef(generic), /feature:desktop\.chat/);
});

test('retired app:desktop.chat.nimi shape is rejected as a built-in chat scope', () => {
  const retired: AIScopeRef = { kind: 'app', ownerId: 'desktop.chat.nimi', surfaceId: 'chat' };
  assert.equal(isBuiltInChatAIScopeRef(retired), false);
  assert.throws(() => assertBuiltInChatAIScopeRef(retired), /feature:desktop\.chat/);
});

test('merged desktop.chat scope with no surfaceId is rejected', () => {
  const merged = { kind: 'feature', ownerId: 'desktop.chat' } as AIScopeRef;
  assert.equal(isBuiltInChatAIScopeRef(merged), false);
  assert.throws(() => assertBuiltInChatAIScopeRef(merged), /feature:desktop\.chat/);
});

test('omitted / null scope is rejected and never inferred', () => {
  assert.equal(isBuiltInChatAIScopeRef(null), false);
  assert.equal(isBuiltInChatAIScopeRef(undefined), false);
  assert.throws(() => assertBuiltInChatAIScopeRef(null), /required and must be provided explicitly/);
  assert.throws(
    () => assertBuiltInChatAIScopeRef(undefined),
    /required and must be provided explicitly/,
  );
});

test('createBuiltInChatAIScopeRef rejects a non-canonical surface id', () => {
  assert.throws(
    () => createBuiltInChatAIScopeRef('chat' as unknown as 'nimi'),
    /must be 'nimi' or 'agent'/,
  );
});

// ---------------------------------------------------------------------------
// S-AICONF-007: first-run helper requires explicit canonical scope and an
// explicit host AIConfig apply authority; it never mints/strings the ref.
// ---------------------------------------------------------------------------

test('applyFirstRunBuiltInChatAIConfig delegates evidence minting to the host AIConfig authority', async () => {
  const applied: Array<{ scopeRef: AIScopeRef; profileId: string }> = [];
  const evidence = await applyFirstRunBuiltInChatAIConfig({
    scopeRef: createBuiltInChatAIScopeRef('nimi'),
    profile: FIRST_RUN_PROFILE,
    applyHostAiConfig: async (boundScopeRef, profile) => {
      applied.push({ scopeRef: boundScopeRef, profileId: profile.profileId });
      return `built-in-ai-config:v1:host:${boundScopeRef.surfaceId}`;
    },
  });
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0]?.scopeRef, createBuiltInChatAIScopeRef('nimi'));
  assert.deepEqual(evidence.scopeRef, createBuiltInChatAIScopeRef('nimi'));
  assert.equal(evidence.ref, 'built-in-ai-config:v1:host:nimi');
});

test('applyFirstRunBuiltInChatAIConfigs materializes BOTH canonical scopes', async () => {
  const result = await applyFirstRunBuiltInChatAIConfigs({
    profile: FIRST_RUN_PROFILE,
    applyHostAiConfig: async (boundScopeRef) =>
      `built-in-ai-config:v1:host:${boundScopeRef.surfaceId}`,
  });
  assert.equal(result.builtInAiConfigRefs.length, 2);
  assert.equal(result.builtInAiConfigRefs[0]?.scopeRef.surfaceId, 'nimi');
  assert.equal(result.builtInAiConfigRefs[1]?.scopeRef.surfaceId, 'agent');
});

test('S-AICONF-007: first-run helper rejects omitted-scope inference', async () => {
  await assert.rejects(
    () =>
      applyFirstRunBuiltInChatAIConfig({
        scopeRef: undefined as unknown as AIScopeRef,
        profile: FIRST_RUN_PROFILE,
        applyHostAiConfig: async () => 'built-in-ai-config:v1:host:nimi',
      }),
    /required and must be provided explicitly/,
  );
});

test('S-AICONF-007: first-run helper rejects the generic app:desktop:chat scope', async () => {
  await assert.rejects(
    () =>
      applyFirstRunBuiltInChatAIConfig({
        scopeRef: { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' },
        profile: FIRST_RUN_PROFILE,
        applyHostAiConfig: async () => 'built-in-ai-config:v1:host:nimi',
      }),
    /feature:desktop\.chat/,
  );
});

test('S-AICONF-007: first-run helper rejects a host that returns an empty / string-only ref', async () => {
  await assert.rejects(
    () =>
      applyFirstRunBuiltInChatAIConfig({
        scopeRef: createBuiltInChatAIScopeRef('agent'),
        profile: FIRST_RUN_PROFILE,
        applyHostAiConfig: async () => '   ',
      }),
    /did not return a durable built-in AIConfig ref/,
  );
});

test('S-AICONF-007: first-run helper requires an explicit host AIConfig apply authority', async () => {
  await assert.rejects(
    () =>
      applyFirstRunBuiltInChatAIConfig({
        scopeRef: createBuiltInChatAIScopeRef('nimi'),
        profile: FIRST_RUN_PROFILE,
        applyHostAiConfig: undefined as unknown as () => Promise<string>,
      }),
    /requires a host AIConfig apply authority/,
  );
});

test('S-AICONF-007: first-run helper rejects an invalid AIProfile', async () => {
  await assert.rejects(
    () =>
      applyFirstRunBuiltInChatAIConfig({
        scopeRef: createBuiltInChatAIScopeRef('nimi'),
        profile: { profileId: '', title: '', description: '', tags: [], capabilities: {} },
        applyHostAiConfig: async () => 'built-in-ai-config:v1:host:nimi',
      }),
    /first-run built-in chat AIProfile is invalid/,
  );
});
