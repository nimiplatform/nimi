import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const SOURCE_RELATIVE = '.nimi/spec/runtime/kernel/tables/first-party-protected-runtime-profiles.yaml';
export const RPC_SOURCE_RELATIVE = '.nimi/spec/runtime/kernel/tables/rpc-methods.yaml';
export const COMPILER_RELATIVE = 'scripts/generate-first-party-protected-runtime-profiles.mjs';
export const MANIFEST_RELATIVE = 'sdks/typescript/runtime/first-party-protected-runtime-profiles.manifest.generated.json';

const OUTPUT_PATHS = Object.freeze([
  'runtime/internal/protectedlocal/first_party_profiles_generated.go',
  'runtime/internal/bundledavatar/profile_generated.go',
  'kit/shell/protected-local/src/first_party_profiles_generated.rs',
  'kit/shell/electron/src/main/first-party-protected-runtime-profiles.generated.ts',
  'kit/shell/electron/src/main/bundled-avatar-profile.generated.ts',
  'sdks/typescript/runtime/first-party-protected-runtime-profiles.generated.ts',
  'sdks/typescript/runtime/bundled-avatar-profile.generated.ts',
]);

const TOP_LEVEL_FIELDS = new Set([
  'version', 'table_family', 'owner', 'protocol_id', 'surfaces', 'source_rules',
  'physical_transport_class', 'membership_authority', 'renderer_may_select_profile',
  'renderer_may_supply_method_id', 'renderer_may_supply_metadata',
  'renderer_may_supply_principal', 'renderer_may_supply_account', 'portable_session_allowed',
  'ordinary_grpc_disposition', 'public_tcp_disposition', 'generic_proxy',
  'method_authority_ref', 'transport_authority_ref', 'principal_authority_refs',
  'negative_test_profiles', 'intents', 'external_profiles', 'profiles', 'migration_parity_views',
]);
const PROFILE_FIELDS = new Set([
  'profile_id', 'identity_class', 'app_id', 'native_profile_marker', 'required_origin_role',
  'host_owner', 'principal_policy_ref', 'account_posture', 'sender_posture',
  'invalidation_policy_ref', 'native_entrypoint_classes', 'negative_test_ref',
  'account_caller', 'realm_operations', 'methods', 'forbidden',
]);
const METHOD_FIELDS = new Set(['method_id', 'kind', 'intent_refs', 'capability']);
const INTENT_FIELDS = new Set(['owner_postcondition_refs', 'gate_refs']);
const NEGATIVE_FIELDS = new Set(['rejects']);
const EXTERNAL_PROFILE_FIELDS = new Set(['profile_id', 'membership_ref', 'owner', 'merged_into_product_profiles']);
const ACCOUNT_CALLER_FIELDS = new Set(['mode', 'app_instance_id', 'device_id']);
const PARITY_ROOT_FIELDS = new Set(['status', 'product_control_v1', 'ordinary_desktop_runtime_consumer_v1', 'bundled_avatar_v1']);
const DERIVED_PARITY_FIELDS = new Set([
  'derive_from_profile_id', 'require_intent_ref', 'expected_method_count',
  'expected_unary_count', 'expected_server_stream_count', 'expected_fingerprint_sha256',
  'expected_capability_fingerprint_sha256',
]);
const EXPLICIT_PARITY_FIELDS = new Set([
  'status', 'expected_method_count', 'expected_unary_count', 'expected_server_stream_count',
  'expected_fingerprint_sha256', 'methods',
]);
const METHOD_ID_PATTERN = /^\/nimi\.runtime\.v1\.([A-Za-z0-9]+)\/([A-Za-z0-9]+)$/u;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9_]*_v[0-9]+$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

export function compileFirstPartyProtectedRuntimeProfiles({ repoRoot, sourceText, rpcSourceText } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const source = sourceText ?? fs.readFileSync(path.join(repoRoot, SOURCE_RELATIVE), 'utf8');
  const rpcSource = rpcSourceText ?? fs.readFileSync(path.join(repoRoot, RPC_SOURCE_RELATIVE), 'utf8');
  const registry = parseYaml(source, SOURCE_RELATIVE);
  const rpcRegistry = parseYaml(rpcSource, RPC_SOURCE_RELATIVE);
  const model = validateAndBuildModel(registry, rpcRegistry);
  const outputs = renderOutputs(model);
  const outputDigests = Object.fromEntries([...outputs.entries()].map(([relative, content]) => [relative, sha256(content)]));
  const manifest = renderManifest(model, source, outputDigests);
  outputs.set(MANIFEST_RELATIVE, manifest);
  return { model, outputs, source };
}

