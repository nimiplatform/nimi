import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RuntimeAllowlistedMethodIds,
  RuntimeMethodIds,
  RuntimeStreamMethodIds,
} from '../src/method-ids';
import {
  RuntimeStreamMethodCodecs,
  RuntimeUnaryMethodCodecs,
} from '../src/core/method-codecs';

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function extractMethodIdsFromRustConst(source: string, constName: string): string[] {
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(
    `pub const ${escapedName}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`,
    'm',
  );
  const block = source.match(blockPattern)?.[1] || '';
  const methodMatches = block.match(/"\/nimi\.runtime\.v1\.[^"]+"/g) || [];
  return uniqueSorted(methodMatches.map((value) => value.slice(1, -1)));
}

function sdkMethodIdValues(): string[] {
  return uniqueSorted(
    Object.values(RuntimeMethodIds)
      .flatMap((service) => Object.values(service)),
  );
}

const runtimeBridgeMethodFile = fileURLToPath(
  new URL('../../../../apps/desktop/src-tauri/src/runtime_bridge/generated/method_ids.rs', import.meta.url),
);
const runtimeBridgeMethodSource = readFileSync(runtimeBridgeMethodFile, 'utf-8');

test('sdk method ids include exact unary/stream codec coverage', () => {
  const codecMethodIds = uniqueSorted([
    ...Object.keys(RuntimeUnaryMethodCodecs),
    ...Object.keys(RuntimeStreamMethodCodecs),
  ]);
  assert.deepEqual(codecMethodIds, sdkMethodIdValues());
});

test('sdk allowlist matches RuntimeMethodIds flatten', () => {
  assert.deepEqual(uniqueSorted(RuntimeAllowlistedMethodIds), sdkMethodIdValues());
});

test('rust bridge stream method allowlist matches sdk stream ids', () => {
  const rustStreamMethods = extractMethodIdsFromRustConst(
    runtimeBridgeMethodSource,
    'RUNTIME_BRIDGE_STREAM_METHODS',
  );
  assert.deepEqual(rustStreamMethods, uniqueSorted(RuntimeStreamMethodIds));
});

test('rust bridge allowlisted methods match sdk allowlist', () => {
  const rustAllowlistedMethods = extractMethodIdsFromRustConst(
    runtimeBridgeMethodSource,
    'RUNTIME_BRIDGE_ALLOWLISTED_METHODS',
  );
  assert.deepEqual(rustAllowlistedMethods, uniqueSorted(RuntimeAllowlistedMethodIds));
});
