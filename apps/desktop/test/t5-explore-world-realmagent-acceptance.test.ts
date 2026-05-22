import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  createEmptyDraft,
  draftIsSubmittable,
  type RealmAgentCreationMode,
} from '../src/shell/renderer/features/world/create-agent/realm-agent-creation-draft.js';
import {
  describeRealmAgentPrimaryAction,
  primaryActionForFriendState,
  resolveRealmAgentFriendState,
  type RealmAgentFriendState,
  type RealmAgentSocialProjection,
} from '../src/shell/renderer/features/explore/realm-agent-friend-state.js';

/**
 * T5-4 — Explore + World + RealmAgent lightweight creation: portfolio acceptance.
 *
 * Final wave of portfolio topic T5. Test + acceptance only — this file owns no
 * behavior; it proves the T5 portfolio gate over the surface delivered by
 * T5-0..T5-3:
 *   - Worlds and RealmAgents are discoverable in the Explore IA;
 *   - Add Friend creates the AgentFriend relation AND the idempotent LocalAgent
 *     projection (D-EXPL-007 dual effect);
 *   - the friend-state -> primary-action model has exactly four typed states;
 *   - the three lightweight creation modes each produce a reviewable draft
 *     before any Realm truth write (D-EXPL-008/010);
 *   - no ordinary World creation (D-EXPL-013);
 *   - no RealmAgent direct chat — T3's gate is not regressed (D-EXPL-006).
 *
 * E2E posture: a real WebdriverIO whole-product screenshot of Explore / World
 * detail / the creation review gate is not producible in the renderer-shell
 * test harness. Behavioral assertions over the real friend-state / draft
 * modules plus renderer-source assertions are the honest substitute; the
 * whole-product screenshot / E2E matrix is deferred to portfolio topic T11.
 */

function readRendererFile(relativePath: string): string {
  return fs.readFileSync(
    path.join(import.meta.dirname, '../src/shell/renderer', relativePath),
    'utf8',
  );
}

const exploreViewSource = readRendererFile('features/explore/explore-view.tsx');
const explorePanelSource = readRendererFile('features/explore/explore-panel.tsx');
const exploreSectionNavSource = readRendererFile('features/explore/explore-section-nav.tsx');
const mainLayoutViewSource = readRendererFile('app-shell/layouts/main-layout-view.tsx');
const mainLayoutTitlebarContentSource = readRendererFile('app-shell/layouts/main-layout-titlebar-content.tsx');
const worldDetailSource = readRendererFile('features/world/world-detail.tsx');
const worldDetailTemplateSource = readRendererFile('features/world/world-detail-template.tsx');
const friendActionsSource = readRendererFile('features/explore/realm-agent-friend-actions.ts');
const agentDetailPanelSource = readRendererFile('features/agent-detail/agent-detail-panel.tsx');
const reviewPanelSource = readRendererFile(
  'features/world/create-agent/create-agent-review-panel.tsx',
);
const draftSubmitSource = readRendererFile(
  'features/world/create-agent/realm-agent-draft-submit.ts',
);
const modePanelsSource = readRendererFile(
  'features/world/create-agent/create-agent-mode-panels.tsx',
);

// ---------------------------------------------------------------------------
// Gate 1 — Worlds and RealmAgents are discoverable in the three-section IA
// ---------------------------------------------------------------------------