export function writeOrCheckCompiledProfiles({ repoRoot, checkOnly = false } = {}) {
  const compiled = compileFirstPartyProtectedRuntimeProfiles({ repoRoot });
  const drift = [];
  for (const [relative, content] of compiled.outputs) {
    const output = path.join(repoRoot, relative);
    if (checkOnly) {
      const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
      if (current !== content) drift.push(relative);
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, content, 'utf8');
    }
  }
  const expected = new Set(compiled.outputs.keys());
  for (const relative of findCompilerOwnedFiles(repoRoot)) {
    if (!expected.has(relative)) drift.push(`orphan:${relative}`);
  }
  if (drift.length > 0) {
    throw new Error(`first-party protected Runtime profile drift: ${[...new Set(drift)].join(', ')}`);
  }
  return compiled.model;
}

function parseYaml(source, label) {
  try {
    return YAML.parse(source);
  } catch (error) {
    throw new Error(`${label} is invalid YAML: ${error.message}`);
  }
}

function validateAndBuildModel(registry, rpcRegistry) {
  requirePlainObject(registry, 'registry');
  rejectUnknownFields(registry, TOP_LEVEL_FIELDS, 'registry');
  if (registry.version !== 1 || registry.protocol_id !== 'first_party_protected_runtime_profiles'
    || registry.membership_authority !== 'canonical' || registry.generic_proxy !== 'forbidden') {
    throw new Error('canonical first-party profile registry identity is invalid');
  }
  const intents = registry.intents;
  requirePlainObject(intents, 'intents');
  for (const [intentId, intent] of Object.entries(intents)) {
    requirePlainObject(intent, `intent ${intentId}`);
    rejectUnknownFields(intent, INTENT_FIELDS, `intent ${intentId}`);
    requireNonEmptyStrings(intent.owner_postcondition_refs, `intent ${intentId} owner_postcondition_refs`);
    requireNonEmptyStrings(intent.gate_refs, `intent ${intentId} gate_refs`);
  }
  requirePlainObject(registry.negative_test_profiles, 'negative_test_profiles');
  for (const [name, negative] of Object.entries(registry.negative_test_profiles)) {
    requirePlainObject(negative, `negative profile ${name}`);
    rejectUnknownFields(negative, NEGATIVE_FIELDS, `negative profile ${name}`);
    requireNonEmptyStrings(negative.rejects, `negative profile ${name} rejects`);
  }
  requirePlainObject(registry.external_profiles, 'external_profiles');
  for (const [name, external] of Object.entries(registry.external_profiles)) {
    requirePlainObject(external, `external profile ${name}`);
    rejectUnknownFields(external, EXTERNAL_PROFILE_FIELDS, `external profile ${name}`);
    requireString(external.profile_id, `external profile ${name} profile_id`);
    requireString(external.membership_ref, `external profile ${name} membership_ref`);
  }
  const rpcKinds = buildRpcKindMap(rpcRegistry);
  if (!Array.isArray(registry.profiles) || registry.profiles.length === 0) throw new Error('profiles must be non-empty');
  const profileIds = new Set();
  const profiles = registry.profiles.map((profile, profileIndex) => {
    requirePlainObject(profile, `profile[${profileIndex}]`);
    rejectUnknownFields(profile, PROFILE_FIELDS, `profile[${profileIndex}]`);
    const profileId = requireString(profile.profile_id, `profile[${profileIndex}] profile_id`);
    if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error(`invalid profile id: ${profileId}`);
    if (profileIds.has(profileId)) throw new Error(`duplicate profile: ${profileId}`);
    profileIds.add(profileId);
    for (const field of ['identity_class', 'native_profile_marker', 'required_origin_role', 'host_owner', 'principal_policy_ref', 'invalidation_policy_ref', 'negative_test_ref']) {
      requireString(profile[field], `${profileId} ${field}`);
    }
    if (!registry.negative_test_profiles[profile.negative_test_ref]) throw new Error(`${profileId} has unknown negative_test_ref`);
    requireNonEmptyStrings(profile.native_entrypoint_classes, `${profileId} native_entrypoint_classes`);
    requireNonEmptyStrings(profile.forbidden, `${profileId} forbidden`);
    if (profile.account_caller !== undefined) {
      requirePlainObject(profile.account_caller, `${profileId} account_caller`);
      rejectUnknownFields(profile.account_caller, ACCOUNT_CALLER_FIELDS, `${profileId} account_caller`);
      for (const field of ACCOUNT_CALLER_FIELDS) requireString(profile.account_caller[field], `${profileId} account_caller.${field}`);
    }
    if (profile.realm_operations !== undefined) requireNonEmptyStrings(profile.realm_operations, `${profileId} realm_operations`);
    if (!Array.isArray(profile.methods) || profile.methods.length === 0) throw new Error(`${profileId} methods must be non-empty`);
    const seenMethods = new Set();
    const methods = profile.methods.map((method, methodIndex) => {
      requirePlainObject(method, `${profileId} method[${methodIndex}]`);
      rejectUnknownFields(method, METHOD_FIELDS, `${profileId} method[${methodIndex}]`);
      const normalized = normalizeMethod(method, `${profileId} method[${methodIndex}]`);
      if (seenMethods.has(normalized.methodId)) throw new Error(`duplicate method in ${profileId}: ${normalized.methodId}`);
      seenMethods.add(normalized.methodId);
      const rpcKind = rpcKinds.get(normalized.methodId);
      if (!rpcKind) throw new Error(`unknown RPC method in ${profileId}: ${normalized.methodId}`);
      if (rpcKind !== normalized.kind) throw new Error(`RPC kind mismatch for ${normalized.methodId}: ${normalized.kind} != ${rpcKind}`);
      requireNonEmptyStrings(method.intent_refs, `${normalized.methodId} intent_refs`);
      for (const intentRef of method.intent_refs) if (!intents[intentRef]) throw new Error(`${normalized.methodId} has unknown intent_ref: ${intentRef}`);
      if (profile.identity_class === 'avatar') requireString(method.capability, `${normalized.methodId} capability`);
      else if (method.capability !== undefined) throw new Error(`${profileId} must not duplicate non-Avatar capability authority`);
      return { ...normalized, intentRefs: [...method.intent_refs], capability: method.capability };
    });
    return {
      profileId,
      identityClass: profile.identity_class,
      appId: profile.app_id,
      nativeProfileMarker: profile.native_profile_marker,
      requiredOriginRole: profile.required_origin_role,
      principalPolicyRef: profile.principal_policy_ref,
      invalidationPolicyRef: profile.invalidation_policy_ref,
      accountCaller: profile.account_caller,
      realmOperations: profile.realm_operations ?? [],
      methods,
      fingerprint: fingerprint(methods),
    };
  });
  for (const required of ['desktop_machine_product_v1', 'desktop_account_product_v1', 'bundled_avatar_v1']) {
    if (!profileIds.has(required)) throw new Error(`required profile is missing: ${required}`);
  }
  const parity = buildParityViews(registry.migration_parity_views, profiles);
  return { profiles, parity };
}

