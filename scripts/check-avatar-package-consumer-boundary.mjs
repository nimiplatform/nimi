#!/usr/bin/env node
// Guard for Avatar local asset and secondary package-source boundaries across
// SDK, Desktop, and Avatar.
//
// Enforces:
//   - local Avatar asset import/materialization is the primary launch path
//   - SDK/Desktop/Avatar are consumer/control projection layers only
//   - Asset Market remains secondary package-source lifecycle authority
//   - Avatar does not require Runtime package projection for private local import launch
//   - launched Avatar backends remain live2d | vrm only

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  sdkContract: '.nimi/spec/sdk/kernel/runtime-avatar-control-client-contract.md',
  sdkMethodTable: '.nimi/spec/sdk/kernel/tables/runtime-avatar-control-methods.yaml',
  runtimeContract: '.nimi/spec/runtime/kernel/avatar-package-projection-contract.md',
  sdkIndex: '.nimi/spec/sdk/kernel/index.md',
  sdkEvidence: '.nimi/spec/sdk/kernel/tables/rule-evidence.rules-runtime-client.yaml',
  desktopContract: '.nimi/spec/desktop/kernel/agent-avatar-configuration-contract.md',
  desktopIndex: '.nimi/spec/desktop/kernel/index.md',
  desktopEvidence: '.nimi/spec/desktop/kernel/tables/rule-evidence.rules-runtime-bridge.yaml',
  avatarContract: '.nimi/spec/avatar/kernel/avatar-package-consumption-contract.md',
  avatarIndex: '.nimi/spec/avatar/kernel/index.md',
  sdkImplementation: 'sdk/src/runtime/runtime-avatar-package.ts',
  sdkRuntimeIndex: 'sdk/src/runtime/index.ts',
  sdkRuntimeClass: 'sdk/src/runtime/runtime.ts',
  sdkMethodIds: 'sdk/src/runtime/method-ids.ts',
  sdkTest: 'sdk/test/runtime/runtime-avatar-package.test.ts',
  avatarRuntimeBinding: 'apps/avatar/src/shell/renderer/app-shell/app-bootstrap-runtime-binding.ts',
  avatarBootstrap: 'apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts',
  avatarEvidence: 'apps/avatar/src/shell/renderer/app-shell/app-bootstrap-package-evidence.ts',
  avatarLaunchContextTs: 'apps/avatar/src/shell/renderer/bridge/launch-context.ts',
  avatarLaunchContextRust: 'apps/avatar/src-tauri/src/avatar_launch_context.rs',
  desktopLauncher: 'apps/desktop/src/shell/renderer/bridge/runtime-bridge/chat-agent-avatar-launcher.ts',
  desktopPresentation: 'apps/desktop/src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx',
  desktopRustPayload: 'apps/desktop/src-tauri/src/main_parts/mod.rs',
  desktopRustHandoff: 'apps/desktop/src-tauri/src/main_parts/defaults_and_commands/window_and_logs.rs',
  desktopLaunchTest: 'apps/desktop/test/chat-agent-avatar-launcher.test.ts',
  packageContract: 'apps/asset-market/spec/kernel/package-contract.md',
  packageModel: 'apps/asset-market/spec/kernel/tables/package-model.yaml',
};

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[avatar-package-consumer-boundary] FAIL ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

function requireIncludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`${relPath} must include ${needle}`);
    }
  }
  return text;
}

function requireExcludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (text.includes(needle)) {
      fail(`${relPath} must not include ${needle}`);
    }
  }
  return text;
}

if (existsSync(path.join(ROOT, '.nimi', 'spec', 'asset-market'))) {
  fail('.nimi/spec/asset-market must not exist; Asset Market authority is apps/asset-market/spec');
}

requireIncludes(FILES.sdkContract, [
  'S-RUNTIME-231 Avatar Package Client Boundary',
  'S-RUNTIME-232 Opaque Ref Projection',
  'S-RUNTIME-233 Acquisition And Import Projection',
  'S-RUNTIME-234 Readiness And Compatibility Decoding',
  'S-RUNTIME-235 Avatar Handoff Projection',
  'S-RUNTIME-236 No Lifecycle Authority',
  'S-RUNTIME-237 Resolve Launch Projection Method',
  'S-RUNTIME-238 Contract-Only Fail Closed Status',
  'S-RUNTIME-239 Public Surface Narrowing',
  'The primary Avatar launch path is local Avatar asset selection plus Runtime',
  'secondary Realm / Asset Market sources',
  'must not be required for a\nprivate locally imported Live2D / VRM carrier',
  'SDK does not own package lifecycle',
  'AM-LIB-005',
  'AM-API-005',
  'AM-PKG-014',
  'AM-PKG-017',
  'runtime.avatarPackage.resolveLaunchProjection',
  '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection',
  'runtime.agent.avatar_package.read',
]);
requireExcludes(FILES.sdkContract, [
  'SDK owns package lifecycle',
  'SDK owns package inventory',
  'SDK resolves package descriptors',
  'SDK may introduce a direct app-local install endpoint',
]);

