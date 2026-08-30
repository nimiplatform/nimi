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
  ]) {
    const output = outputs.get(relative);
    assert.match(output, /nimi\.avatar/u);
    assert.match(output, /avatar-native-host/u);
    assert.doesNotMatch(output, /nimi\.avatar\.desktop-supervised|desktop-avatar-host/u);
  }
});

test('keeps raw Avatar Host target methods in native profiles and out of SDK typed groups', () => {
  const { model, outputs } = compile();
  const nativeOutput = outputs.get(
    'kit/shell/electron/src/main/first-party-protected-runtime-profiles.generated.ts',
  );
  const sdkOutput = outputs.get(
    'sdks/typescript/runtime/first-party-protected-runtime-profiles.generated.ts',
  );
  const profiles = new Map(model.profiles.map((profile) => [profile.profileId, profile]));
  const avatarMethods = new Set(
    profiles.get('bundled_avatar_v1')?.methods.map((method) => method.methodId),
  );
  const resolve = '/nimi.runtime.v1.RuntimeAgentService/ResolveLocalAppAvatarHostTarget';
  const revalidate = '/nimi.runtime.v1.RuntimeAgentService/RevalidateLocalAppAvatarHostTarget';

  assert.equal(avatarMethods.has(resolve), true);
  assert.equal(avatarMethods.has(revalidate), false);
  for (const method of [resolve, revalidate]) {
    assert.match(nativeOutput, new RegExp(method.replaceAll('/', '\\/'), 'u'));
  }
  assert.doesNotMatch(
    sdkOutput,
    /ResolveLocalAppAvatarHostTarget|resolveLocalAppAvatarHostTarget|RevalidateLocalAppAvatarHostTarget|revalidateLocalAppAvatarHostTarget/u,
  );
});

test('retires Desktop self AI consumption from the direct account product profile', () => {
  const { model } = compile();
  const profiles = new Map(model.profiles.map((profile) => [profile.profileId, profile]));
  const accountMethods = new Set(
    profiles.get('desktop_account_product_v1')?.methods.map((method) => method.methodId),
  );
  const machineMethods = new Set(
    profiles.get('desktop_machine_product_v1')?.methods.map((method) => method.methodId),
  );
  for (const methodId of [
    '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
    '/nimi.runtime.v1.RuntimeAiService/StreamScenario',
    '/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob',
    '/nimi.runtime.v1.RuntimeAiService/GetScenarioJob',
    '/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob',
    '/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents',
    '/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts',
	'/nimi.runtime.v1.RuntimeAiService/ListPresetVoices',
	'/nimi.runtime.v1.RuntimeAiService/ListVoiceAssets',
  ]) {
	assert.equal(accountMethods.has(methodId), false, `${methodId} must be unreachable from the direct account product profile`);
    assert.equal(machineMethods.has(methodId), false, `${methodId} must not use the machine product profile`);
  }
	for (const methodId of [
		'/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario',
		'/nimi.runtime.v1.RuntimeAiService/StreamLocalAppTextTurn',
		'/nimi.runtime.v1.RuntimeAiService/SubmitLocalAppScenarioJob',
		'/nimi.runtime.v1.RuntimeAiService/ListLocalAppVoiceAssets',
	]) {
		assert.equal(accountMethods.has(methodId), true, `${methodId} must remain on the formal App carrier`);
	}
});

test('rejects duplicate and wildcard methods', () => {
  rejectsMutation((value) => value.profiles[0].methods.push({ ...value.profiles[0].methods[0] }), /duplicate method/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].method_id = '/nimi.runtime.v1.RuntimeLocalService/*'; }, /wildcard method id/u);
});

test('rejects unknown fields and RPCs', () => {
  rejectsMutation((value) => { value.profiles[0].unexpected = true; }, /unknown field/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].method_id = '/nimi.runtime.v1.RuntimeLocalService/DoesNotExist'; }, /unknown RPC method/u);
});

test('rejects malformed required profiles and Avatar capability closure', () => {
  rejectsMutation((value) => { value.profiles[2].identity_class = 'account'; }, /identity_class must be avatar/u);
  rejectsMutation((value) => { delete value.profiles[2].account_caller; }, /account_caller must be an object/u);
  rejectsMutation((value) => {
    const method = value.profiles[2].methods.find((entry) => entry.capability);
    delete method.capability;
  }, /capability must be a non-empty/u);
  rejectsMutation((value) => {
    value.profiles[2].methods.find((entry) => entry.method_id.endsWith('/OpenLocalAppSession')).capability = 'agent.local';
  }, /session mechanics must not declare Avatar capability/u);
  rejectsMutation((value) => { value.profiles[0].methods[0].capability = 'text.generate'; }, /must not duplicate non-Avatar capability authority/u);
});