function buildRpcKindMap(rpcRegistry) {
  if (!Array.isArray(rpcRegistry?.services)) throw new Error('RPC method authority requires services');
  const out = new Map();
  for (const service of rpcRegistry.services) {
    requireString(service?.name, 'RPC service name');
    if (!Array.isArray(service.methods)) throw new Error(`RPC service ${service.name} requires methods`);
    const wireService = service.name === 'AIService' ? 'RuntimeAiService'
      : service.name === 'ConnectorService' ? 'RuntimeConnectorService' : service.name;
    for (const method of service.methods) {
      const name = requireString(method?.name, `${service.name} RPC name`);
      const kind = requireString(method?.type, `${service.name}/${name} RPC type`);
      out.set(`/nimi.runtime.v1.${wireService}/${name}`, kind);
    }
  }
  return out;
}

function buildParityViews(parityRoot, profiles) {
  requirePlainObject(parityRoot, 'migration_parity_views');
  rejectUnknownFields(parityRoot, PARITY_ROOT_FIELDS, 'migration_parity_views');
  if (parityRoot.status !== 'compiler_input_only_not_runtime_profile_authority') throw new Error('migration parity status is invalid');
  const byId = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const productControl = deriveParityView(parityRoot.product_control_v1, byId, 'product_control_v1');
  const avatar = deriveParityView(parityRoot.bundled_avatar_v1, byId, 'bundled_avatar_v1');
  const ordinaryConfig = parityRoot.ordinary_desktop_runtime_consumer_v1;
  requirePlainObject(ordinaryConfig, 'ordinary parity view');
  rejectUnknownFields(ordinaryConfig, EXPLICIT_PARITY_FIELDS, 'ordinary parity view');
  if (ordinaryConfig.status !== 'frozen_pre_redesign_behavior') throw new Error('ordinary parity status is invalid');
  if (!Array.isArray(ordinaryConfig.methods) || ordinaryConfig.methods.length === 0) throw new Error('ordinary parity methods are required');
  const allMethods = new Map(profiles.flatMap((profile) => profile.methods.map((method) => [method.methodId, method])));
  const seen = new Set();
  const ordinaryMethods = ordinaryConfig.methods.map((method, index) => {
    requirePlainObject(method, `ordinary parity method[${index}]`);
    rejectUnknownFields(method, new Set(['method_id', 'kind']), `ordinary parity method[${index}]`);
    const normalized = normalizeMethod(method, `ordinary parity method[${index}]`);
    if (seen.has(normalized.methodId)) throw new Error(`duplicate ordinary parity method: ${normalized.methodId}`);
    seen.add(normalized.methodId);
    const canonical = allMethods.get(normalized.methodId);
    if (!canonical) throw new Error(`ordinary parity has unknown profile method: ${normalized.methodId}`);
    if (canonical.kind !== normalized.kind) throw new Error(`ordinary parity kind mismatch: ${normalized.methodId}`);
    return normalized;
  });
  const ordinary = verifyParity('ordinary_desktop_runtime_consumer_v1', ordinaryConfig, ordinaryMethods);
  return { productControl, ordinary, avatar };
}

