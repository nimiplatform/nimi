import {
  assert,
  test,
  ReasonCode,
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
} from './chat-agent-local-mode-test-utils.js';
import type { NimiRuntimeAgentMessage, NimiRuntimeAgentSessionSnapshot } from '@nimiplatform/sdk/runtime';

type RuntimeAgentReplaySessionSnapshot = NimiRuntimeAgentSessionSnapshot & {
  readonly transcript?: readonly NimiRuntimeAgentMessage[];
};

function transcriptWithoutRuntimeReplayEnvelope(
  messages: readonly { role: 'user' | 'assistant'; content: string }[],
): RuntimeAgentReplaySessionSnapshot['transcript'] {
  return messages as unknown as RuntimeAgentReplaySessionSnapshot['transcript'];
}

test('agent session hydration does not replace missing local bundle with text-only runtime snapshot without envelope', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: null,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: null,
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: transcriptWithoutRuntimeReplayEnvelope([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]),
      transcriptMessageCount: 2,
    },
    nowMs: 5000,
  });

  assert.equal(hydrated, null);
});

test('agent session hydration can rebuild missing local bundle from Runtime replay envelope', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: null,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: null,
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: [
        {
          id: 'anchor-1:transcript:0',
          role: 'user',
          content: 'hello',
          status: 'complete',
          kind: 'text',
          createdAt: '1970-01-01T00:00:05.000Z',
          updatedAt: '1970-01-01T00:00:05.000Z',
        },
        {
          id: 'anchor-1:transcript:1',
          role: 'assistant',
          content: 'hi there',
          status: 'complete',
          kind: 'text',
          createdAt: '1970-01-01T00:00:05.001Z',
          updatedAt: '1970-01-01T00:00:05.001Z',
          parentMessageId: 'anchor-1:transcript:0',
          traceId: 'trace-runtime-1',
          reasoningText: 'runtime reasoning',
        },
      ],
      transcriptMessageCount: 2,
    },
    nowMs: 9000,
  });

  assert.ok(hydrated);
  assert.deepEqual(hydrated?.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.contentText,
    createdAtMs: message.createdAtMs,
    parentMessageId: message.parentMessageId,
  })), [
    {
      id: 'anchor-1:transcript:0',
      role: 'user',
      text: 'hello',
      createdAtMs: 5000,
      parentMessageId: null,
    },
    {
      id: 'anchor-1:transcript:1',
      role: 'assistant',
      text: 'hi there',
      createdAtMs: 5001,
      parentMessageId: 'anchor-1:transcript:0',
    },
  ]);
  assert.equal(hydrated?.thread.lastMessageAtMs, 5001);
  assert.equal(hydrated?.messages[1]?.traceId, 'trace-runtime-1');
  assert.equal(hydrated?.messages[1]?.reasoningText, 'runtime reasoning');
});

test('agent session hydration rejects missing replay envelope even when local bundle exists', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: 1001,
    targetSnapshot: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: {
      thread,
      messages: [{
        id: 'local-user-1',
        threadId: 'thread-1',
        role: 'user',
        status: 'complete',
        kind: 'text',
        contentText: 'hello',
        reasoningText: null,
        error: null,
        traceId: null,
        parentMessageId: null,
        mediaUrl: null,
        mediaMimeType: null,
        artifactId: null,
        metadataJson: null,
        createdAtMs: 1001,
        updatedAtMs: 1001,
      }],
    },
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: transcriptWithoutRuntimeReplayEnvelope([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'runtime changed but has no envelope' },
      ]),
      transcriptMessageCount: 2,
    },
    nowMs: 5000,
  });

  assert.equal(hydrated, null);
});

test('agent session hydration preserves local pending projections over runtime snapshot replay', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: null,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: {
      thread,
      messages: [{
        id: 'pending-1',
        threadId: 'thread-1',
        role: 'assistant',
        status: 'pending',
        kind: 'text',
        contentText: '',
        reasoningText: null,
        error: null,
        traceId: null,
        parentMessageId: null,
        mediaUrl: null,
        mediaMimeType: null,
        artifactId: null,
        metadataJson: null,
        createdAtMs: 1001,
        updatedAtMs: 1001,
      }],
    },
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: transcriptWithoutRuntimeReplayEnvelope([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]),
      transcriptMessageCount: 2,
    },
    nowMs: 5000,
  });

  assert.equal(hydrated, null);
});

test('agent session hydration does not drop committed assistant text when failed runtime snapshot regresses transcript', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 3000,
    lastMessageAtMs: 3000,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: {
      thread,
      messages: [
        {
          id: 'anchor-1:session:0',
          threadId: 'thread-1',
          role: 'user',
          status: 'complete',
          kind: 'text',
          contentText: 'hello',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1001,
          updatedAtMs: 1001,
        },
        {
          id: 'anchor-1:session:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          kind: 'text',
          contentText: 'previous response',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: 'anchor-1:session:0',
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1002,
          updatedAtMs: 1002,
        },
        {
          id: 'local-user-new',
          threadId: 'thread-1',
          role: 'user',
          status: 'complete',
          kind: 'text',
          contentText: 'today weather?',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 3000,
          updatedAtMs: 3000,
        },
      ],
    },
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: transcriptWithoutRuntimeReplayEnvelope([
        { role: 'user', content: 'hello' },
        { role: 'user', content: 'today weather?' },
      ]),
      transcriptMessageCount: 2,
      lastTurn: {
        turnId: 'turn-failed',
        status: 'failed',
        message: 'runtime agent turn failed before producing a structured projection',
        reasonCode: ReasonCode.AI_OUTPUT_INVALID,
      },
    },
    nowMs: 5000,
  });

  assert.equal(hydrated, null);
});

