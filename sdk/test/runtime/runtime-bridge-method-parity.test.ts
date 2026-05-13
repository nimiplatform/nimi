import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RuntimeAllowlistedMethodIds,
  RuntimeMethodGroupDeniedMethodIds,
  RuntimeMethodIds,
  RuntimeStreamMethodIds,
  isRuntimeMethodAllowlisted,
} from '../../src/runtime/method-ids';
import {
  RuntimeStreamMethodCodecs,
  RuntimeUnaryMethodCodecs,
} from '../../src/runtime/core/method-codecs';

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
  new URL('../../../kit/shell/tauri/src/runtime_bridge/generated/method_ids.rs', import.meta.url),
);
const runtimeBridgeMethodSource = readFileSync(runtimeBridgeMethodFile, 'utf-8');

test('sdk method ids include exact unary/stream codec coverage', () => {
  const codecMethodIds = uniqueSorted([
    ...Object.keys(RuntimeUnaryMethodCodecs),
    ...Object.keys(RuntimeStreamMethodCodecs),
  ]);
  assert.deepEqual(codecMethodIds, uniqueSorted(RuntimeAllowlistedMethodIds));
});

test('sdk allowlist matches RuntimeMethodIds flatten', () => {
  const denied = new Set(RuntimeMethodGroupDeniedMethodIds);
  assert.deepEqual(
    uniqueSorted(RuntimeAllowlistedMethodIds),
    sdkMethodIdValues().filter((methodId) => !denied.has(methodId)),
  );
});

test('method-group denied method ids are not callable codec entries', () => {
  const codecMethodIds = new Set([
    ...Object.keys(RuntimeUnaryMethodCodecs),
    ...Object.keys(RuntimeStreamMethodCodecs),
  ]);
  for (const methodId of RuntimeMethodGroupDeniedMethodIds) {
    assert.equal(isRuntimeMethodAllowlisted(methodId), false, `${methodId} must not be allowlisted`);
    assert.equal(codecMethodIds.has(methodId), false, `${methodId} must not have a codec`);
  }
});

test('RuntimeAccountService projection is admitted for local first-party custody', () => {
  const accountMethods = [
    RuntimeMethodIds.account.getAccountSessionStatus,
    RuntimeMethodIds.account.subscribeAccountSessionEvents,
    RuntimeMethodIds.account.beginLogin,
    RuntimeMethodIds.account.completeLogin,
    RuntimeMethodIds.account.getAccessToken,
    RuntimeMethodIds.account.refreshAccountSession,
    RuntimeMethodIds.account.logout,
    RuntimeMethodIds.account.switchAccount,
    RuntimeMethodIds.account.issueScopedAppBinding,
    RuntimeMethodIds.account.revokeScopedAppBinding,
    RuntimeMethodIds.account.issueWorkspaceBinding,
    RuntimeMethodIds.account.revokeWorkspaceBinding,
  ];
  const codecMethodIds = new Set([
    ...Object.keys(RuntimeUnaryMethodCodecs),
    ...Object.keys(RuntimeStreamMethodCodecs),
  ]);
  for (const methodId of accountMethods) {
    assert.equal(isRuntimeMethodAllowlisted(methodId), true, `${methodId} must be admitted`);
    assert.equal(codecMethodIds.has(methodId), true, `${methodId} must have a codec`);
  }
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