function deriveParityView(config, byId, name) {
  requirePlainObject(config, `${name} parity view`);
  rejectUnknownFields(config, DERIVED_PARITY_FIELDS, `${name} parity view`);
  const profile = byId.get(requireString(config.derive_from_profile_id, `${name} derive_from_profile_id`));
  if (!profile) throw new Error(`${name} derives from an unknown profile`);
  const methods = config.require_intent_ref
    ? profile.methods.filter((method) => method.intentRefs.includes(config.require_intent_ref))
    : profile.methods;
  if (config.require_intent_ref && methods.length === 0) throw new Error(`${name} intent selector matched no methods`);
  return verifyParity(name, config, methods);
}

function verifyParity(name, config, methods) {
  const unary = methods.filter((method) => method.kind === 'unary').length;
  const serverStream = methods.filter((method) => method.kind === 'server_stream').length;
  const digest = fingerprint(methods);
  const capabilityDigest = methods.every((method) => typeof method.capability === 'string')
    ? sha256(methods.map((method) => `${method.methodId}|${method.kind}|${method.capability}`).sort().join('\n'))
    : undefined;
  if (config.expected_method_count !== methods.length || config.expected_unary_count !== unary
    || config.expected_server_stream_count !== serverStream
    || !FINGERPRINT_PATTERN.test(String(config.expected_fingerprint_sha256 ?? ''))
    || config.expected_fingerprint_sha256 !== digest
    || (config.expected_capability_fingerprint_sha256 !== undefined
      && config.expected_capability_fingerprint_sha256 !== capabilityDigest)) {
    throw new Error(`${name} parity mismatch: ${methods.length}/${unary}/${serverStream}/${digest}/${capabilityDigest ?? 'no-capabilities'}`);
  }
  return { name, methods, unary, serverStream, fingerprint: digest, capabilityFingerprint: capabilityDigest };
}

function normalizeMethod(method, label) {
  const methodId = requireString(method.method_id, `${label} method_id`);
  if (methodId.includes('*') || !METHOD_ID_PATTERN.test(methodId)) throw new Error(`invalid or wildcard method id: ${methodId}`);
  const kind = requireString(method.kind, `${label} kind`);
  if (kind !== 'unary' && kind !== 'server_stream') throw new Error(`invalid method kind for ${methodId}: ${kind}`);
  const match = METHOD_ID_PATTERN.exec(methodId);
  const service = match[1];
  const rpc = match[2];
  return { methodId, kind, service, rpc, methodName: `${rpc[0].toLowerCase()}${rpc.slice(1)}` };
}

function renderOutputs(model) {
  const outputs = new Map();
  outputs.set(OUTPUT_PATHS[0], renderGoProfiles(model));
  outputs.set(OUTPUT_PATHS[1], renderGoAvatar(model));
  outputs.set(OUTPUT_PATHS[2], renderRustProfiles(model));
  outputs.set(OUTPUT_PATHS[3], renderElectronProfiles(model));
  outputs.set(OUTPUT_PATHS[4], renderElectronAvatar(model));
  outputs.set(OUTPUT_PATHS[5], renderSdkProfiles(model));
  outputs.set(OUTPUT_PATHS[6], renderSdkAvatar(model));
  return outputs;
}

function generatedHeader(comment = '//') {
  return `${comment} Code generated by ${COMPILER_RELATIVE}; DO NOT EDIT.\n${comment} Source: ${SOURCE_RELATIVE}\n`;
}

