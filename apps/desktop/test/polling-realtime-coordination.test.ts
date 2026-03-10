import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

/**
 * Isolate the onConnect handler body from the source.
 * The handler starts with `const onConnect = () => {` and ends at the
 * matching closing brace before the next `const on` declaration.
 */
function extractHandler(name: string): string {
  const startPattern = new RegExp(`const ${name} = \\(.*?\\) => \\{`);
  const match = startPattern.exec(source);
  if (!match) {
    throw new Error(`Handler ${name} not found in source`);
  }
  let depth = 0;
  let started = false;
  const startIdx = match.index + match[0].length;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      started = true;
    } else if (source[i] === '}') {
      if (!started && depth === 0) {
        // This is the closing brace of the handler itself
        return source.slice(startIdx, i);
      }
      depth--;
      if (depth < 0) {
        return source.slice(startIdx, i);
      }
    }
  }
  throw new Error(`Could not find matching brace for handler ${name}`);
}

const onConnectBody = extractHandler('onConnect');
const onDisconnectBody = extractHandler('onDisconnect');
const onChatEventBody = extractHandler('onChatEvent');
const onSyncRequiredBody = extractHandler('onSyncRequired');

describe('D-NET-007: polling/realtime coordination', () => {
  test('D-NET-007: socket connect triggers chat list invalidation', () => {
    assert.ok(
      onConnectBody.includes("invalidateQueries({ queryKey: ['chats'] })"),
      'onConnect must call invalidateQueries with queryKey ["chats"]',
    );
  });

  test('D-NET-007: socket connect triggers outbox flush', () => {
    assert.ok(
      onConnectBody.includes('flushChatOutbox()'),
      'onConnect must call flushChatOutbox()',
    );
  });

  test('D-NET-007: socket disconnect triggers chat list invalidation', () => {
    assert.ok(
      onDisconnectBody.includes("invalidateQueries({ queryKey: ['chats'] })"),
      'onDisconnect must call invalidateQueries with queryKey ["chats"]',
    );
  });

  test('D-NET-007: socket disconnect triggers sync for active chat', () => {
    assert.ok(
      onDisconnectBody.includes('syncChatEvents'),
      'onDisconnect must call syncChatEvents for the active chat',
    );
  });

  test('D-NET-007: shared seenEvents LRU has 3000 capacity', () => {
    assert.match(
      source,
      /SEEN_EVENT_LIMIT\s*=\s*3000/,
      'SEEN_EVENT_LIMIT must equal 3000',
    );
  });

  test('D-NET-007: seenEvents covers both polling sync and realtime events', () => {
    assert.ok(
      onChatEventBody.includes('rememberSeenEvent'),
      'onChatEvent handler must call rememberSeenEvent for realtime dedup',
    );
    assert.ok(
      onSyncRequiredBody.includes('rememberSeenEvent'),
      'onSyncRequired handler must call rememberSeenEvent for polling dedup',
    );
  });
});

describe('D-OFFLINE-001: realm reachability via socket lifecycle', () => {
  test('D-OFFLINE-001: socket connect sets realm reachable', () => {
    assert.ok(
      onConnectBody.includes('offlineCoordinator.markRealmSocketReachable(true)'),
      'onConnect must call offlineCoordinator.markRealmSocketReachable(true)',
    );
  });

  test('D-OFFLINE-001: socket disconnect sets realm unreachable', () => {
    assert.ok(
      onDisconnectBody.includes('offlineCoordinator.markRealmSocketReachable(false)'),
      'onDisconnect must call offlineCoordinator.markRealmSocketReachable(false)',
    );
  });

  test('D-OFFLINE-004: socket reconnect backoff is explicitly configured', () => {
    assert.ok(
      source.includes('reconnectionDelay: 1000'),
      'socket must configure reconnectionDelay: 1000',
    );
    assert.ok(
      source.includes('reconnectionDelayMax: 30_000'),
      'socket must configure reconnectionDelayMax: 30_000',
    );
    assert.ok(
      source.includes('reconnectionAttempts: Infinity'),
      'socket must configure reconnectionAttempts: Infinity',
    );
  });
});
