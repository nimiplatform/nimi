import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SAFETY_PROFILE_MAX_BYTES,
  SAFETY_PROFILE_VOCABULARY,
  diffSafetyProfiles,
  isCanonicalSafetyProfile,
  normalizeSafetyProfile,
} from '../lib/app-safety-profile.mjs';
import { SUPPORTED_DEPENDENCY_COMBINATIONS, defaultDependencyCombination, resolveDependencyCombination } from '../lib/app-dependency-combinations.mjs';
import { readFileSync } from 'node:fs';

const versions = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).nimiScaffoldVersions;

export function textAiProfile() {
  return {
    intended_audience: 'general',
    content_descriptors: [],
    ai: {
      direct_interaction: true,
      interaction_notice: 'absent',
      risk_features: [],
      subject_notice: 'not-applicable',
      outputs: [{ modality: 'text', exposure: 'exportable', publication_control: 'not-applicable', in_product_notice: 'absent', export_visible_marking: 'absent', machine_readable_marking: 'absent' }],
    },
    data_practices: { publisher_direct_external_network: false, telemetry: [], third_party_account: 'none', user_content_sharing: 'none', commercial_features: [], sensitive_data_categories: [] },
    high_impact_decision_uses: [],
  };
}

test('explicit non-AI, text-AI and multi-output declarations normalize to one canonical form', () => {
  const nonAi = { ...textAiProfile(), ai: { direct_interaction: false, interaction_notice: 'not-applicable', risk_features: [], subject_notice: 'not-applicable', outputs: [] } };
  assert.deepEqual(normalizeSafetyProfile(nonAi).ai.outputs, []);
  const canonical = normalizeSafetyProfile(textAiProfile());
  assert.deepEqual(Object.keys(canonical), ['ai', 'content_descriptors', 'data_practices', 'high_impact_decision_uses', 'intended_audience']);
  assert.ok(isCanonicalSafetyProfile(canonical));
  assert.equal(isCanonicalSafetyProfile(textAiProfile()), false, 'author key order is not the canonical serialization');

  const multi = textAiProfile();
  multi.content_descriptors = ['violence', 'sexual-content', 'violence'.replace('violence', 'strong-language')];
  multi.ai.risk_features = ['emotion-recognition'];
  multi.ai.subject_notice = 'present';
  multi.ai.outputs = [
    { modality: 'image', exposure: 'publishable', publication_control: 'user-confirmed', in_product_notice: 'present', export_visible_marking: 'present', machine_readable_marking: 'absent' },
    { modality: 'text', exposure: 'in-app-only', publication_control: 'not-applicable', in_product_notice: 'absent', export_visible_marking: 'not-applicable', machine_readable_marking: 'absent' },
  ];
  const normalized = normalizeSafetyProfile(multi);
  assert.deepEqual(normalized.content_descriptors, ['sexual-content', 'violence', 'strong-language'], 'lists use the closed vocabulary order');
  assert.deepEqual(normalized.ai.outputs.map((entry) => entry.modality), ['text', 'image'], 'outputs use modality vocabulary order');
  assert.equal(JSON.stringify(normalizeSafetyProfile(normalized)), JSON.stringify(normalized), 'normalization is idempotent');
});

test('unknown keys, invalid values, duplicates and structural contradictions name the offending field', () => {
  const cases = [
    [(p) => { p.extra = true; }, /safety_profile\.extra is not a supported/u],
    [(p) => { p.ai.model_name = 'x'; }, /safety_profile\.ai\.model_name is not a supported/u],
    [(p) => { delete p.high_impact_decision_uses; }, /high_impact_decision_uses is required/u],
    [(p) => { p.intended_audience = 'everyone'; }, /intended_audience must be one of children, general, teen, adult/u],
    [(p) => { p.content_descriptors = ['violence', 'violence']; }, /content_descriptors must not repeat violence/u],
    [(p) => { p.content_descriptors = 'violence'; }, /content_descriptors must be an explicit list/u],
    [(p) => { p.ai.direct_interaction = 'yes'; }, /direct_interaction must be true or false/u],
    [(p) => { p.ai.direct_interaction = false; }, /interaction_notice must be not-applicable when direct_interaction is false/u],
    [(p) => { p.ai.interaction_notice = 'not-applicable'; }, /interaction_notice must be present or absent when direct_interaction is true/u],
    [(p) => { p.ai.subject_notice = 'present'; }, /subject_notice must be not-applicable without emotion-recognition/u],
    [(p) => { p.ai.risk_features = ['biometric-categorization']; }, /subject_notice must be present or absent when emotion-recognition or biometric-categorization/u],
    [(p) => { p.ai.outputs.push({ ...p.ai.outputs[0] }); }, /outputs must declare at most one entry for text/u],
    [(p) => { p.ai.outputs[0].exposure = 'publishable'; }, /publication_control must be user-confirmed or automatic for publishable/u],
    [(p) => { p.ai.outputs[0].publication_control = 'automatic'; }, /publication_control must be not-applicable unless exposure is publishable/u],
    [(p) => { p.ai.outputs[0].exposure = 'in-app-only'; }, /export_visible_marking must be not-applicable for in-app-only/u],
    [(p) => { p.ai.outputs[0].export_visible_marking = 'not-applicable'; }, /export_visible_marking must be present or absent for exportable/u],
    [(p) => { p.ai.outputs[0].machine_readable_marking = 'not-applicable'; }, /machine_readable_marking must be one of present, absent/u],
    [(p) => { p.data_practices.third_party_account = 'maybe'; }, /third_party_account must be one of none, optional, required/u],
    [(p) => { p.high_impact_decision_uses = ['health-topic']; }, /high_impact_decision_uses must be one of/u],
  ];
  for (const [mutate, expected] of cases) {
    const profile = textAiProfile();
    mutate(profile);
    assert.throws(() => normalizeSafetyProfile(profile), expected);
  }
  assert.throws(() => normalizeSafetyProfile(undefined), /safety_profile must be an object/u);
  assert.throws(() => normalizeSafetyProfile([]), /safety_profile must be an object/u);
  assert.ok(SAFETY_PROFILE_MAX_BYTES <= 1024 * 1024);
  assert.ok(SAFETY_PROFILE_VOCABULARY.high_impact_decision_uses.includes('medical-diagnosis-treatment'));
});

