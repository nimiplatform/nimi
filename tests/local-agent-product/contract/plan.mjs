import path from 'node:path';
import { repoRoot } from '../harness/registry.mjs';

const configuredRealmRoot = String(process.env.REALM_ROOT || '').trim();
const realmRoot = configuredRealmRoot
  ? path.resolve(configuredRealmRoot)
  : path.join(repoRoot, '.external-realm-unconfigured');
const runtimeRoot = path.join(repoRoot, 'runtime');

function step(owner, command, args, cwd, expectedMarker = '') {
  return { owner, command, args, cwd, expectedMarker };
}

function runtimeTest(name) {
  return step('runtime', 'go', ['test', './internal/services/runtimeagent', '-run', `^${name}$`, '-count=1', '-v'], runtimeRoot, name);
}

function realmTest(file, name) {
  return step('realm', 'pnpm', ['--dir', realmRoot, '--filter', '@nimi/backend', 'exec', 'vitest', 'run', file, '-t', name, '--reporter=verbose'], realmRoot, name);
}

function sdkTest(name, file = 'runtime-facade.test.ts') {
  return step('sdk', process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern', name, path.join(repoRoot, 'sdks/typescript/runtime', file)], repoRoot, name);
}

function kitTest(name, file = 'agent-center-source-context-projection.test.ts') {
  return step('kit', 'pnpm', ['exec', 'vitest', 'run', '--reporter=verbose', '--config', 'ui/vitest.config.ts', `features/agent-center/test/${file}`, '-t', name], path.join(repoRoot, 'kit'), name);
}

function zhiyuTest(name, file) {
  return step('zhiyu', process.execPath, ['--import', 'tsx', '--test', '--test-name-pattern', name, path.join(repoRoot, 'apps/zhiyu/test', file)], repoRoot, name);
}

function nodeTest(name, file) {
  return step('platform', process.execPath, ['--test', '--test-name-pattern', name, path.join(repoRoot, file)], repoRoot, name);
}

function gate(name, args = []) {
  return step('platform', 'pnpm', [name, ...args], repoRoot);
}

const producerService = 'libs/domains/world/src/source-materialization.service.spec.ts';
const producerSchema = 'libs/domains/world/src/source-materialization.schema.spec.ts';
const producerJcs = 'libs/domains/world/src/source-materialization-jcs.spec.ts';
const rt = runtimeTest;

// Historical PR-C repeated these 32 deterministic mutation/property leaves
// 100 times. The exhaustive suite preserves that logical coverage while
// grouping identical low-level commands instead of scheduling by leaf.
export const exhaustiveRepeatByLeaf = new Map([
  ...[
    'M-03-02', 'M-03-03', 'M-03-04', 'M-03-05',
    'M-04-01', 'M-04-02', 'M-04-03',
    'M-05-01', 'M-05-02', 'M-05-03', 'M-05-04', 'M-05-05', 'M-05-06',
    'K-01-01', 'K-01-02', 'K-01-03', 'K-01-04', 'K-01-05', 'K-03-05',
    'E-01-01', 'E-01-02', 'E-01-03', 'E-01-04', 'E-01-09',
    'E-02-01', 'E-02-02', 'E-02-03', 'E-02-04', 'E-02-05', 'E-02-06',
    'E-07-03', 'E-07-04',
  ].map((leafId) => [leafId, 100]),
]);

export const contractPlanByLeaf = new Map([
  ['R-03', [realmTest(producerService, 'recomputes every hash layer and changes semantic hashes only for semantic changes')]],
  ['R-04-04', [realmTest('libs/domains/world/src/character-core.service.spec.ts', 'keeps PersonaCharacterCore worldId fixed during replacement')]],
  ['M-03-01', [rt('TestVerifySourceMaterializationPacketV3ReferenceVectors')]],
  ['M-03-02', [rt('TestVerifySourceMaterializationPacketV3NegativeManifest')]],
  ['M-03-03', [realmTest(producerService, 'detects component, coverage, context, payload, manifest, packet, and proof tampering')]],
  ['M-03-04', [rt('TestVerifySourceMaterializationPacketV3NegativeManifest')]],
  ['M-03-05', [realmTest(producerService, 'detects component, coverage, context, payload, manifest, packet, and proof tampering')]],
  ['M-04-01', [realmTest(producerJcs, 'produces identical canonical bytes and hashes for equivalent object key order')]],
  ['M-04-02', [realmTest(producerJcs, 'preserves semantic array order and content changes in the digest')]],
  ['M-04-03', [realmTest(producerService, 'recomputes every hash layer and changes semantic hashes only for semantic changes')]],
  ['M-05-01', [rt('TestSourceMaterializationV3RejectsClosedSchemaAndNormalizedKeyViolations')]],
  ['M-05-02', [rt('TestSourceMaterializationV3RejectsClosedSchemaAndNormalizedKeyViolations')]],
  ['M-05-03', [rt('TestSourceMaterializationPacketStreamV3RejectsLexicalAndClosedSchemaMutations')]],
  ['M-05-04', [realmTest(producerSchema, 'rejects unknown source kind without coercion or stripping')]],
  ['M-05-05', [rt('TestVerifySourceMaterializationPacketV3ExpectationBindings')]],
  ['M-05-06', [realmTest(producerService, 'rejects v1, anonymous payloads, display metadata, and Character/Persona union mismatch')]],

  ['K-04', [
    kitTest('fails closed for partial, unknown, raw, and cross-source input'),
    zhiyuTest('source/context product path has no renderer fixture projection hook', 'local-agent-selection.test.mjs'),
    gate('check:local-agent-full-chain-hardcut', ['--', '--scope', 'all']),
  ]],
  ['K-01-01', [sdkTest('Runtime facade materializes a Realm source from sourceRef and requestId only')]],
  ['K-01-02', [sdkTest('Runtime facade materialization fails closed without injected subject context')]],
  ['K-01-03', [sdkTest('rejects mismatched or partial READY source status')]],
  ['K-01-04', [sdkTest('rejects unknown Runtime enums')]],
  ['K-01-05', [sdkTest('Runtime facade rejects invalid source branch, world binding, and source hash before transport')]],
  ['K-03-02', [kitTest('maps capacity exhaustion to blocked'), zhiyuTest('projects SDK/Kit bounded ready', 'local-agent-selection.test.mjs')]],
  ['K-03-03', [kitTest('maps the five closed product states'), zhiyuTest('projects SDK/Kit bounded ready', 'local-agent-selection.test.mjs')]],
  ['K-03-04', [kitTest('maps the five closed product states'), kitTest('lets Zhiyu inject a Chinese copy namespace', 'agent-center-ui.test.tsx')]],
  ['K-03-05', [kitTest('fails closed across 100 deterministic partial')]],
  ['L-03-01', [rt('TestAgentAIConfigReadinessTargetRefMissingIsUnavailable')]],
  ['L-03-03', [rt('TestAgentAIConfigReadinessUsesCapabilitySpecificReasons')]],
  ['L-03-04', [sdkTest('projects revision conflicts as typed concurrent modification', 'runtime-agent-ai-config.test.ts'), rt('TestSubscribeRuntimeAgentAIConfigReadinessInitialAndMutationSnapshots')]],

  ['C-06-01', [rt('TestAgentTurnSourcePromptInjectionCannotGainAuthorityOrTools')]],
  ['C-06-02', [rt('TestAgentTurnContextRejectsUnverifiedSnapshotAndUnadmittedMedia')]],
  ['C-06-03', [rt('TestAgentTurnContextLocalAndCloudRoutesPreserveSemanticPromptIdentity')]],
  ['C-07-01', [rt('TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder')]],
  ['C-07-02', [rt('TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder')]],
  ['C-07-03', [rt('TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder')]],
  ['C-07-04', [rt('TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder')]],
  ['C-07-05', [rt('TestAgentTurnContextBudgetTruncatesWholeItemsInFixedOrder')]],
  ['C-07-06', [rt('TestAgentTurnContextMandatoryOverflowFailsClosedWithTypedSummary')]],

  ['S-06', [nodeTest('result rejects privacy findings', 'tests/local-agent-product/harness/harness.test.mjs')]],
  ['S-07', [gate('check:local-agent-full-chain-hardcut', ['--', '--scope', 'all'])]],
  ['S-01-02', [rt('TestVerifyAndNormalizeSourceMaterializationV2RejectsClosedSchemaAndCoverageTampering')]],
  ['S-01-03', [rt('TestVerifyAndNormalizeSourceMaterializationV2RejectsClosedSchemaAndCoverageTampering')]],
  ['S-01-08', [rt('TestSourceMaterializationTTLExpiresIssuedAndOpenState')]],
  ['S-01-09', [rt('TestSourceMaterializationManifestAcceptsExactLimitsAndRejectsEachLimitPlusOne')]],
  ['S-01-10', [rt('TestSourceMaterializationTransportCapacityBoundaries')]],
  ['S-01-11', [rt('TestSourceMaterializationTransportCapacityBoundaries')]],
  ['S-01-12', [rt('TestVerifyAndNormalizeSourceMaterializationV2RejectsClosedSchemaAndCoverageTampering')]],
  ['S-01-13', [rt('TestSourceMaterializationBeginAndPutRequestConflictsFailClosed')]],
  ['S-01-14', [rt('TestSourceMaterializationBeginAndPutRequestConflictsFailClosed')]],
  ['S-01-17', [rt('TestSourceMaterializationCommitAdmissionFailureRollsBackAndClearsRawBytes')]],
  ['S-01-20', [rt('TestSourceMaterializationTTLExpiresIssuedAndOpenState')]],
  ['S-02-02', [rt('TestPublicChatTurnRequestRejectsCallerSystemPrompt'), rt('TestPublicChatTurnRequestRejectsCallerContextAuthority')]],

  ...['E-01-01', 'E-01-02', 'E-01-03', 'E-01-04', 'E-01-05', 'E-01-06', 'E-01-07', 'E-01-08', 'E-01-09']
    .map((id) => [id, [rt('TestPublicChatCommittedAPMLActivityReachesTypedStream')]]),
  ...['E-02-01', 'E-02-02', 'E-02-03', 'E-02-04', 'E-02-05']
    .map((id) => [id, [rt('TestPublicChatTurnInvalidAPMLFailsClosedWithoutRepairOrCommit')]]),
  ['E-02-06', [rt('TestPublicChatTurnRequestRejectsUnknownEmotionBeforeCommit')]],
  ['E-05-02', [rt('TestPublicChatImageActionFailsClosedWithoutImageBinding')]],
  ['E-06-03', [rt('TestPublicChatCommittedTurnSkipsVoiceLipsyncProjectionWithoutAvatarAutoplay')]],
  ['E-07-03', [rt('TestPublicChatVoiceAndLipsyncTimelinePayloadValidationRejectsMalformedInput')]],
  ['E-07-04', [rt('TestPublicChatVoiceAndLipsyncTimelinePayloadValidationRejectsMalformedInput')]],
]);