requireIncludes(FILES.desktopContract, [
  'D-LLM-099',
  'D-LLM-100',
  'D-LLM-101',
  'D-LLM-102',
  'D-LLM-103',
  'local Avatar asset controls',
  'Local import is the primary Avatar asset path',
  'Desktop MUST NOT become a package registry',
  'Desktop MUST NOT persist or pass package descriptors',
  'browser-reachable Avatar-local install endpoint',
  'Avatar local asset controls MUST NOT widen the Avatar launch payload',
  'Agent Center resolver plumbing',
  'local Avatar asset\nmaterialization storage',
]);
requireExcludes(FILES.desktopContract, [
  'Desktop owns package lifecycle',
  'Desktop package registry',
  'Desktop-local package activation truth',
]);

requireIncludes(FILES.avatarContract, [
  'Local import is the primary product path',
  'Avatar consumes local Avatar assets, not remote package records',
  'Realm / Asset Market `Package` records with `package_kind: "avatar"` are an\noptional upstream source',
  '`backend_kind: "live2d"` or `backend_kind: "vrm"`',
  '`sprite2d`, `canvas2d`, and `video` are not launched Avatar backend kinds',
  'Avatar MUST NOT define a second remote package manifest',
  'Resolver execution may turn a local Avatar asset selection into materialized',
  'avatar.visual.local-asset-resolved',
  'Refusal must render the admitted degraded surface',
  'Local asset consumption MUST NOT widen `BackendKind`',
]);
requireExcludes(FILES.avatarContract, [
  'Avatar owns package lifecycle',
  'Avatar may define an installed package id',
  'Avatar owns activation binding authority',
  'fallback to Sprite2D',
]);

requireIncludes(FILES.sdkIndex, ['secondary Runtime Avatar package-source projection']);
requireIncludes(FILES.desktopIndex, ['package control surface']);
requireIncludes(FILES.avatarIndex, ['avatar-package-consumption-contract.md']);
requireIncludes(FILES.runtimeContract, [
  'K-AGCORE-133 Avatar Package Projection Authority',
  'K-AGCORE-134 Resolve Launch Projection Method Shape',
  'K-AGCORE-135 Launch Eligibility Gate',
  'K-AGCORE-136 Agent Center Non-Authority',
  'K-AGCORE-137 Runtime Emit Implementation Gate',
  'secondary Realm / Asset Market Avatar package projection',
  'not the default Avatar launch path',
  'primary launch path',
  'runtime.avatarPackage.resolveLaunchProjection',
  'ResolveAvatarPackageLaunchProjection',
  'runtime.agent.avatar_package.read',
  'typed proto request/response messages',
]);
requireIncludes(FILES.sdkMethodTable, [
  'runtime.avatarPackage.resolveLaunchProjection',
  '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection',
  'runtime.agent.avatar_package.read',
  'runtime_emit_rpc_available',
]);

for (const rule of [
  'S-RUNTIME-231',
  'S-RUNTIME-232',
  'S-RUNTIME-233',
  'S-RUNTIME-234',
  'S-RUNTIME-235',
  'S-RUNTIME-236',
  'S-RUNTIME-237',
  'S-RUNTIME-238',
  'S-RUNTIME-239',
]) {
  requireIncludes(FILES.sdkEvidence, [`- ${rule}`, `rule_id: ${rule}`]);
}
for (const rule of ['D-LLM-099', 'D-LLM-100', 'D-LLM-101', 'D-LLM-102', 'D-LLM-103']) {
  requireIncludes(FILES.desktopEvidence, [`- ${rule}`, `rule_id: ${rule}`]);
}

requireIncludes(FILES.packageContract, ['AM-PKG-014', 'AM-PKG-015', 'AM-PKG-016', 'AM-PKG-017']);
requireIncludes(FILES.packageModel, ['avatar_model_layout', 'backend_capability_profile_ref', 'forbidden_backend_kind_values']);