test('T5 acceptance: Explore exposes the three-section discovery IA with Worlds + RealmAgents', () => {
  // D-EXPL-002 — Worlds / Agents / Activity are mounted.
  assert.match(exploreViewSource, /data-testid="explore-worlds-section"/);
  assert.match(exploreViewSource, /data-testid="explore-agents-section"/);
  assert.match(exploreViewSource, /data-testid="explore-activity-section"/);
  assert.doesNotMatch(exploreViewSource, /ExploreCreateAgentSection/);
  assert.match(exploreSectionNavSource, /EXPLORE_SECTION_IDS:\s*readonly ExploreSectionId\[\]\s*=\s*\[\s*'worlds',\s*'agents',\s*'activity'/);
  assert.match(mainLayoutViewSource, /<MainLayoutTitlebarContent/);
  assert.match(mainLayoutTitlebarContentSource, /<ExploreSectionNav[\s\S]*active=\{props\.exploreActiveSection\}[\s\S]*variant="topbar"/);

  // Worlds catalog is folded into Explore as a full catalog (T5-1), and the
  // Agents section is a full discovery grid — not a truncated carousel.
  assert.match(exploreViewSource, /WorldCatalogContent/);
  assert.match(exploreViewSource, /<AgentRecommendationCard/);
  assert.match(explorePanelSource, /dataSync\.loadExploreAgents/);
  assert.doesNotMatch(explorePanelSource, /TOP_AGENTS_COUNT/);
});

// ---------------------------------------------------------------------------
// Gate 2 — Add Friend dual effect: AgentFriend relation + idempotent LocalAgent
// ---------------------------------------------------------------------------

test('T5 acceptance: Add Friend creates the AgentFriend relation AND the idempotent LocalAgent projection', () => {
  // D-EXPL-007 dual effect. Effect 1 — `requestOrAcceptFriend` creates the
  // AgentFriend Realm social relation. Effect 2 — `ensureRuntimeAgentExists`
  // ensures the one account-scoped LocalAgent projection at Add Friend time
  // (K-AGCORE-139 idempotent), not deferred to a lazy first chat-open.
  const addFriendBody = friendActionsSource.slice(
    friendActionsSource.indexOf('export async function addRealmAgentFriend'),
    friendActionsSource.indexOf('export async function openRealmAgentLocalChat'),
  );
  assert.match(addFriendBody, /dataSync\.requestOrAcceptFriend\(/);
  assert.match(addFriendBody, /ensureRuntimeAgentExists\(localAgentTarget\)/);

  // The LocalAgent projection is keyed by the deterministic owner-scoped ref —
  // a repeated Add Friend / retry resolves the same LocalAgent (idempotent).
  assert.match(friendActionsSource, /localAgentRef: `local-agent:\$\{ownerUserId\}:\$\{realmAgentId\}`/);
  // Add Friend never mutates RealmAgent canonical truth — it only forks a
  // Friendship row + an owner-scoped LocalAgent projection.
  assert.doesNotMatch(addFriendBody, /updateAgent|patchAgent|mutateRealmAgent/);
});

// ---------------------------------------------------------------------------
// Gate 3 — friend-state -> primary-action: exactly four typed states
// ---------------------------------------------------------------------------

test('T5 acceptance: the friend-state model resolves exactly four states to their primary actions', () => {
  // D-EXPL-005/006 — four typed states, each with a fixed primary action.
  const expected: Record<RealmAgentFriendState, string> = {
    not_friend: 'add_friend',
    pending: 'pending',
    friend: 'open_agent_chat',
    limit_reached: 'manage_agent_friends',
  };
  for (const [state, action] of Object.entries(expected)) {
    assert.equal(primaryActionForFriendState(state as RealmAgentFriendState), action);
    const described = describeRealmAgentPrimaryAction(state as RealmAgentFriendState);
    assert.equal(described.state, state);
    assert.equal(described.action, action);
    // `pending` is the only non-actionable state (no duplicate friend request).
    assert.equal(described.disabled, state === 'pending');
  }
});

test('T5 acceptance: friend-state is a deterministic projection of Realm social truth', () => {
  // AgentFriend membership wins; an outstanding sent request is `pending`;
  // a quota-blocked account with neither is `limit_reached`; otherwise
  // `not_friend`. No generic `unavailable` collapse — the typed distinction
  // is preserved per D-EXPL-006.
  const canAddProjection: RealmAgentSocialProjection = {
    friendIds: new Set(['agent-friend']),
    pendingSentIds: new Set(['agent-pending']),
    limit: { status: 'available', used: 1, limit: 10, canAdd: true, reason: null },
  };
  assert.equal(resolveRealmAgentFriendState('agent-friend', canAddProjection), 'friend');
  assert.equal(resolveRealmAgentFriendState('agent-pending', canAddProjection), 'pending');
  assert.equal(resolveRealmAgentFriendState('agent-new', canAddProjection), 'not_friend');

  const quotaBlocked: RealmAgentSocialProjection = {
    friendIds: new Set(['agent-friend']),
    pendingSentIds: new Set(['agent-pending']),
    limit: { status: 'available', used: 10, limit: 10, canAdd: false, reason: 'limit reached' },
  };
  // Friend / pending still win over the quota block — only an otherwise
  // `not_friend` agent collapses to `limit_reached`.
  assert.equal(resolveRealmAgentFriendState('agent-friend', quotaBlocked), 'friend');
  assert.equal(resolveRealmAgentFriendState('agent-pending', quotaBlocked), 'pending');
  assert.equal(resolveRealmAgentFriendState('agent-new', quotaBlocked), 'limit_reached');

  // A missing projection / empty id fail closed to `not_friend`.
  assert.equal(resolveRealmAgentFriendState('agent-new', null), 'not_friend');
  assert.equal(resolveRealmAgentFriendState('', canAddProjection), 'not_friend');
});

// ---------------------------------------------------------------------------
// Gate 4 — three lightweight creation modes -> reviewable draft before write
// ---------------------------------------------------------------------------

test('T5 acceptance: the three lightweight creation modes each produce a reviewable draft', () => {
  // D-EXPL-008 — exactly three admitted creation modes; each converges on a
  // draft. `createEmptyDraft` accepts every mode and seeds an un-submittable
  // draft (handle + concept still required) — i.e. the draft exists and is
  // reviewable before it can be confirmed into Realm truth.
  const modes: readonly RealmAgentCreationMode[] = [
    'manual_quick_create',
    'character_card_import',
    'ai_assisted_generation',
  ];
  for (const mode of modes) {
    const draft = createEmptyDraft('world-acceptance', mode);
    assert.equal(draft.mode, mode);
    assert.equal(draft.worldId, 'world-acceptance');
    // Fresh draft is not yet submittable — the review gate has real content to
    // gate on, it is never an empty pass-through.
    assert.equal(draftIsSubmittable(draft), false);
  }

  // The mode-select panel admits exactly those three modes — no fourth path.
  assert.match(modePanelsSource, /mode: 'manual_quick_create'/);
  assert.match(modePanelsSource, /mode: 'character_card_import'/);
  assert.match(modePanelsSource, /mode: 'ai_assisted_generation'/);
});

test('T5 acceptance: the review gate stands before the single Realm truth write (D-EXPL-010)', () => {
  // The review panel is the Nimi-side gate: it states nothing is written until
  // confirm, and partitions draft fields into written / not-written.
  assert.match(reviewPanelSource, /Nothing has been written to \{\{worldName\}\} yet/);
  assert.match(reviewPanelSource, /review\.gateTitle/);
  assert.match(reviewPanelSource, /REALM_WRITTEN_DRAFT_FIELDS/);
  assert.match(reviewPanelSource, /REALM_UNWRITTEN_DRAFT_FIELDS/);

  // The single Realm write runs only from the confirm mutation in world-detail
  // and only behind the World admission guard.
  assert.match(worldDetailSource, /const createAgentMutation = useMutation\(/);
  assert.match(
    worldDetailSource,
    /onCreateAgent=\{createAgentAdmitted \? \(input\) => createAgentMutation\.mutate\(input\) : undefined\}/,
  );
  // The draft-submit module is the lone bridge to the Realm `createAgent` call.
  assert.match(draftSubmitSource, /buildRealmAgentWritePayload/);
});

// ---------------------------------------------------------------------------
// Gate 5 — no ordinary World creation (D-EXPL-013)
// ---------------------------------------------------------------------------

test('T5 acceptance: there is no ordinary World-creation entry point', () => {
  // D-EXPL-013 — ordinary users create lightweight RealmAgents, never Worlds.
  // No Explore / World-detail surface exposes a create-World affordance.
  assert.doesNotMatch(exploreViewSource, /onCreateWorld|CreateWorldButton|createWorld\(/);
  assert.doesNotMatch(explorePanelSource, /onCreateWorld|createWorld\(/);
  assert.doesNotMatch(worldDetailSource, /onCreateWorld|createWorld\(/);
  assert.doesNotMatch(worldDetailTemplateSource, /onCreateWorld/);
});

// ---------------------------------------------------------------------------
// Gate 6 — no RealmAgent direct chat — re-prove T3's gate is not regressed
// ---------------------------------------------------------------------------

test('T5 acceptance: no RealmAgent direct chat — World detail offers View profile only', () => {
  // D-EXPL-006 / T3 — a RealmAgent in a World is not chat-reachable from World
  // detail. T5-2 removed `handleChatAgent` / `handleVoiceAgent` and the World
  // agent-card chat/voice affordances; only View profile remains.
  assert.doesNotMatch(worldDetailSource, /const handleChatAgent/);
  assert.doesNotMatch(worldDetailSource, /const handleVoiceAgent/);
  assert.doesNotMatch(worldDetailSource, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(worldDetailSource, /launchAgentVoiceFromDisplay/);
  assert.match(worldDetailSource, /const handleViewAgent = \(agent: WorldAgent\) => \{/);
  assert.match(worldDetailSource, /onViewAgent=\{handleViewAgent\}/);
  // A real prop declaration is the `onXAgent?: (...)` typed form — the
  // template carries no such chat/voice prop (the only textual mention is a
  // comment explaining the deliberate absence).
  assert.doesNotMatch(worldDetailTemplateSource, /onChatAgent\?: \(/);
  assert.doesNotMatch(worldDetailTemplateSource, /onVoiceAgent\?: \(/);
});

test('T5 acceptance: RealmAgent chat is reachable only via friend -> Open Agent Chat -> LocalAgent Chat', () => {
  // The `friend` state's primary action is `open_agent_chat`, and the only
  // chat entry point routes through `openRealmAgentLocalChat`, which
  // materializes the deterministic LocalAgent ref and delegates to the shared
  // LocalAgent launcher. No surface constructs a chat session from a bare
  // RealmAgent id.
  assert.equal(primaryActionForFriendState('friend'), 'open_agent_chat');
  assert.match(friendActionsSource, /export async function openRealmAgentLocalChat/);
  assert.match(friendActionsSource, /launchAgentConversationFromDisplay\(\{/);

  // Agent Detail reaches chat only through that LocalAgent path — never a
  // direct-RealmAgent launcher.
  assert.match(agentDetailPanelSource, /openRealmAgentLocalChat/);
  assert.doesNotMatch(agentDetailPanelSource, /launchRealmAgentChat|launchRealmAgentConversation/);
  assert.doesNotMatch(friendActionsSource, /launchRealmAgentChat|launchRealmAgentConversation/);
});
