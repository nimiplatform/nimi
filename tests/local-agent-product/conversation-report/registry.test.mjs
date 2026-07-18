import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readConversationScenarioRegistry,
  resolveConversationScenarioRegistry,
  validateConversationScenarioRegistry,
} from './registry.mjs';

const forbiddenOwnershipTerms = [
  'characterConversationId',
  'personaConversationId',
  'characterThread',
  'personaThread',
  'Character conversation',
  'Persona conversation',
  'three conversation lines',
];

test('baseline registry declares two Runtime-owned LocalAgent streams and one lifecycle timeline', async () => {
  const registry = readConversationScenarioRegistry();
  assert.deepEqual(validateConversationScenarioRegistry(registry), []);
  assert.equal(registry.schema_version, 'nimi.local-agent-conversation-scenarios/v1');
  assert.equal(registry.scenarios.length, 1);

  const baseline = registry.scenarios[0];
  assert.equal(baseline.scenario_id, 'conversation-report-baseline');
  assert.equal(baseline.streams.length, 2);
  assert.equal(baseline.lifecycle_timeline.kind, 'cross_surface_cross_agent_lifecycle_timeline');
  assert.equal(Object.hasOwn(baseline.lifecycle_timeline, 'turns'), false,
    'the lifecycle timeline is not a third conversation stream');
  assert.deepEqual(
    baseline.streams.map((stream) => stream.source_provenance.source_kind).sort(),
    ['personaCharacter', 'worldCharacter'],
  );
  assert.equal(new Set(baseline.streams.map((stream) => stream.local_agent_alias)).size, 2);
  assert.equal(new Set(baseline.streams.map((stream) => stream.conversation_alias)).size, 2);
  assert.equal(baseline.environment.materializations.worldCharacter, 1);
  assert.equal(baseline.environment.materializations.personaCharacter, 1);
  assert.deepEqual(baseline.environment.start_limits, {
    provider: 1,
    realm: 1,
    runtime: 2,
    desktop: 1,
    zhiyu: 1,
  });

  for (const stream of baseline.streams) {
    assert.equal(stream.runtime_resolved_identity.local_agent_ref, true);
    assert.equal(stream.runtime_resolved_identity.conversation_anchor_id, true);
    assert.equal(Object.hasOwn(stream, 'localAgentRef'), false);
    assert.equal(Object.hasOwn(stream, 'conversationAnchorId'), false);
    assert.ok(stream.turns.length >= 9);
    assert.deepEqual(stream.turns.map((turn) => turn.order), stream.turns.map((_, index) => index + 1));
    assert.equal(stream.turns.every((turn) => ['desktop', 'zhiyu'].includes(turn.surface)), true);
    assert.equal(stream.turns.every((turn) => turn.continuation_required === true), true);
    assert.equal(stream.turns.every((turn) => turn.capture_requirements.includes('context_summary')
      && turn.capture_requirements.includes('memory_snapshot')
      && turn.capture_requirements.includes('relationship_snapshot')
      && turn.capture_requirements.includes('presentation_output')), true);
    assert.equal(stream.turns.every((turn) => turn.source_input_refs.length > 0), true,
      'every prompt must identify the fixture/source inputs that justify it');
  }

  const serialized = JSON.stringify(registry);
  for (const forbidden of forbiddenOwnershipTerms) assert.equal(serialized.includes(forbidden), false, `${forbidden} is forbidden`);
});

test('registry resolves every prompt from admitted fixture truth and explicit scenario inputs', async () => {
  const resolved = await resolveConversationScenarioRegistry(readConversationScenarioRegistry());
  assert.deepEqual(validateConversationScenarioRegistry(resolved, { resolved: true }), []);
  for (const stream of resolved.scenarios[0].streams) {
    assert.ok(stream.source_provenance.source_ref.id);
    assert.match(stream.source_provenance.source_ref.sourceHash, /^[a-f0-9]{64}$/u);
    assert.equal(stream.source_provenance.expected_snapshot.runtime_resolved, true);
    for (const turn of stream.turns) {
      assert.ok(turn.user_message.trim());
      assert.doesNotMatch(turn.user_message, /\{\{[^}]+\}\}/u, `${turn.turn_id} has an unresolved source token`);
    }
  }
});

test('registry maps all 24 I8 observation points without semantic verdict fields', async () => {
  const registry = await resolveConversationScenarioRegistry(readConversationScenarioRegistry());
  const scenario = registry.scenarios[0];
  const mappings = [
    ...scenario.streams.flatMap((stream) => stream.turns.flatMap((turn) => turn.observation_point_ids)),
    ...scenario.lifecycle_timeline.events.flatMap((event) => event.observation_point_ids),
    ...scenario.report_sections.flatMap((section) => section.observation_point_ids),
  ];
  assert.equal(new Set(mappings).size, 24);
  assert.equal(mappings.every((pointId) => /^P-/u.test(pointId)), true);
  assert.doesNotMatch(JSON.stringify(registry), /minimum_passes|average_score|style_score|semantic_verdict|automatic_accepted/iu);
  assert.equal(scenario.review_dimensions.every((dimension) => dimension.review_status === 'unreviewed'
    && dimension.notes === ''), true);
  const referencedReviewDimensions = new Set(scenario.streams.flatMap((stream) => stream.turns
    .flatMap((turn) => turn.human_review_dimensions)));
  assert.deepEqual(
    [...referencedReviewDimensions].sort(),
    scenario.review_dimensions.map((dimension) => dimension.dimension_id).sort(),
  );
});

test('relationship recall and cross-agent probes never repeat the protected canary in user input', async () => {
  const scenario = (await resolveConversationScenarioRegistry(readConversationScenarioRegistry())).scenarios[0];
  const byAlias = new Map(scenario.streams.map((stream) => [stream.local_agent_alias, stream]));
  const streamA = byAlias.get('local-agent-a');
  const streamB = byAlias.get('local-agent-b');
  for (const stream of [streamA, streamB]) {
    const ownCanary = stream.scenario_inputs.preferred_name;
    for (const turn of stream.turns.filter((row) => row.privacy_probe === 'relationship_recall')) {
      assert.equal(turn.user_message.includes(ownCanary), false);
    }
  }
  for (const turn of scenario.streams.flatMap((stream) => stream.turns).filter((row) => row.privacy_probe === 'cross_agent_isolation')) {
    for (const canary of turn.forbidden_response_canaries) assert.equal(turn.user_message.includes(canary), false);
  }
});