function renderGoProfiles(model) {
  const profileCases = model.profiles.map((profile) => {
    const methods = profile.methods.map((method) => `\tcase ${JSON.stringify(method.methodId)}:\n\t\treturn FirstPartyMethod${method.kind === 'unary' ? 'Unary' : 'ServerStream'}, true`).join('\n');
    return `\tcase ${JSON.stringify(profile.profileId)}:\n\t\tswitch methodID {\n${methods}\n\t\t}`;
  }).join('\n');
  const productCases = goBoolCases(model.parity.productControl.methods);
  const ordinaryCases = goBoolCases(model.parity.ordinary.methods);
  const profileMethodRows = model.profiles.map((profile) => `\tcase ${JSON.stringify(profile.profileId)}:\n\t\treturn []FirstPartyProfileMethodEntry{\n${profile.methods.map((method) => `\t\t\t{MethodID: ${JSON.stringify(method.methodId)}, Kind: FirstPartyMethod${method.kind === 'unary' ? 'Unary' : 'ServerStream'}},`).join('\n')}\n\t\t}`).join('\n');
  const machine = profileById(model, 'desktop_machine_product_v1');
  const account = profileById(model, 'desktop_account_product_v1');
  const source = `${generatedHeader()}\npackage protectedlocal\n\ntype FirstPartyMethodKind string\n\nconst (\n\tFirstPartyMethodUnary FirstPartyMethodKind = "unary"\n\tFirstPartyMethodServerStream FirstPartyMethodKind = "server_stream"\n\tDesktopMachineProductProfileID = ${JSON.stringify(machine.profileId)}\n\tDesktopMachineProductNativeMarker = ${JSON.stringify(machine.nativeProfileMarker)}\n\tDesktopAccountProductProfileID = ${JSON.stringify(account.profileId)}\n\tDesktopAccountProductNativeMarker = ${JSON.stringify(account.nativeProfileMarker)}\n)\n\ntype FirstPartyProfileMethodEntry struct {\n\tMethodID string\n\tKind FirstPartyMethodKind\n}\n\nfunc FirstPartyProfileMethod(profileID, methodID string) (FirstPartyMethodKind, bool) {\n\tswitch profileID {\n${profileCases}\n\t}\n\treturn "", false\n}\n\nfunc FirstPartyProfileMethods(profileID string) []FirstPartyProfileMethodEntry {\n\tswitch profileID {\n${profileMethodRows}\n\tdefault:\n\t\treturn nil\n\t}\n}\n\nfunc IsFirstPartyProtectedProfileMethod(methodID string) bool {\n\tif _, ok := FirstPartyProfileMethod("desktop_machine_product_v1", methodID); ok {\n\t\treturn true\n\t}\n\tif _, ok := FirstPartyProfileMethod("desktop_account_product_v1", methodID); ok {\n\t\treturn true\n\t}\n\t_, ok := FirstPartyProfileMethod("bundled_avatar_v1", methodID)\n\treturn ok\n}\n\nfunc IsDesktopProductControlV1Method(methodID string) bool {\n\tswitch methodID {\n${productCases}\n\t\treturn true\n\tdefault:\n\t\treturn false\n\t}\n}\n\nfunc IsOrdinaryDesktopRuntimeConsumerV1Method(methodID string) bool {\n\tswitch methodID {\n${ordinaryCases}\n\t\treturn true\n\tdefault:\n\t\treturn false\n\t}\n}\n`;
  return execFileSync('gofmt', { input: source, encoding: 'utf8' });
}

function goBoolCases(methods) {
  return methods.map((method, index) => `${index === 0 ? '\tcase' : '\t\t'} ${JSON.stringify(method.methodId)}${index === methods.length - 1 ? ':' : ','}`).join('\n');
}

function renderGoAvatar(model) {
  const profile = profileById(model, 'bundled_avatar_v1');
  const cases = profile.methods.map((method) => `\tcase ${JSON.stringify(method.methodId)}:\n\t\treturn MethodProfile{Kind: ${method.kind === 'unary' ? 'MethodUnary' : 'MethodServerStream'}, Capability: ${JSON.stringify(method.capability)}}, true`).join('\n');
  const realmCases = profile.realmOperations.map((operation) => `\tcase ${JSON.stringify(operation)}:\n\t\treturn true`).join('\n');
  const source = `${generatedHeader()}\npackage bundledavatar\n\nconst (\n\tProfileID = "bundled_avatar_v1"\n\tAppID = ${JSON.stringify(profile.appId)}\n\tNativeProfileMarker = ${JSON.stringify(profile.nativeProfileMarker)}\n\tAppInstanceID = ${JSON.stringify(profile.accountCaller.app_instance_id)}\n\tDeviceID = ${JSON.stringify(profile.accountCaller.device_id)}\n)\n\ntype MethodKind string\n\nconst (\n\tMethodUnary MethodKind = "unary"\n\tMethodServerStream MethodKind = "server_stream"\n)\n\ntype MethodProfile struct {\n\tKind MethodKind\n\tCapability string\n}\n\nfunc Method(methodID string) (MethodProfile, bool) {\n\tswitch methodID {\n${cases}\n\tdefault:\n\t\treturn MethodProfile{}, false\n\t}\n}\n\nfunc RealmOperationAllowed(operationID string) bool {\n\tswitch operationID {\n${realmCases}\n\tdefault:\n\t\treturn false\n\t}\n}\n`;
  return execFileSync('gofmt', { input: source, encoding: 'utf8' });
}

