// D-AIPC-014 / S-AICONF-008 — profile apply preview diff primitives.
//
// Exercises the SDK pure-logic surface that the Desktop host AIConfig service
// and the Nimi Kit apply-preview flow build the typed before→after preview on:
// `computeAIConfigDiff`, `computeAIConfigVersion`, and the apply materialization
// equivalence between preview and commit.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAIProfileToConfig,
  computeAIConfigDiff,
  computeAIConfigVersion,
  createEmptyAIConfig,
  type AIConfig,
  type AIProfile,
  type AIScopeRef,
} from '../../src/mod/runtime/index.js';

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const profile: AIProfile = {
  profileId: 'preview-profile',
  title: 'Preview Profile',
  description: '',
  tags: [],
  capabilities: {
    'text.generate': {
      binding: {
        source: 'cloud',
        connectorId: 'connector-a',
        model: 'model-a',
      },
    },
  },
};

test('computeAIConfigVersion is stable and order-insensitive', () => {
  const base = createEmptyAIConfig(scopeRef);
  const v1 = computeAIConfigVersion(base);
  const v2 = computeAIConfigVersion(createEmptyAIConfig(scopeRef));
  assert.equal(v1, v2);

  const reordered: AIConfig = {
    profileOrigin: null,
    capabilities: { selectedParams: {}, localProfileRefs: {}, selectedBindings: {} },
    scopeRef,
  };
  assert.equal(computeAIConfigVersion(reordered), v1);
});

test('computeAIConfigDiff reports identical for byte-equivalent configs', () => {
  const base = createEmptyAIConfig(scopeRef);
  const diff = computeAIConfigDiff(base, createEmptyAIConfig(scopeRef));
  assert.equal(diff.identical, true);
  assert.equal(diff.fields.length, 0);
});

test('computeAIConfigDiff with null before represents full creation', () => {
  const after = applyAIProfileToConfig(createEmptyAIConfig(scopeRef), profile);
  const diff = computeAIConfigDiff(null, after);
  assert.equal(diff.identical, false);
  // A first apply (no before config) materializes whole subtrees; the diff
  // reports them as additions of the top-level materialized fields.
  const capabilitiesField = diff.fields.find((entry) => entry.path === 'capabilities');
  assert.ok(capabilitiesField, 'capabilities subtree must be in the diff');
  assert.equal(capabilitiesField?.changeKind, 'added');
  const profileOriginField = diff.fields.find((entry) => entry.path === 'profileOrigin');
  assert.ok(profileOriginField, 'profileOrigin must be in the diff');
  assert.equal(profileOriginField?.changeKind, 'added');
});

test('computeAIConfigDiff drills into changed subtrees field by field', () => {
  const before = applyAIProfileToConfig(createEmptyAIConfig(scopeRef), profile);
  const changedProfile: AIProfile = {
    ...profile,
    capabilities: {
      'text.generate': {
        binding: { source: 'cloud', connectorId: 'connector-a', model: 'model-b' },
      },
    },
  };
  const after = applyAIProfileToConfig(before, changedProfile);
  const diff = computeAIConfigDiff(before, after);
  const modelField = diff.fields.find(
    (entry) => entry.path === 'capabilities.selectedBindings.text.generate.model',
  );
  assert.ok(modelField, 'changed binding model must drill to a leaf field');
  assert.equal(modelField?.changeKind, 'changed');
  assert.equal(modelField?.before, 'model-a');
  assert.equal(modelField?.after, 'model-b');
});

test('preview after equals commit after for the same profile + base (D-AIPC-014)', () => {
  const base = createEmptyAIConfig(scopeRef);
  // Two independent materializations of the same profile against the same base
  // must produce structurally equivalent capabilities — the overwrite is
  // deterministic. (profileOrigin.appliedAt is a stamp and is excluded here.)
  const previewAfter = applyAIProfileToConfig(base, profile);
  const commitAfter = applyAIProfileToConfig(base, profile);
  assert.deepEqual(previewAfter.capabilities, commitAfter.capabilities);
  assert.equal(previewAfter.profileOrigin?.profileId, commitAfter.profileOrigin?.profileId);
});

test('diff covers profileOrigin transition from null to a profile ref', () => {
  const before = createEmptyAIConfig(scopeRef);
  const after = applyAIProfileToConfig(before, profile);
  const diff = computeAIConfigDiff(before, after);
  // before.profileOrigin is null, after.profileOrigin is an object — the diff
  // reports the whole profileOrigin field as an addition.
  const originField = diff.fields.find((entry) => entry.path === 'profileOrigin');
  assert.ok(originField, 'profileOrigin must appear in the typed diff');
  // before.profileOrigin is explicit null (defined), so this is a 'changed'.
  assert.equal(originField?.changeKind, 'changed');
  assert.equal(originField?.before, null);
  assert.equal(
    (originField?.after as { profileId?: string } | null)?.profileId,
    'preview-profile',
  );
});
