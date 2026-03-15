import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_PATH = resolve(
  import.meta.dirname,
  '../src/shell/renderer/features/realtime/use-chat-realtime-sync.ts',
);
const source = readFileSync(SOURCE_PATH, 'utf-8');

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
const onNotificationBody = extractHandler('onNotification');

describe('notification realtime sync wiring', () => {
  test('socket subscribes to notif:new and invalidates notification queries', () => {
    assert.match(source, /socket\.on\('notif:new', onNotification\)/);
    assert.match(source, /socket\.off\('notif:new', onNotification\)/);
    assert.ok(
      onNotificationBody.includes('invalidateNotificationQueries()'),
      'notif:new handler must invalidate notification queries',
    );
  });

  test('socket reconnect refreshes notification queries in addition to chat queries', () => {
    assert.ok(
      onConnectBody.includes('invalidateNotificationQueries()'),
      'onConnect must invalidate notification queries',
    );
  });
});