function renderRustProfiles(model) {
  const productEnum = renderRustMethodEnum('DesktopProductControlMethod', model.parity.productControl.methods);
  const ordinaryEnum = renderRustMethodEnum('DesktopRuntimeConsumerMethod', model.parity.ordinary.methods);
  const machine = profileById(model, 'desktop_machine_product_v1');
  const account = profileById(model, 'desktop_account_product_v1');
  const machineUnaryEnum = renderRustMethodEnum('DesktopMachineProductUnaryMethod', machine.methods.filter((method) => method.kind === 'unary'));
  const machineStreamEnum = renderRustMethodEnum('DesktopMachineProductStreamMethod', machine.methods.filter((method) => method.kind === 'server_stream'));
  const accountUnaryEnum = renderRustMethodEnum('DesktopAccountProductUnaryMethod', account.methods.filter((method) => method.kind === 'unary'));
  const accountStreamEnum = renderRustMethodEnum('DesktopAccountProductStreamMethod', account.methods.filter((method) => method.kind === 'server_stream'));
  const avatar = profileById(model, 'bundled_avatar_v1');
  const avatarCases = avatar.methods.map((method) => `        ${JSON.stringify(method.methodId)} => Some(BundledAvatarMethodProfile { method_id: ${JSON.stringify(method.methodId)}, kind: BundledAvatarMethodKind::${method.kind === 'unary' ? 'Unary' : 'ServerStream'}, capability: ${JSON.stringify(method.capability)} }),`).join('\n');
  const source = `${generatedHeader()}\n${productEnum}\n${ordinaryEnum}\npub const DESKTOP_MACHINE_PRODUCT_PROFILE_ID: &str = ${JSON.stringify(machine.profileId)};\npub const DESKTOP_MACHINE_PRODUCT_NATIVE_PROFILE_MARKER: &str = ${JSON.stringify(machine.nativeProfileMarker)};\npub const DESKTOP_ACCOUNT_PRODUCT_PROFILE_ID: &str = ${JSON.stringify(account.profileId)};\npub const DESKTOP_ACCOUNT_PRODUCT_NATIVE_PROFILE_MARKER: &str = ${JSON.stringify(account.nativeProfileMarker)};\n\n${machineUnaryEnum}\n${machineStreamEnum}\n${accountUnaryEnum}\n${accountStreamEnum}\npub const BUNDLED_AVATAR_APP_ID: &str = ${JSON.stringify(avatar.appId)};\npub const BUNDLED_AVATAR_NATIVE_PROFILE_MARKER: &str = ${JSON.stringify(avatar.nativeProfileMarker)};\n\n#[derive(Clone, Copy, Debug, Eq, PartialEq)]\npub enum BundledAvatarMethodKind {\n    Unary,\n    ServerStream,\n}\n\n#[derive(Clone, Copy, Debug, Eq, PartialEq)]\npub struct BundledAvatarMethodProfile {\n    pub method_id: &'static str,\n    pub kind: BundledAvatarMethodKind,\n    pub capability: &'static str,\n}\n\n#[rustfmt::skip]\npub fn bundled_avatar_method_profile(method_id: &str) -> Option<BundledAvatarMethodProfile> {\n    match method_id {\n${avatarCases}\n        _ => None,\n    }\n}\n`;
  return formatRust(source);
}

function renderRustMethodEnum(name, methods) {
  const variants = methods.map((method) => rustVariant(method.rpc)).join(', ');
  const fromCases = methods.map((method) => `            ${JSON.stringify(method.methodId)} => Self::${rustVariant(method.rpc)},`).join('\n');
  const idCases = methods.map((method) => `            Self::${rustVariant(method.rpc)} => ${JSON.stringify(method.methodId)},`).join('\n');
  const constant = ({
    DesktopProductControlMethod: 'DESKTOP_PRODUCT_CONTROL_V1_METHODS',
    DesktopRuntimeConsumerMethod: 'ORDINARY_DESKTOP_RUNTIME_CONSUMER_V1_METHODS',
    DesktopMachineProductUnaryMethod: 'DESKTOP_MACHINE_PRODUCT_UNARY_METHODS',
    DesktopMachineProductStreamMethod: 'DESKTOP_MACHINE_PRODUCT_STREAM_METHODS',
    DesktopAccountProductUnaryMethod: 'DESKTOP_ACCOUNT_PRODUCT_UNARY_METHODS',
    DesktopAccountProductStreamMethod: 'DESKTOP_ACCOUNT_PRODUCT_STREAM_METHODS',
  })[name];
  if (!constant) throw new Error(`unknown Rust method enum: ${name}`);
  const array = methods.map((method) => `${name}::${rustVariant(method.rpc)}`).join(', ');
  return `#[rustfmt::skip]\n#[derive(Clone, Copy, Debug, Eq, PartialEq)]\npub enum ${name} { ${variants} }\n\nimpl ${name} {\n    pub fn from_method_id(method_id: &str) -> Option<Self> {\n        Some(match method_id {\n${fromCases}\n            _ => return None,\n        })\n    }\n\n    pub const fn method_id(self) -> &'static str {\n        match self {\n${idCases}\n        }\n    }\n}\n\n#[rustfmt::skip]\npub const ${constant}: &[${name}] = &[${array}];\n`;
}

