import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import {
  compileFirstPartyProtectedRuntimeProfiles,
  SOURCE_RELATIVE,
  RPC_SOURCE_RELATIVE,
} from './lib/first-party-protected-runtime-profile-compiler.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sourceText = fs.readFileSync(path.join(repoRoot, SOURCE_RELATIVE), 'utf8');
const rpcSourceText = fs.readFileSync(path.join(repoRoot, RPC_SOURCE_RELATIVE), 'utf8');

function mutate(mutator) {
  const value = YAML.parse(sourceText);
  mutator(value);
  return YAML.stringify(value);
}

function compile(source = sourceText) {
  return compileFirstPartyProtectedRuntimeProfiles({ repoRoot, sourceText: source, rpcSourceText });
}

function rejectsMutation(mutator, pattern) {
  assert.throws(() => compile(mutate(mutator)), pattern);
}

test('compiles all protected Runtime profiles and current generated consumers', () => {
  const { model, outputs } = compile();
  const profiles = new Map(model.profiles.map((profile) => [profile.profileId, profile]));
  for (const profileId of [
    'desktop_machine_product_v1',
    'desktop_account_product_v1',
    'bundled_avatar_v1',
  ]) {
    assert.ok(profiles.get(profileId)?.methods.length > 0, `${profileId} must retain protected Runtime methods`);
  }
  for (const relative of [
    'runtime/internal/bundledavatar/profile_generated.go',
    'kit/shell/electron/src/main/bundled-avatar-profile.generated.ts',
    'sdks/typescript/runtime/bundled-avatar-profile.generated.ts',
  ]) {
    const output = outputs.get(relative);
    assert.match(output, /nimi\.avatar/u);
    assert.match(output, /avatar-native-host/u);
    assert.doesNotMatch(output, /nimi\.avatar\.desktop-supervised|desktop-avatar-host/u);
  }
});

test('rejects duplicate and wildcard methods', () => {
  rejectsMutation((value) => value.profiles[0].methods.push({ ...value.profiles[0].methods[0] }), /duplicate method/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].method_id = '/nimi.runtime.v1.RuntimeLocalService/*'; }, /wildcard method id/u);
});

test('rejects unknown fields, RPCs, references, and kind mismatches', () => {
  rejectsMutation((value) => { value.profiles[0].unexpected = true; }, /unknown field/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].method_id = '/nimi.runtime.v1.RuntimeLocalService/DoesNotExist'; }, /unknown RPC method/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].intent_refs = ['missing_intent']; }, /unknown intent_ref/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].kind = 'server_stream'; }, /RPC kind mismatch/u);
});

test('rejects missing intent, postcondition, negative-test, and Avatar capability closure', () => {
  rejectsMutation((value) => { value.profiles[0].methods[0].intent_refs = []; }, /intent_refs must be a non-empty/u);
  rejectsMutation((value) => { value.intents.product_control.owner_postcondition_refs = []; }, /owner_postcondition_refs must be a non-empty/u);
  rejectsMutation((value) => { value.profiles[0].negative_test_ref = 'missing'; }, /unknown negative_test_ref/u);
  rejectsMutation((value) => { delete value.profiles[2].methods[0].capability; }, /capability must be a non-empty/u);
});

test('rejects transport mapping drift and desktop-coupled Avatar fields', () => {
  rejectsMutation((value) => { value.physical_endpoint_binding = 'desktop_control'; }, /physical_endpoint_binding must be verified_platform_transport/u);
  rejectsMutation((value) => { value.logical_transport_class_by_profile.bundled_avatar_v1 = 'desktop_control'; }, /logical transport class mismatch/u);
  rejectsMutation((value) => { value.profiles[2].logical_transport_class = 'desktop_control'; }, /logical_transport_class must match its profile mapping/u);
  for (const field of [
    'desktop_account_control_inheritance',
    'open_desktop_session_requirement',
    'live_desktop_process_requirement',
  ]) {
    rejectsMutation((value) => { value.profiles[2][field] = 'required'; }, new RegExp(`${field} must be forbidden`, 'u'));
  }
});