test('agent session hydration preserves committed assistant image projection when text transcript matches', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: 3000,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: {
      thread,
      messages: [
        {
          id: 'anchor-1:session:0',
          threadId: 'thread-1',
          role: 'user',
          status: 'complete',
          kind: 'text',
          contentText: 'hello',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1001,
          updatedAtMs: 1001,
        },
        {
          id: 'anchor-1:session:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          kind: 'text',
          contentText: 'hi there',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: 'anchor-1:session:0',
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1002,
          updatedAtMs: 1002,
        },
        {
          id: 'turn-image-1:message:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          kind: 'image',
          contentText: 'A quiet lake at dawn',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: 'file:///tmp/agent-image.png',
          mediaMimeType: 'image/png',
          artifactId: 'artifact-image-1',
          metadataJson: null,
          createdAtMs: 1003,
          updatedAtMs: 1003,
        },
      ],
    },
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: transcriptWithoutRuntimeReplayEnvelope([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ]),
      transcriptMessageCount: 2,
    },
    nowMs: 5000,
  });

  assert.equal(hydrated, null);
});

test('agent session hydration merges committed media projections when runtime text transcript changes', () => {
  const thread = {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent One',
    createdAtMs: 1000,
    updatedAtMs: 1000,
    lastMessageAtMs: 3000,
    targetSnapshot: {
      ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent One',
      handle: 'agent-one',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };

  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread,
    bundle: {
      thread,
      messages: [
        {
          id: 'anchor-1:session:0',
          threadId: 'thread-1',
          role: 'user',
          status: 'complete',
          kind: 'text',
          contentText: 'hello',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1001,
          updatedAtMs: 1001,
        },
        {
          id: 'anchor-1:session:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          kind: 'text',
          contentText: 'old answer',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: 'anchor-1:session:0',
          mediaUrl: null,
          mediaMimeType: null,
          artifactId: null,
          metadataJson: null,
          createdAtMs: 1002,
          updatedAtMs: 1002,
        },
        {
          id: 'turn-image-1:message:1',
          threadId: 'thread-1',
          role: 'assistant',
          status: 'complete',
          kind: 'image',
          contentText: 'A quiet lake at dawn',
          reasoningText: null,
          error: null,
          traceId: null,
          parentMessageId: null,
          mediaUrl: 'file:///tmp/agent-image.png',
          mediaMimeType: 'image/png',
          artifactId: 'artifact-image-1',
          metadataJson: null,
          createdAtMs: 6000,
          updatedAtMs: 6000,
        },
      ],
    },
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: [
        {
          id: 'anchor-1:transcript:0',
          role: 'user',
          content: 'hello',
          status: 'complete',
          kind: 'text',
          createdAt: '1970-01-01T00:00:05.000Z',
          updatedAt: '1970-01-01T00:00:05.000Z',
        },
        {
          id: 'anchor-1:transcript:1',
          role: 'assistant',
          content: 'new answer',
          status: 'complete',
          kind: 'text',
          createdAt: '1970-01-01T00:00:05.001Z',
          updatedAt: '1970-01-01T00:00:05.001Z',
          parentMessageId: 'anchor-1:transcript:0',
          traceId: 'trace-runtime-1',
          reasoningText: 'runtime reasoning',
          metadata: { source: 'runtime' },
        },
      ],
      transcriptMessageCount: 2,
    },
    nowMs: 5000,
  });

  assert.ok(hydrated);
  assert.deepEqual(hydrated?.messages.map((message) => ({
    id: message.id,
    kind: message.kind,
    text: message.contentText,
    mediaUrl: message.mediaUrl,
    mediaMimeType: message.mediaMimeType,
    artifactId: message.artifactId,
  })), [
    {
      id: 'anchor-1:transcript:0',
      kind: 'text',
      text: 'hello',
      mediaUrl: null,
      mediaMimeType: null,
      artifactId: null,
    },
    {
      id: 'anchor-1:transcript:1',
      kind: 'text',
      text: 'new answer',
      mediaUrl: null,
      mediaMimeType: null,
      artifactId: null,
    },
    {
      id: 'turn-image-1:message:1',
      kind: 'image',
      text: 'A quiet lake at dawn',
      mediaUrl: 'file:///tmp/agent-image.png',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-image-1',
    },
  ]);
  assert.equal(hydrated?.messages[0]?.createdAtMs, 5000);
  assert.equal(hydrated?.messages[1]?.parentMessageId, 'anchor-1:transcript:0');
  assert.equal(hydrated?.messages[1]?.traceId, 'trace-runtime-1');
  assert.equal(hydrated?.messages[1]?.reasoningText, 'runtime reasoning');
  assert.deepEqual(hydrated?.messages[1]?.metadataJson, { source: 'runtime' });
  assert.equal(hydrated?.thread.lastMessageAtMs, 6000);
});
