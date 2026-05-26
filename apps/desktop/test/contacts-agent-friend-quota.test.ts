import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

// T6.3 — Agent-friend quota authority alignment (D-CONTACTS-006).
// The agent-friend limit is a SINGLE backend-owned baseline value with no
// subscription-tier coupling. The Desktop sources the limit from the backend
// projection (`getMyAgentFriendLimit`) and MUST NOT hardcode it; when the
// quota projection is unavailable it fails closed with a typed state and no
// renderer-guessed ceiling.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoSrc = resolve(__dirname, '../src');

function read(relativePath: string): string {
  return readFileSync(resolve(repoSrc, relativePath), 'utf8');
}

test('agent-friend-limit carries no hardcoded tier table or per-tier limit numbers', () => {
  const source = read('shell/renderer/features/relationship/agent-friend-limit.ts');
  // No per-tier quota table.
  assert.doesNotMatch(source, /LIMIT_BY_TIER/);
  // No subscription-tier literals as a quota source.
  assert.doesNotMatch(source, /'FREE'|'PRO'|'MAX'/);
  // No renderer-hardcoded limit numbers.
  assert.doesNotMatch(source, /\b(?:10|20|50)\b/);
  // No tier-default fallback comment / FREE-tier guessed ceiling.
  assert.doesNotMatch(source, /回退 FREE|fallback.*FREE/i);
});

test('agent-friend-limit sources the limit from the backend projection', () => {
  const source = read('shell/renderer/features/relationship/agent-friend-limit.ts');
  // The limit is read from the backend agent-friend-limit projection,
  // not from the subscription status.
  assert.match(source, /dataSync\.loadAgentFriendLimit\(\)/);
  assert.doesNotMatch(source, /loadSubscriptionStatus/);
});

test('agent-friend-limit fails closed with a typed unavailable state', () => {
  const source = read('shell/renderer/features/relationship/agent-friend-limit.ts');
  // A typed `unavailable` arm exists, and it is non-addable (fail-closed).
  assert.match(source, /status: 'unavailable'/);
  assert.match(source, /canAdd: false/);
  // The unavailable state surfaces a typed reason, no guessed numeric ceiling.
  assert.match(source, /agentFriendLimitUnavailable/);
});

test('the AgentFriendLimit type carries no subscription-tier field', () => {
  const source = read('shell/renderer/features/relationship/agent-friend-limit.ts');
  // The type declaration spans from `export type AgentFriendLimit =` up to the
  // `resolveAgentFriendLimit` function that follows it.
  const typeMatch = source.match(/export type AgentFriendLimit =[\s\S]*?(?=export async function)/);
  assert.ok(typeMatch, 'AgentFriendLimit type must be declared');
  const typeDecl = typeMatch[0];
  assert.doesNotMatch(typeDecl, /\btier\b/);
  // The type must NOT carry a subscription-status field either (decoupled).
  assert.doesNotMatch(typeDecl, /'ACTIVE'|'CANCELED'|'PAST_DUE'|'PAUSED'/);
});

test('data-sync exposes a loadAgentFriendLimit projection action', () => {
  const flowSource = read('runtime/data-sync/flows/profile-flow-social.ts');
  assert.match(flowSource, /MeService\.getMyAgentFriendLimit\(\)/);
  const facadeSource = read('runtime/data-sync/facade.ts');
  assert.match(facadeSource, /loadAgentFriendLimit\(\)/);
});