requireIncludes(FILES.sdkImplementation, [
  "export type RuntimeAvatarPackageBackendKind = 'live2d' | 'vrm';",
  "type RuntimeAvatarPackageKind = 'avatar';",
  'export function createRuntimeAvatarPackageModule',
  'runtime.agent.avatar_package.read',
  'ResolveAvatarPackageLaunchProjection',
  'function decodeAvatarPackageProjection',
  'isAvatarPackageLaunchEligible',
  'function toAvatarPackageHandoff',
  'export function decodeAvatarPackageHandoff',
  'future_reviewed_ugc requires AM-MOD admission',
  'must not include',
  'package_kind must be avatar',
  'unsupported backend_kind',
]);
requireExcludes(FILES.sdkImplementation, [
  "'sprite2d' | 'canvas2d' | 'video'",
  'packageDescriptor:',
  'packagePath:',
  'assetBytes:',
]);
requireIncludes(FILES.sdkRuntimeIndex, [
  'decodeAvatarPackageHandoff',
  'RuntimeAvatarPackageBackendKind',
  'RuntimeAvatarPackageHandoff',
]);
requireExcludes(FILES.sdkRuntimeIndex, [
  'RuntimeAvatarPackageModule',
  'RuntimeAvatarPackageResolveLaunchProjectionRequest',
  'decodeAvatarPackageProjection',
  'RuntimeAvatarPackageProjection',
  'RuntimeAvatarPackageModelLayout',
  'RuntimeAvatarPackageLive2DLayout',
  'RuntimeAvatarPackageVrmLayout',
  'RuntimeAvatarPackageProvenance',
  'getAvatarPackageBlockingDiagnostics',
  'assertAvatarPackageLaunchEligible',
  'isAvatarPackageLaunchEligible',
  'toAvatarPackageHandoff',
]);
requireIncludes(FILES.sdkRuntimeClass, [
  'readonly avatarPackage',
  'createRuntimeAvatarPackageModule',
]);
requireIncludes(FILES.sdkMethodIds, [
  "resolveAvatarPackageLaunchProjection: '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection'",
]);
requireIncludes(FILES.sdkTest, [
  'decodeAvatarPackageHandoff normalizes a launch-eligible Live2D avatar package without exposing layout truth',
  'Runtime avatar package module calls the locked RuntimeAgentService method with protected read scope',
  'Runtime avatar package module fails closed when the Runtime RPC is not available',
  'rejects non-launched backend kinds and preview package kinds',
  'future_reviewed_ugc requires AM-MOD admission',
  'must not include package.packageDescriptor',
]);
requireExcludes(FILES.avatarBootstrap, [
  'resolveRuntimeAvatarPackageHandoff',
  'avatar_package_handoff',
]);
requireIncludes(FILES.avatarBootstrap, [
  'resolveLocalAvatarAssetManifest',
  'local_avatar_asset_manifest',
  'recordLocalAvatarAssetResolved',
]);
requireIncludes(FILES.avatarEvidence, [
  'avatar.visual.local-asset-resolved',
  'asset_authority',
  'local_avatar_asset',
  'resolver_authority',
  'avatar_local_materialization',
]);
requireIncludes(FILES.avatarRuntimeBinding, [
  'input.runtime.avatarPackage.resolveLaunchProjection',
  'decodeAvatarPackageHandoff',
]);

for (const relPath of [FILES.avatarLaunchContextTs, FILES.avatarLaunchContextRust]) {
  requireIncludes(relPath, [
    'avatar_package_ref',
    'backend_capability_profile_ref',
    'materialization_ref',
    'local_materialization_ref',
  ]);
}

const tsLaunchContext = read(FILES.avatarLaunchContextTs);
const tsLaunchContextBody = tsLaunchContext.match(/export type AvatarLaunchContext = \{(?<body>[\s\S]*?)\n\};/u)?.groups?.body || '';
if (!tsLaunchContextBody.includes('agentId: string;')
  || !tsLaunchContextBody.includes('avatarInstanceId: string | null;')
  || !tsLaunchContextBody.includes('launchSource: string | null;')) {
  fail(`${FILES.avatarLaunchContextTs} must keep launch context to agentId + optional instance/source`);
}
for (const field of ['ownerUserId', 'realmAgentId', 'localAgentRef', 'conversationAnchorId']) {
  if (new RegExp(`${field}:\\s*string`, 'u').test(tsLaunchContextBody)) {
    fail(`${FILES.avatarLaunchContextTs} must not type ${field} into launch context`);
  }
  if (!tsLaunchContext.includes(`'${field}'`)) {
    fail(`${FILES.avatarLaunchContextTs} must reject forbidden launch field ${field}`);
  }
}