test('absent notices and markings are legitimate values and voice capabilities imply no audio output', () => {
  const profile = textAiProfile();
  profile.ai.interaction_notice = 'absent';
  profile.ai.outputs[0].in_product_notice = 'absent';
  profile.ai.outputs[0].export_visible_marking = 'absent';
  profile.ai.outputs[0].machine_readable_marking = 'absent';
  assert.equal(normalizeSafetyProfile(profile).ai.outputs[0].export_visible_marking, 'absent');
  // The vocabulary does not know capability names; nothing here consults them.
  assert.equal(Object.hasOwn(SAFETY_PROFILE_VOCABULARY, 'capability_contract_refs'), false);
});

test('declaration diff reports changed fields and undeclared sides only', () => {
  const before = normalizeSafetyProfile(textAiProfile());
  const changed = textAiProfile();
  changed.content_descriptors = ['violence'];
  changed.ai.outputs[0].export_visible_marking = 'present';
  const after = normalizeSafetyProfile(changed);
  assert.deepEqual(diffSafetyProfiles(before, after), [
    { field: 'ai.outputs[text].export_visible_marking', before: 'absent', after: 'present' },
    { field: 'content_descriptors', before: '[]', after: 'violence' },
  ]);
  assert.deepEqual(diffSafetyProfiles(before, before), []);
  assert.deepEqual(diffSafetyProfiles(undefined, undefined), []);
  const fromUndeclared = diffSafetyProfiles(undefined, before);
  assert.ok(fromUndeclared.every((entry) => entry.before === 'undeclared'));
  assert.ok(fromUndeclared.some((entry) => entry.field === 'intended_audience' && entry.after === 'general'));
});

test('supported dependency combinations are exact pairings and the tool default is one of them', () => {
  const fallback = defaultDependencyCombination(versions);
  assert.equal(fallback.source, 'default');
  assert.ok(SUPPORTED_DEPENDENCY_COMBINATIONS.some((entry) => entry.sdkVersion === fallback.sdkVersion && entry.kitVersion === fallback.kitVersion && entry.nimiShellTauriVersion === fallback.nimiShellTauriVersion), 'the shipped default matrix is a listed combination');
  const pairs = SUPPORTED_DEPENDENCY_COMBINATIONS.map((entry) => `${entry.sdkVersion}|${entry.kitVersion}`);
  assert.equal(new Set(pairs).size, pairs.length);
  // Existing first-party Apps ship on SDK ^0.11.0 with Kit ^0.7.0.
  const existing = resolveDependencyCombination({ dependencies: { '@nimiplatform/sdk': '^0.11.0', '@nimiplatform/kit': '^0.7.0' } }, versions);
  assert.deepEqual({ ...existing }, { sdkVersion: '^0.11.0', kitVersion: '^0.7.0', nimiShellTauriVersion: '0.3.0', source: 'existing' });
  assert.equal(resolveDependencyCombination({ dependencies: { '@nimiplatform/sdk': fallback.sdkVersion, '@nimiplatform/kit': fallback.kitVersion } }, versions).source, 'default');
  for (const local of [
    { '@nimiplatform/sdk': 'link:../nimi/sdks/typescript', '@nimiplatform/kit': 'workspace:*' },
    { '@nimiplatform/sdk': '^0.11.0' },
    {},
  ]) {
    assert.equal(resolveDependencyCombination({ dependencies: local }, versions).source, 'default', 'local, workspace or partial specs normalize to the tool default');
  }
  assert.throws(
    () => resolveDependencyCombination({ dependencies: { '@nimiplatform/sdk': '^0.11.0', '@nimiplatform/kit': fallback.kitVersion } }, versions),
    (error) => error.message.startsWith(`Unsupported SDK/Kit combination: @nimiplatform/sdk@^0.11.0 with @nimiplatform/kit@${fallback.kitVersion}. Supported combinations:`),
  );
  assert.throws(() => resolveDependencyCombination({ dependencies: { '@nimiplatform/sdk': '^0.9.0', '@nimiplatform/kit': '^0.5.0' } }, versions), /Unsupported SDK\/Kit combination/u);
});