function renderElectronProfiles(model) {
  const profiles = model.profiles.map((profile) => `  ${JSON.stringify(profile.profileId)}: {\n    identityClass: ${JSON.stringify(profile.identityClass)},\n    nativeProfileMarker: ${JSON.stringify(profile.nativeProfileMarker)},\n    methods: {\n${profile.methods.map((method) => `      ${JSON.stringify(method.methodId)}: { kind: ${JSON.stringify(method.kind)}, intentRefs: ${JSON.stringify(method.intentRefs)} },`).join('\n')}\n    },\n  },`).join('\n');
  const product = model.parity.productControl.methods.map((method) => `  ${JSON.stringify(method.methodId)},`).join('\n');
  const ordinary = model.parity.ordinary.methods.map((method) => `  ${JSON.stringify(method.methodId)},`).join('\n');
  return `${generatedHeader()}\nexport const NIMI_ELECTRON_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES = {\n${profiles}\n} as const;\n\nexport const NIMI_ELECTRON_PRODUCT_CONTROL_V1_METHODS: ReadonlySet<string> = new Set([\n${product}\n]);\n\nexport const NIMI_ELECTRON_ORDINARY_RUNTIME_CONSUMER_V1_METHODS: ReadonlySet<string> = new Set([\n${ordinary}\n]);\n\nexport function isNimiElectronProductControlV1Method(methodId: string): boolean {\n  return NIMI_ELECTRON_PRODUCT_CONTROL_V1_METHODS.has(methodId.trim());\n}\n\nexport function isNimiElectronOrdinaryRuntimeConsumerV1Method(methodId: string): boolean {\n  return NIMI_ELECTRON_ORDINARY_RUNTIME_CONSUMER_V1_METHODS.has(methodId.trim());\n}\n\nexport type NimiElectronDesktopMachineProductMethodId = keyof typeof NIMI_ELECTRON_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES.desktop_machine_product_v1.methods;\nexport type NimiElectronDesktopAccountProductMethodId = keyof typeof NIMI_ELECTRON_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES.desktop_account_product_v1.methods;\n\nexport function isNimiElectronDesktopMachineProductMethod(methodId: string, kind: 'unary' | 'server_stream'): methodId is NimiElectronDesktopMachineProductMethodId {\n  return NIMI_ELECTRON_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES.desktop_machine_product_v1.methods[methodId as NimiElectronDesktopMachineProductMethodId]?.kind === kind;\n}\n\nexport function isNimiElectronDesktopAccountProductMethod(methodId: string, kind: 'unary' | 'server_stream'): methodId is NimiElectronDesktopAccountProductMethodId {\n  return NIMI_ELECTRON_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES.desktop_account_product_v1.methods[methodId as NimiElectronDesktopAccountProductMethodId]?.kind === kind;\n}\n`;
}

function renderElectronAvatar(model) {
  const profile = profileById(model, 'bundled_avatar_v1');
  const records = profile.methods.map((method) => `  ${JSON.stringify(method.methodId)}: { kind: ${JSON.stringify(method.kind)}, capability: ${JSON.stringify(method.capability)} },`).join('\n');
  return `${generatedHeader()}\nexport const NIMI_ELECTRON_BUNDLED_AVATAR_PROFILE_ID = 'bundled_avatar_v1' as const;\nexport const NIMI_ELECTRON_BUNDLED_AVATAR_APP_ID = ${JSON.stringify(profile.appId)} as const;\nexport const NIMI_ELECTRON_BUNDLED_AVATAR_APP_INSTANCE_ID = ${JSON.stringify(profile.accountCaller.app_instance_id)} as const;\nexport const NIMI_ELECTRON_BUNDLED_AVATAR_DEVICE_ID = ${JSON.stringify(profile.accountCaller.device_id)} as const;\n\nexport const NIMI_ELECTRON_BUNDLED_AVATAR_METHODS = {\n${records}\n} as const;\n\nexport type NimiElectronBundledAvatarMethodId = keyof typeof NIMI_ELECTRON_BUNDLED_AVATAR_METHODS;\n\nexport function isNimiElectronBundledAvatarUnaryMethod(methodId: string): methodId is NimiElectronBundledAvatarMethodId {\n  return NIMI_ELECTRON_BUNDLED_AVATAR_METHODS[methodId as NimiElectronBundledAvatarMethodId]?.kind === 'unary';\n}\n\nexport function isNimiElectronBundledAvatarServerStreamMethod(methodId: string): methodId is NimiElectronBundledAvatarMethodId {\n  return NIMI_ELECTRON_BUNDLED_AVATAR_METHODS[methodId as NimiElectronBundledAvatarMethodId]?.kind === 'server_stream';\n}\n`;
}

function renderSdkProfiles(model) {
  const profiles = model.profiles.map((profile) => `  ${JSON.stringify(profile.profileId)}: {\n    identityClass: ${JSON.stringify(profile.identityClass)},\n    principalPolicyRef: ${JSON.stringify(profile.principalPolicyRef)},\n    invalidationPolicyRef: ${JSON.stringify(profile.invalidationPolicyRef)},\n    methods: {\n${profile.methods.map((method) => `      ${JSON.stringify(method.methodId)}: { typedMethod: ${JSON.stringify(method.methodName)}, kind: ${JSON.stringify(method.kind)}, intentRefs: ${JSON.stringify(method.intentRefs)} },`).join('\n')}\n    },\n  },`).join('\n');
  const groups = model.profiles.map((profile) => `  ${JSON.stringify(profile.profileId)}: ${JSON.stringify(profile.methods.map((method) => method.methodName))},`).join('\n');
  return `${generatedHeader()}\nimport type { RuntimeTypedClient } from '../core-generated/runtime-typed-client';\n\nexport const NIMI_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES = {\n${profiles}\n} as const;\n\nexport const NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS = {\n${groups}\n} as const satisfies Readonly<Record<string, readonly (keyof RuntimeTypedClient)[]>>;\n\nexport type NimiFirstPartyProtectedRuntimeProfileId = keyof typeof NIMI_FIRST_PARTY_PROTECTED_RUNTIME_PROFILES;\nexport type DesktopMachineProductRuntimeMethods = Pick<RuntimeTypedClient, typeof NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS.desktop_machine_product_v1[number]>;\nexport type DesktopAccountProductRuntimeMethods = Pick<RuntimeTypedClient, typeof NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS.desktop_account_product_v1[number]>;\n`;
}

