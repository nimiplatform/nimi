import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  parseMentions,
  detectGroupAgentTriggers,
  isMessageWithinTriggerWindow,
} from '../src/shell/renderer/features/chat/chat-group-agent-dispatcher';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeParticipant(overrides: Record<string, unknown>) {
  return {
    accountId: 'acc_default',
    type: 'human' as const,
    role: 'member' as const,
    displayName: 'Default',
    handle: 'default',
    avatarUrl: null,
    agentOwnerId: null,
    joinedAt: '2026-01-01T00:00:00Z',
    isOnline: false,
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown>) {
  return {
    id: 'msg_default',
    chatId: 'chat_1',
    senderId: 'sender_1',
    clientMessageId: 'cm_1',
    type: 'TEXT' as const,
    text: '',
    payload: null,
    isRead: false,
    // Default to "just now" so messages pass the recency gate.
    createdAt: new Date().toISOString(),
    author: {
      type: 'human' as const,
      accountId: 'sender_1',
      displayName: 'Alice',
      avatarUrl: null,
      agentOwnerId: null,
    },
    ...overrides,
  };
}

describe('parseMentions', () => {
  const agentParticipants = [
    makeParticipant({
      accountId: 'agent_bot_a',
      type: 'agent',
      displayName: 'Bot-A',
      handle: 'bot_a',
      agentOwnerId: 'user_alice',
    }),
    makeParticipant({
      accountId: 'agent_bot_b',
      type: 'agent',
      displayName: 'Helper Bot',
      handle: 'helper_bot',
      agentOwnerId: 'user_bob',
    }),
  ];

  it('detects @displayName mention', () => {
    const result = parseMentions('Hey @Bot-A what do you think?', agentParticipants as never);
    assert.deepStrictEqual(result, ['agent_bot_a']);
  });

  it('detects @handle mention', () => {
    const result = parseMentions('Hey @bot_a thoughts?', agentParticipants as never);
    assert.deepStrictEqual(result, ['agent_bot_a']);
  });

  it('is case-insensitive', () => {
    const result = parseMentions('Hey @BOT-A and @HELPER BOT', agentParticipants as never);
    assert.ok(result.includes('agent_bot_a'));
    assert.ok(result.includes('agent_bot_b'));
  });

  it('returns empty for no mentions', () => {
    const result = parseMentions('Just a regular message', agentParticipants as never);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty for no @ symbol', () => {
    const result = parseMentions('Bot-A is cool', agentParticipants as never);
    assert.deepStrictEqual(result, []);
  });

  it('deduplicates mentions of the same agent', () => {
    const result = parseMentions('@Bot-A hello @bot_a again', agentParticipants as never);
    assert.deepStrictEqual(result, ['agent_bot_a']);
  });

  it('ignores human participant mentions (only matches agents)', () => {
    const allParticipants = [
      ...agentParticipants,
      makeParticipant({
        accountId: 'user_carol',
        type: 'human',
        displayName: 'Carol',
        handle: 'carol',
      }),
    ];
    const result = parseMentions('@Carol what about @Bot-A?', allParticipants as never);
    assert.deepStrictEqual(result, ['agent_bot_a']);
  });

  it('respects word boundary after mention', () => {
    const result = parseMentions('@Bot-Alpha is different from @Bot-A', agentParticipants as never);
    assert.deepStrictEqual(result, ['agent_bot_a']);
  });
});

describe('detectGroupAgentTriggers', () => {
  const participants = [
    makeParticipant({ accountId: 'user_alice', type: 'human', displayName: 'Alice' }),
    makeParticipant({ accountId: 'user_bob', type: 'human', displayName: 'Bob' }),
    makeParticipant({
      accountId: 'agent_bot_a',
      type: 'agent',
      displayName: 'Bot-A',
      handle: 'bot_a',
      agentOwnerId: 'user_alice',
    }),
    makeParticipant({
      accountId: 'agent_bot_b',
      type: 'agent',
      displayName: 'Bot-B',
      handle: 'bot_b',
      agentOwnerId: 'user_bob',
    }),
  ];

  it('detects mention trigger for owned agent', () => {
    const message = makeMessage({
      id: 'msg_1',
      text: 'Hey @Bot-A what do you think?',
      senderId: 'user_alice',
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.type, 'mention');
    assert.equal(triggers[0]!.agentAccountId, 'agent_bot_a');
    assert.equal(triggers[0]!.agentDisplayName, 'Bot-A');
  });

  it('does NOT trigger for agent owned by another user', () => {
    const message = makeMessage({
      id: 'msg_1',
      text: 'Hey @Bot-B what do you think?',
      senderId: 'user_alice',
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 0);
  });

  it('detects reply-to-agent trigger from replyTo payload', () => {
    const agentMessage = makeMessage({
      id: 'msg_agent_reply',
      text: 'I think the design is great.',
      senderId: 'agent_bot_a',
      author: {
        type: 'agent',
        accountId: 'agent_bot_a',
        displayName: 'Bot-A',
        avatarUrl: null,
        agentOwnerId: 'user_alice',
      },
    });
    const replyMessage = makeMessage({
      id: 'msg_2',
      text: 'Can you elaborate?',
      senderId: 'user_alice',
      replyTo: {
        messageId: 'msg_agent_reply',
      },
    });
    const triggers = detectGroupAgentTriggers({
      message: replyMessage as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [agentMessage, replyMessage] as never,
    });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.type, 'reply');
    assert.equal(triggers[0]!.agentAccountId, 'agent_bot_a');
  });

  it('detects reply-to-agent trigger from replyTo id payload', () => {
    const agentMessage = makeMessage({
      id: 'msg_agent_reply_payload',
      text: 'I think the design is great.',
      senderId: 'agent_bot_a',
      author: {
        type: 'agent',
        accountId: 'agent_bot_a',
        displayName: 'Bot-A',
        avatarUrl: null,
        agentOwnerId: 'user_alice',
      },
    });
    const replyMessage = makeMessage({
      id: 'msg_reply_payload',
      text: 'Can you elaborate?',
      senderId: 'user_alice',
      replyTo: {
        id: 'msg_agent_reply_payload',
      },
    });
    const triggers = detectGroupAgentTriggers({
      message: replyMessage as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [agentMessage, replyMessage] as never,
    });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.type, 'reply');
    assert.equal(triggers[0]!.agentAccountId, 'agent_bot_a');
  });

  it('does not trigger from legacy replyToMessageId without a replyTo payload', () => {
    const agentMessage = makeMessage({
      id: 'msg_agent_legacy_reply',
      text: 'I think the design is great.',
      senderId: 'agent_bot_a',
      author: {
        type: 'agent',
        accountId: 'agent_bot_a',
        displayName: 'Bot-A',
        avatarUrl: null,
        agentOwnerId: 'user_alice',
      },
    });
    const replyMessage = makeMessage({
      id: 'msg_legacy_reply',
      text: 'Can you elaborate?',
      senderId: 'user_alice',
      replyToMessageId: 'msg_agent_legacy_reply',
    });
    const triggers = detectGroupAgentTriggers({
      message: replyMessage as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [agentMessage, replyMessage] as never,
    });
    assert.equal(triggers.length, 0);
  });

  it('deduplicates when message both mentions and replies to same agent', () => {
    const agentMessage = makeMessage({
      id: 'msg_agent',
      text: 'Hello!',
      senderId: 'agent_bot_a',
      author: {
        type: 'agent',
        accountId: 'agent_bot_a',
        displayName: 'Bot-A',
        avatarUrl: null,
        agentOwnerId: 'user_alice',
      },
    });
    const replyMessage = makeMessage({
      id: 'msg_3',
      text: '@Bot-A tell me more',
      senderId: 'user_alice',
      replyTo: {
        messageId: 'msg_agent',
      },
    });
    const triggers = detectGroupAgentTriggers({
      message: replyMessage as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [agentMessage, replyMessage] as never,
    });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0]!.type, 'mention');
  });

  it('returns empty for message with no mentions and no reply', () => {
    const message = makeMessage({
      id: 'msg_1',
      text: 'Just chatting normally',
      senderId: 'user_alice',
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 0);
  });

  it('returns empty when current user owns no agents in the group', () => {
    const noAgentParticipants = [
      makeParticipant({ accountId: 'user_carol', type: 'human', displayName: 'Carol' }),
      makeParticipant({
        accountId: 'agent_bot_a',
        type: 'agent',
        displayName: 'Bot-A',
        handle: 'bot_a',
        agentOwnerId: 'user_alice',
      }),
    ];
    const message = makeMessage({
      id: 'msg_1',
      text: 'Hey @Bot-A',
      senderId: 'user_carol',
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: noAgentParticipants as never,
      currentUserId: 'user_carol',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 0);
  });
});

describe('isMessageWithinTriggerWindow', () => {
  it('returns true for a message created just now', () => {
    const now = Date.now();
    assert.ok(isMessageWithinTriggerWindow({ createdAt: new Date(now - 1000).toISOString() }, now));
  });

  it('returns true for a message created 30 seconds ago', () => {
    const now = Date.now();
    assert.ok(isMessageWithinTriggerWindow({ createdAt: new Date(now - 30_000).toISOString() }, now));
  });

  it('returns false for a message created 2 minutes ago', () => {
    const now = Date.now();
    assert.ok(!isMessageWithinTriggerWindow({ createdAt: new Date(now - 120_000).toISOString() }, now));
  });

  it('returns false for a message created 5 minutes ago', () => {
    const now = Date.now();
    assert.ok(!isMessageWithinTriggerWindow({ createdAt: new Date(now - 300_000).toISOString() }, now));
  });

  it('returns false for invalid date', () => {
    assert.ok(!isMessageWithinTriggerWindow({ createdAt: 'not-a-date' }));
  });

  it('returns false for empty date', () => {
    assert.ok(!isMessageWithinTriggerWindow({ createdAt: '' }));
  });
});

describe('detectGroupAgentTriggers recency gate', () => {
  const participants = [
    makeParticipant({ accountId: 'user_alice', type: 'human', displayName: 'Alice' }),
    makeParticipant({
      accountId: 'agent_bot_a',
      type: 'agent',
      displayName: 'Bot-A',
      handle: 'bot_a',
      agentOwnerId: 'user_alice',
    }),
  ];

  it('returns triggers for recent messages', () => {
    const message = makeMessage({
      id: 'msg_recent',
      text: 'Hey @Bot-A',
      senderId: 'user_alice',
      createdAt: new Date(Date.now() - 5000).toISOString(),
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 1);
  });

  it('returns empty for old messages outside recency window', () => {
    const message = makeMessage({
      id: 'msg_old',
      text: 'Hey @Bot-A',
      senderId: 'user_alice',
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    });
    const triggers = detectGroupAgentTriggers({
      message: message as never,
      participants: participants as never,
      currentUserId: 'user_alice',
      allMessages: [message] as never,
    });
    assert.equal(triggers.length, 0);
  });
});

describe('D-LLM-026b isolation', () => {
  it('chat-group-agent-execution does not import continuity, memory, sidecar, or follow-up modules', () => {
    const executionPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-agent-execution.ts',
    );
    const source = readFileSync(executionPath, 'utf-8');

    const forbiddenImports = [
      'chat-agent-continuity',
      'chat-agent-runtime-memory',
      'chat-agent-orchestration-follow-up',
      'chat-agent-orchestration-actions',
      'sidecar',
    ];
    for (const forbidden of forbiddenImports) {
      assert.ok(
        !source.includes(forbidden),
        `chat-group-agent-execution.ts must NOT import '${forbidden}' (D-LLM-026b)`,
      );
    }
  });

  it('chat-group-agent-dispatcher does not import any execution or memory module', () => {
    const dispatcherPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-agent-dispatcher.ts',
    );
    const source = readFileSync(dispatcherPath, 'utf-8');

    const forbiddenImports = [
      'chat-agent-continuity',
      'chat-agent-runtime-memory',
      'chat-agent-orchestration',
      'chat-agent-runtime-text',
      'chat-agent-runtime-image',
    ];
    for (const forbidden of forbiddenImports) {
      assert.ok(
        !source.includes(forbidden),
        `chat-group-agent-dispatcher.ts must NOT import '${forbidden}' (D-LLM-026b)`,
      );
    }
  });

  it('chat-group-agent-dispatcher uses current replyTo contract language only', () => {
    const dispatcherPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-agent-dispatcher.ts',
    );
    const source = readFileSync(dispatcherPath, 'utf-8');

    assert.doesNotMatch(source, /replyToMessageId/);
    assert.doesNotMatch(source, /legacyReplyToId/);
    assert.doesNotMatch(source, /MVP|Wave \d|Wave hardening|staged/i);
    assert.match(source, /message replyTo payload targets a message authored by an agent owned by currentUserId/);
  });

  it('chat-group-agent-execution does not import scope creation or memory modules', () => {
    const executionPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-agent-execution.ts',
    );
    const source = readFileSync(executionPath, 'utf-8');

    // Must not contain AIScopeRef creation (import or call — comments are OK)
    assert.ok(
      !source.includes('createAIScopeRef'),
      'chat-group-agent-execution.ts must NOT call createAIScopeRef (D-LLM-026b)',
    );
    assert.ok(
      !source.includes("import type { AIScopeRef") && !source.includes("import { AIScopeRef"),
      'chat-group-agent-execution.ts must NOT import AIScopeRef (D-LLM-026b)',
    );
    // Must not contain memory write
    assert.ok(
      !source.includes('commitProviderOutcome') && !source.includes('writeMemory'),
      'chat-group-agent-execution.ts must NOT write memory (D-LLM-026b)',
    );
  });

  it('chat-group-adapter does not import continuity or memory modules', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    const forbiddenImports = [
      'chat-agent-continuity',
      'chat-agent-runtime-memory',
      'sidecar',
    ];
    for (const forbidden of forbiddenImports) {
      assert.ok(
        !source.includes(forbidden),
        `chat-group-adapter.tsx must NOT import '${forbidden}' (D-LLM-026b)`,
      );
    }
  });

  it('chat-group-adapter derives selection from the store rather than local state', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    assert.match(source, /const storeSelectedTargetId = useAppStore\(\(state\) => state\.selectedTargetBySource\.group \?\? null\);/);
    assert.match(source, /const selectedGroupId = storeSelectedTargetId === GROUP_CREATE_INTENT_TARGET_ID[\s\S]*?storeSelectedTargetId;/);
    assert.doesNotMatch(source, /useState<string \| null>\(null\).*selectedGroupId/s);
    assert.doesNotMatch(source, /setSelectedGroupId/);
  });

  it('chat-group-adapter includes the newly sent trigger message in the execution transcript', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    assert.match(source, /const nextTranscript = \[\.\.\.messagesRef\.current, msg\];/);
    assert.match(source, /dispatchGroupAgentTriggersForMessage\(\s*msg, msgId, participantsRef\.current, nextTranscript,/);
  });

  it('chat-group-adapter scans background groups by lastMessage and loads transcript before dispatch', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    assert.match(source, /const backgroundGroups = allGroups\.filter\(\(group\) => String\(group\.id \|\| ''\) !== selectedGroupId\);/);
    assert.match(source, /try \{\s*await maybeDispatchGroupAgentTriggersForChat\(\{\s*message: lastMessage,[\s\S]*?participants: group\.participants \|\| \[\],[\s\S]*?groupChatId,[\s\S]*?qc: queryClient,[\s\S]*?\}\);\s*\} catch \(error\) \{/s);
    assert.match(source, /message: 'background_group_scan_failed'/);
    assert.match(source, /\(\(await dataSync\.loadGroupMessages\(groupChatId\)\) as \{ items\?: GroupMessageViewDto\[] \} \| undefined\)\?\.items \|\| \[\]/);
  });

  it('chat-group-adapter binds post-send invalidation to the mutation chatId instead of current selection', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    assert.match(source, /onSuccess:\s*\(sentMessage,\s*variables\)\s*=>\s*\{/);
    assert.match(source, /const sentChatId = String\(variables\.chatId \|\| ''\);/);
    assert.match(source, /void queryClient\.invalidateQueries\(\{ queryKey: \['group-messages', sentChatId\] \}\);/);
    assert.match(source, /if \(selectedGroupId === sentChatId\)/);
    assert.match(source, /void maybeDispatchGroupAgentTriggersForChat\(\{\s*message: msg,[\s\S]*?groupChatId: sentChatId,[\s\S]*?transcriptOverride: \[msg\],[\s\S]*?allowCurrentUserMessage: true,/s);
  });

  it('chat-group-adapter routes createGroup initialMessage through the same trigger path', () => {
    const adapterPath = resolve(
      __dirname,
      '../src/shell/renderer/features/chat/chat-group-adapter.tsx',
    );
    const source = readFileSync(adapterPath, 'utf-8');

    assert.match(source, /const handleCreateGroup = useCallback\(async \(title: string, participantIds: string\[]\) => \{/);
    assert.match(source, /'lastMessage' in result/);
    assert.match(source, /void maybeDispatchGroupAgentTriggersForChat\(\{\s*message: result\.lastMessage as GroupMessageViewDto,[\s\S]*?groupChatId: String\(\(result as \{ id: string \}\)\.id\),[\s\S]*?allowCurrentUserMessage: true,/s);
  });
});