const rustLaunchContext = read(FILES.avatarLaunchContextRust);
const rustStruct = rustLaunchContext.match(/pub struct AvatarLaunchContext \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body || '';
if (!rustStruct.includes('pub agent_id: String')
  || !rustStruct.includes('pub avatar_instance_id: Option<String>')
  || !rustStruct.includes('pub launch_source: Option<String>')) {
  fail(`${FILES.avatarLaunchContextRust} must keep launch context to agent_id + optional instance/source`);
}
for (const field of ['owner_user_id', 'realm_agent_id', 'local_agent_ref', 'conversation_anchor_id']) {
  if (rustStruct.includes(field)) {
    fail(`${FILES.avatarLaunchContextRust} must not type ${field} into launch context`);
  }
  if (!rustLaunchContext.includes(`"${field}"`)) {
    fail(`${FILES.avatarLaunchContextRust} must reject forbidden launch field ${field}`);
  }
}

const desktopLauncher = read(FILES.desktopLauncher);
const desktopLaunchInput = desktopLauncher.match(/export type DesktopAvatarLaunchHandoffInput = \{(?<body>[\s\S]*?)\n\};/u)?.groups?.body || '';
const desktopLaunchPayload = desktopLauncher.match(/export type DesktopAvatarLaunchHandoffPayload = \{(?<body>[\s\S]*?)\n\};/u)?.groups?.body || '';
for (const [typeName, typeBody] of [
  ['DesktopAvatarLaunchHandoffInput', desktopLaunchInput],
  ['DesktopAvatarLaunchHandoffPayload', desktopLaunchPayload],
]) {
  if (!typeBody.includes('agentId: string;')) {
    fail(`${FILES.desktopLauncher} ${typeName} must require agentId`);
  }
  for (const field of ['ownerUserId', 'realmAgentId', 'localAgentRef', 'conversationAnchorId']) {
    if (new RegExp(`${field}:\\s*string`, 'u').test(typeBody)) {
      fail(`${FILES.desktopLauncher} ${typeName} must not type ${field}`);
    }
  }
}
for (const field of ['ownerUserId', 'realmAgentId', 'localAgentRef', 'conversationAnchorId', 'materializationRef', 'avatarPackageRef']) {
  if (!desktopLauncher.includes(`'${field}'`)) {
    fail(`${FILES.desktopLauncher} must reject forbidden Desktop launch input field ${field}`);
  }
}
requireIncludes(FILES.desktopLauncher, [
  "const agentId = normalizeRequiredString(input.agentId, 'agentId');",
  'const launchSource = normalizeOptionalString(input.launchSource) ?? normalizeOptionalString(input.sourceSurface);',
]);

const desktopPresentation = read(FILES.desktopPresentation);
const desktopLaunchCall = desktopPresentation.match(/launchDesktopAvatarHandoff\(\{(?<body>[\s\S]*?)\n {6}\}\)/u)?.groups?.body || '';
if (!desktopLaunchCall.includes('agentId: input.activeTarget.realmAgentId')) {
  fail(`${FILES.desktopPresentation} Avatar launch call must pass only agentId selector`);
}
for (const field of ['ownerUserId', 'realmAgentId', 'localAgentRef', 'conversationAnchorId', 'sourceSurface']) {
  if (new RegExp(`\\b${field}\\s*:`, 'u').test(desktopLaunchCall)) {
    fail(`${FILES.desktopPresentation} Avatar launch call must not pass ${field}`);
  }
}

const desktopRustPayload = read(FILES.desktopRustPayload);
const desktopRustLaunchStruct = desktopRustPayload.match(/pub\(crate\) struct DesktopAvatarLaunchHandoffPayload \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body || '';
if (!desktopRustLaunchStruct.includes('agent_id: String')) {
  fail(`${FILES.desktopRustPayload} DesktopAvatarLaunchHandoffPayload must require agent_id`);
}
for (const field of ['owner_user_id', 'realm_agent_id', 'local_agent_ref', 'conversation_anchor_id', 'source_surface']) {
  if (desktopRustLaunchStruct.includes(field)) {
    fail(`${FILES.desktopRustPayload} DesktopAvatarLaunchHandoffPayload must not type ${field}`);
  }
}

const desktopRustHandoff = read(FILES.desktopRustHandoff);
const buildAvatarHandoffUri = desktopRustHandoff.match(/fn build_avatar_handoff_uri[\s\S]*?\n\}/u)?.[0] || '';
if (!buildAvatarHandoffUri.includes('serializer.append_pair("agent_id", agent_id.as_str());')) {
  fail(`${FILES.desktopRustHandoff} must append agent_id in launch URI`);
}
for (const field of ['owner_user_id', 'realm_agent_id', 'local_agent_ref', 'conversation_anchor_id', 'source_surface']) {
  if (buildAvatarHandoffUri.includes(field)) {
    fail(`${FILES.desktopRustHandoff} build_avatar_handoff_uri must not append or require ${field}`);
  }
}

requireIncludes(FILES.desktopLaunchTest, [
  'desktop avatar launcher builds minimal launch intent payload',
  'desktop avatar prepared payload rejects old launch authority tuple inputs',
  'avatar launch parser rejects old binding package anchor and auth fields',
]);

if (failures > 0) {
  console.error(`[avatar-package-consumer-boundary] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[avatar-package-consumer-boundary] PASS');