function renderSdkAvatar(model) {
  const profile = profileById(model, 'bundled_avatar_v1');
  const groupByService = new Map([
    ['RuntimeAuditService', 'audit'], ['RuntimeAccountService', 'account'],
    ['RuntimeAgentService', 'agents'], ['RuntimeArtifactService', 'artifacts'],
    ['RuntimeAiService', 'ai'], ['RuntimeAppService', 'appMessages'],
  ]);
  const groups = new Map();
  for (const method of profile.methods) {
    const group = groupByService.get(method.service);
    if (!group) throw new Error(`Bundled Avatar SDK method service is not mapped: ${method.service}`);
    groups.set(group, [...(groups.get(group) ?? []), method.methodName]);
  }
  const renderedGroups = [...groups.entries()].map(([group, names]) => `  ${group}: ${JSON.stringify(names)},`).join('\n');
  return `${generatedHeader()}\nimport type { RuntimeTypedClient } from '../core-generated/runtime-typed-client';\n\nexport const NIMI_BUNDLED_AVATAR_APP_ID = ${JSON.stringify(profile.appId)} as const;\nexport const NIMI_BUNDLED_AVATAR_APP_INSTANCE_ID = ${JSON.stringify(profile.accountCaller.app_instance_id)} as const;\nexport const NIMI_BUNDLED_AVATAR_DEVICE_ID = ${JSON.stringify(profile.accountCaller.device_id)} as const;\n\nexport const NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS = {\n${renderedGroups}\n} as const satisfies Readonly<Record<string, readonly (keyof RuntimeTypedClient)[]>>;\n\nexport type NimiBundledAvatarTypedMethodName = typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS[keyof typeof NIMI_BUNDLED_AVATAR_TYPED_METHOD_GROUPS][number];\n`;
}

function renderManifest(model, source, outputDigests) {
  const data = {
    schemaVersion: 1,
    compiler: COMPILER_RELATIVE,
    source: SOURCE_RELATIVE,
    sourceSha256: sha256(source),
    profiles: Object.fromEntries(model.profiles.map((profile) => [profile.profileId, {
      identityClass: profile.identityClass,
      unary: profile.methods.filter((method) => method.kind === 'unary').length,
      serverStream: profile.methods.filter((method) => method.kind === 'server_stream').length,
      total: profile.methods.length,
      fingerprintSha256: profile.fingerprint,
    }])),
    parityViews: Object.fromEntries(Object.values(model.parity).map((view) => [view.name, {
      unary: view.unary, serverStream: view.serverStream, total: view.methods.length,
      fingerprintSha256: view.fingerprint,
      ...(view.capabilityFingerprint ? { capabilityFingerprintSha256: view.capabilityFingerprint } : {}),
    }])),
    outputSha256: outputDigests,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

function findCompilerOwnedFiles(repoRoot) {
  const roots = ['runtime/internal', 'kit/shell', 'sdks/typescript/runtime'];
  const found = [];
  for (const root of roots) walk(path.join(repoRoot, root));
  return found;
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === 'dist' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else {
        const prefix = fs.readFileSync(absolute, 'utf8').slice(0, 300);
        if (prefix.includes(`Code generated by ${COMPILER_RELATIVE}`)) found.push(path.relative(repoRoot, absolute).split(path.sep).join('/'));
      }
    }
  }
}

function profileById(model, profileId) {
  const profile = model.profiles.find((candidate) => candidate.profileId === profileId);
  if (!profile) throw new Error(`profile is missing: ${profileId}`);
  return profile;
}

function rustVariant(rpc) {
  return rpc.replaceAll('AI', 'Ai').replaceAll('ID', 'Id');
}

function fingerprint(methods) {
  return sha256(methods.map((method) => `${method.methodId}|${method.kind}`).sort().join('\n'));
}

function formatRust(source) {
  return execFileSync('rustfmt', ['--emit', 'stdout'], { input: source, encoding: 'utf8' });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) if (!allowed.has(field)) throw new Error(`${label} has unknown field: ${field}`);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) throw new Error(`${label} must be a non-empty trimmed string`);
  return value;
}

function requireNonEmptyStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty string array`);
  const seen = new Set();
  for (const item of value) {
    requireString(item, label);
    if (seen.has(item)) throw new Error(`${label} contains duplicate: ${item}`);
    seen.add(item);
  }
}
