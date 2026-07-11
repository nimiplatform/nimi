#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { fullScopeAppCodeFindings } from './lib/local-agent-full-chain-app-scan.mjs';
import { runtimeMaterializationCodeFindings } from './lib/local-agent-runtime-materialization-hardcut.mjs';
import { runtimeContextConsumerCodeFindings } from './lib/local-agent-runtime-context-hardcut.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const validScopes = new Set(['runtime-authority', 'consumer-authority', 'authority', 'runtime-materialization', 'runtime-consumer', 'all']);
const textExtensions = new Set(['.md', '.yaml', '.yml']);
const excludedDirectoryNames = new Set([
  '.git',
  '.local',
  'archive',
  'evidence',
  'gen',
  'generated',
  'historical',
  'history',
  'local',
  'node_modules',
  'plan',
  'plans',
]);

const scopeRoots = {
  'runtime-authority': ['.nimi/spec/runtime/kernel'],
  'consumer-authority': [
    '.nimi/spec/sdks',
    '.nimi/spec/platform',
    '.nimi/spec/desktop',
    '.nimi/spec/zhiyu',
  ],
};

const ownerPaths = {
  runtimeMaterialization: '.nimi/spec/runtime/kernel/runtime-local-agent-materialization-contract.md',
  runtimeService: '.nimi/spec/runtime/kernel/runtime-agent-service-contract.md',
  runtimeContext: '.nimi/spec/runtime/kernel/runtime-agent-context-composition-contract.md',
  sdkRuntime: '.nimi/spec/sdks/kernel/runtime-contract.md',
  sdkBoundary: '.nimi/spec/sdks/kernel/boundary-contract.md',
  platformAgentCenter: '.nimi/spec/platform/kernel/agent-center-contract.md',
  platformTestGovernance: '.nimi/spec/platform/kernel/test-governance-contract.md',
  platformKitRegistry: '.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml',
  desktopExplore: '.nimi/spec/desktop/kernel/explore-surface-contract.md',
  desktopChat: '.nimi/spec/desktop/kernel/agent-chat-projection-contract.md',
  desktopSourceActions: '.nimi/spec/desktop/kernel/tables/realm-source-materialization-actions.yaml',
  incorrectDesktopSourceActions: '.nimi/spec/desktop/kernel/tables/source-materialization-actions.yaml',
  retiredDesktopPersonaActions: '.nimi/spec/desktop/kernel/tables/realm-persona-materialization-actions.yaml',
  zhiyuAuthority: '.nimi/spec/zhiyu/kernel/authority-boundary-contract.md',
  scenarioCatalog: '.nimi/plan/2026-07-10-realm-local-agent-chat-e2e/scenario-leaf-catalog.md',
};

const expectedTraceabilityMappings = new Map([
  ['R-SRC-09', ['R-CORE-009', 'K-AGCORE-151']],
  ['R-CTX-01', ['K-AGCORE-154', 'K-AGCORE-155', 'K-AGCORE-157', 'K-AGCORE-158', 'S-RUNTIME-103', 'S-RUNTIME-107', 'S-SURFACE-021', 'D-LLM-022', 'D-LLM-023', 'Z-AUTH-004', 'Z-AUTH-005', 'Z-AUTH-006']],
  ['R-CTX-02', ['K-AGCORE-154', 'K-AGCORE-158', 'S-RUNTIME-103', 'S-RUNTIME-107', 'S-SURFACE-021', 'D-LLM-022', 'Z-AUTH-005', 'Z-AUTH-006']],
  ['R-CTX-03', ['K-AGCORE-155']],
  ['R-CTX-04', ['K-AGCORE-033', 'K-AGCORE-034', 'K-AGCORE-035', 'K-AGCORE-156']],
  ['R-CTX-05', ['K-AGCORE-140', 'K-AGCORE-142', 'K-AGCORE-155', 'K-AGCORE-157']],
  ['R-CTX-06', ['K-AGCORE-154', 'K-AGCORE-156']],
  ['R-CTX-07', ['K-AGCORE-156']],
  ['R-BEH-01', ['K-AGCORE-154', 'K-AGCORE-155', 'K-AGCORE-157', 'K-AGCORE-158', 'P-TEST-010', 'P-TEST-014']],
  ['R-BEH-02', ['K-AGCORE-139', 'K-AGCORE-140', 'K-AGCORE-142', 'K-AGCORE-152', 'K-AGCORE-155', 'P-TEST-009', 'P-TEST-011', 'P-TEST-014']],
  ['R-BEH-03', ['K-AGCORE-159', 'K-AGCORE-160', 'P-TEST-009', 'P-TEST-012', 'P-TEST-013', 'P-TEST-014']],
]);

function markdownOwner(relPath, ruleId) {
  return { kind: 'markdown', relPath, ruleId };
}

function yamlOwner(relPath, field, value) {
  return { kind: 'yaml', relPath, field, value };
}

function governingRelation(subject, action, object, value, polarity, passiveAction, inverse = {}) {
  return {
    subject,
    action,
    object,
    value,
    polarity,
    passiveAction,
    inverseSubject: inverse.subject ?? subject,
    inverseObject: inverse.object ?? object,
    inverseValue: inverse.value,
    inversePolarity: inverse.polarity ?? polarity,
  };
}

function requirement(id, owners, relation) {
  return { id, owners, relation };
}

function markdownRelationRequirement(id, relPath, ruleId, relationArgs, inverse) {
  return requirement(id, [markdownOwner(relPath, ruleId)], governingRelation(...relationArgs, inverse));
}

const runtimeRequirements = [
  requirement('LAHC-R001', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('runtime', 'own', 'source-materialization-challenge-replay-upload-state', 'runtime-owned', 'require', 'owned-by', {
    subject: 'realm',
    value: 'realm-owned',
  })),
  requirement('LAHC-R002', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('local-agent-source-snapshot-v1', 'set-mutability', 'execution-state', 'immutable', 'require', 'mutability-set-by', {
    value: 'mutable',
  })),
  requirement('LAHC-R003', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('local-agent-source-snapshot-v1', 'persist', 'raw-source-materialization-packet', 'denied', 'forbid', 'persisted-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R004', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('local-agent-source-snapshot-v1', 'rebase', 'realm-source-changes', 'denied', 'forbid', 'rebased-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R005', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('local-agent-source-snapshot-v1', 'write-back', 'realm-source-truth', 'denied', 'forbid', 'written-back-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R006', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('runtime-localagent-agent-state', 'write-back', 'realm-source-truth', 'denied', 'forbid', 'written-back-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R007', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139'),
  ], governingRelation('runtime', 'accept', 'hmac-source-materialization-proof', 'denied', 'forbid', 'accepted-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R008', [
    markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-140'),
  ], governingRelation('runtime', 'accept', 'packet-supplied-systempromptbase', 'denied', 'forbid', 'accepted-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R009', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-005'),
  ], governingRelation('runtime', 'accept', 'consumer-attached-localagent-turn-context', 'denied', 'forbid', 'accepted-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-R010', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('runtime', 'compose', 'agentturncontextmanifestv1', 'runtime-owned', 'require', 'composed-by', {
    subject: 'desktop',
    value: 'desktop-owned',
  })),
  requirement('LAHC-R011', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('agentturncontextmanifestv1', 'use-lanes', 'turn-context', 'fixed-typed', 'require', 'lanes-used-by', {
    value: 'dynamic-typed',
  })),
  requirement('LAHC-R012', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('localagent-source-content-and-prompt-hashes', 'set-stability', 'equivalent-source-content', 'stable', 'require', 'stability-set-by', {
    value: 'ephemeral',
  })),
  requirement('LAHC-R013', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('manifest-instance-hash', 'set-specificity', 'request-turn-instance', 'instance-specific', 'require', 'specificity-set-by', {
    subject: 'localagent-source-snapshot-hash',
    object: 'identical-normalized-materialization',
    value: 'instance-specific',
  })),
  requirement('LAHC-R014', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('agentturncontextmanifestv1', 'carry', 'transcript-context', 'runtime-owned', 'require', 'carried-by', {
    value: 'omitted',
  })),
  requirement('LAHC-R015', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('agentturncontextmanifestv1', 'carry', 'memory-context', 'bounded', 'require', 'carried-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-R016', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('agentturncontextmanifestv1', 'carry', 'token-budget', 'explicit', 'require', 'carried-by', {
    value: 'implicit',
  })),
  requirement('LAHC-R017', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('agentturncontextmanifestv1', 'carry', 'truncation-decisions', 'observable', 'require', 'carried-by', {
    value: 'hidden',
  })),
  requirement('LAHC-R018', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('runtime', 'project', 'invalid-apml', 'denied-fail-closed', 'forbid', 'projected-by', {
    value: 'allowed-fail-open',
    polarity: 'require',
  })),
  requirement('LAHC-R019', [
    markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006'),
  ], governingRelation('runtime-public-localagent-summaries', 'project', 'public-summary', 'safe-bounded', 'require', 'projected-by', {
    value: 'unbounded',
  })),
  ...['source', 'prompt', 'memory', 'proof'].map((field, index) => requirement(
    `LAHC-R0${20 + index}`,
    [markdownOwner(ownerPaths.runtimeService, 'K-AGCORE-006')],
    governingRelation('runtime-public-localagent-summaries', 'expose', `raw-${field}`, 'denied', 'forbid', 'exposed-by', {
      value: 'allowed',
      polarity: 'require',
    }),
  )),
  ...['source', 'prompt', 'context', 'proof'].map((field, index) => requirement(
    `LAHC-R0${24 + index}`,
    [markdownOwner(ownerPaths.runtimeMaterialization, 'K-AGCORE-139')],
    governingRelation('runtime', 'derive', `${field}-authority-from-app-metadata-fallback`, 'denied', 'forbid', 'derived-by', {
      value: 'allowed',
      polarity: 'require',
    }),
  )),
  ...[
    ['LAHC-R028', 'K-AGCORE-159', ['runtime', 'execute', 'live-behavior-subject-ai', 'runtime-ai-execution', 'require', 'executed-by'], { subject: 'app-or-test-runner', value: 'direct-provider-execution' }],
    ['LAHC-R029', 'K-AGCORE-159', ['runtime', 'execute', 'semantic-behavior-evaluator-ai', 'runtime-ai-execution', 'require', 'executed-by'], { subject: 'app-or-test-runner', value: 'direct-provider-execution' }],
    ['LAHC-R030', 'K-AGCORE-159', ['subject-evaluator-route-fingerprints', 'set-independence', 'behavior-evaluation', 'complete-and-distinct', 'require', 'independence-set-by'], { value: 'missing-unproven-or-equal' }],
    ['LAHC-R031', 'K-AGCORE-159', ['app-or-test-runner', 'call', 'behavior-provider-or-model-directly', 'denied', 'forbid', 'called-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R032', 'K-AGCORE-159', ['app-or-test-runner', 'supply', 'behavior-provider-model-constant-or-binding', 'denied', 'forbid', 'supplied-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R033', 'K-AGCORE-160', ['runtime-evaluator-execution', 'set-isolation', 'product-agent-state', 'separate-evaluation-scope', 'require', 'isolation-set-by'], { value: 'shared-product-scope' }],
    ['LAHC-R034', 'K-AGCORE-160', ['runtime-evaluator-execution', 'use', 'product-anchor-or-memory-scope', 'denied', 'forbid', 'used-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R035', 'K-AGCORE-160', ['runtime-evaluator-execution', 'read', 'raw-system-prompt-or-private-context-lanes', 'denied', 'forbid', 'read-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R036', 'K-AGCORE-160', ['runtime-evaluator-result', 'admit', 'behavior-score', 'strict-json-schema-only', 'require', 'admitted-by'], { value: 'free-form-or-malformed' }],
    ['LAHC-R037', 'K-AGCORE-160', ['runtime-evaluator-execution', 'retry', 'provider-attempt', 'denied', 'forbid', 'retried-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R038', 'K-AGCORE-160', ['runtime-evaluator-execution', 'commit', 'product-turn-message-transcript-memory-localagent-state', 'denied', 'forbid', 'committed-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R039', 'K-AGCORE-160', ['runtime-evaluator-score', 'become', 'personality-or-context-truth', 'denied', 'forbid', 'become-by'], { value: 'allowed', polarity: 'require' }],
  ].map(([id, ruleId, relationArgs, inverse]) => (
    markdownRelationRequirement(id, ownerPaths.runtimeContext, ruleId, relationArgs, inverse)
  )),
];

const consumerRequirements = [
  requirement('LAHC-C001', [
    markdownOwner(ownerPaths.sdkRuntime, 'S-RUNTIME-107'),
  ], governingRelation('sdk', 'consume-status', 'localagent-source', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C002', [
    markdownOwner(ownerPaths.sdkRuntime, 'S-RUNTIME-107'),
  ], governingRelation('sdk', 'consume-status', 'localagent-context', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C003', [
    markdownOwner(ownerPaths.platformAgentCenter, 'P-AGENT-CENTER-001'),
    yamlOwner(ownerPaths.platformKitRegistry, 'id', 'kit.features.agent-center'),
  ], governingRelation('kit-agent-center', 'consume-status', 'localagent-source', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C004', [
    markdownOwner(ownerPaths.platformAgentCenter, 'P-AGENT-CENTER-002'),
    yamlOwner(ownerPaths.platformKitRegistry, 'id', 'kit.features.agent-center'),
  ], governingRelation('kit-agent-center', 'consume-status', 'localagent-context', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C005', [
    markdownOwner(ownerPaths.desktopExplore, 'D-EXPL-006'),
  ], governingRelation('desktop', 'consume-status', 'localagent-source', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C006', [
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-022'),
  ], governingRelation('desktop', 'consume-status', 'localagent-context', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C007', [
    markdownOwner(ownerPaths.zhiyuAuthority, 'Z-AUTH-005'),
  ], governingRelation('zhiyu', 'consume-status', 'localagent-source', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C008', [
    markdownOwner(ownerPaths.zhiyuAuthority, 'Z-AUTH-005'),
  ], governingRelation('zhiyu', 'consume-status', 'localagent-context', 'bounded-only', 'require', 'status-consumed-by', {
    value: 'unbounded',
  })),
  requirement('LAHC-C009', [
    markdownOwner(ownerPaths.desktopExplore, 'D-EXPL-006'),
  ], governingRelation('desktop-materialization-actions', 'set-authority', 'source-materialization', 'source-generic', 'require', 'authority-set-by', {
    value: 'persona-only',
  })),
  requirement('LAHC-C010', [
    markdownOwner(ownerPaths.platformAgentCenter, 'P-AGENT-CENTER-006'),
  ], governingRelation('apps', 'own', 'localagent-intent-and-presentation', 'app-owned', 'require', 'owned-by', {
    subject: 'runtime',
    value: 'runtime-owned',
  })),
  requirement('LAHC-C011', [
    markdownOwner(ownerPaths.sdkBoundary, 'S-BOUNDARY-007'),
    yamlOwner(ownerPaths.platformKitRegistry, 'id', 'kit.features.chat'),
  ], governingRelation('ordinary-nimi-chat', 'preserve', 'prompt-authority', 'unchanged', 'require', 'preserved-by', {
    value: 'changed-by-localagent-context',
  })),
  requirement('LAHC-C012', [
    markdownOwner(ownerPaths.sdkBoundary, 'S-BOUNDARY-007'),
  ], governingRelation('sdk', 'assemble', 'localagent-prompts', 'denied', 'forbid', 'assembled-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-C013', [
    markdownOwner(ownerPaths.platformAgentCenter, 'P-AGENT-CENTER-005'),
    markdownOwner(ownerPaths.platformAgentCenter, 'P-AGENT-CENTER-006'),
    yamlOwner(ownerPaths.platformKitRegistry, 'id', 'kit.features.agent-center'),
  ], governingRelation('kit-agent-center', 'assemble', 'localagent-context', 'denied', 'forbid', 'assembled-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-C014', [
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-023'),
  ], governingRelation('desktop', 'assemble', 'localagent-prompts', 'denied', 'forbid', 'assembled-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-C015', [
    markdownOwner(ownerPaths.zhiyuAuthority, 'Z-AUTH-004'),
  ], governingRelation('zhiyu', 'assemble', 'localagent-prompts', 'denied', 'forbid', 'assembled-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-C016', [
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-022'),
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-024'),
  ], governingRelation('realmprofilecontext', 'influence', 'localagent-source-authority', 'denied', 'forbid', 'influenced-by', {
    value: 'allowed',
    polarity: 'require',
  })),
  requirement('LAHC-C017', [
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-023'),
    markdownOwner(ownerPaths.desktopChat, 'D-LLM-024'),
  ], governingRelation('realmprofilecontext', 'influence', 'localagent-turn-context-authority', 'denied', 'forbid', 'influenced-by', {
    value: 'allowed',
    polarity: 'require',
  })),
];

const behaviorEvaluationRequirements = [
  ['LAHC-B001', 'P-TEST-009', ['platform-test-governance', 'derive', 'localagent-behavior-expectations', 'typed-source-world-relationship-knowledge', 'require', 'derived-by'], { value: 'test-authored' }],
  ['LAHC-B002', 'P-TEST-009', ['test-or-evaluator', 'author', 'localagent-personality-truth', 'denied', 'forbid', 'authored-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B003', 'P-TEST-010', ['localagent-deterministic-context-admission', 'classify', 'test-governance', 'behavior-unit-t4', 'require', 'classified-by'], { value: 'new-localagent-class' }],
  ['LAHC-B004', 'P-TEST-010', ['localagent-electron-product-acceptance', 'classify', 'test-governance', 'product-acceptance-t6', 'require', 'classified-by'], { value: 'behavior-unit-t4' }],
  ['LAHC-B005', 'P-TEST-010', ['provider-visible-request-capture', 'prove', 'localagent-context-admission', 'required', 'require', 'proved-by'], { value: 'omitted' }],
  ['LAHC-B006', 'P-TEST-011', ['localagent-live-subject-and-semantic-evaluator', 'classify', 'test-governance', 'live-provider-proof-t7-after-env-evidence', 'require', 'classified-by'], { value: 'product-acceptance-only' }],
  ['LAHC-B007', 'P-TEST-011', ['fixture-or-canned-reply', 'substitute', 'live-provider-behavior-admission', 'denied', 'forbid', 'substituted-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B008', 'P-TEST-012', ['localagent-behavior-admission', 'require', 'subject-evaluator-route-fingerprints', 'complete-and-distinct', 'require', 'required-by'], { value: 'same-or-unproven' }],
  ['LAHC-B009', 'P-TEST-012', ['app-or-test-runner', 'call', 'provider-or-model-directly', 'denied', 'forbid', 'called-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B010', 'P-TEST-012', ['app-or-test-runner', 'hardcode', 'provider-or-model-selection', 'denied', 'forbid', 'hardcoded-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B011', 'P-TEST-013', ['semantic-evaluator-result', 'admit', 'behavior-score', 'strict-json-schema-only', 'require', 'admitted-by'], { value: 'free-form-or-malformed' }],
  ['LAHC-B012', 'P-TEST-013', ['behavior-evaluator-calibration', 'require', 'known-pass-and-deliberate-fail-controls', 'every-dimension', 'require', 'required-by'], { value: 'missing-or-partial' }],
  ['LAHC-B013', 'P-TEST-013', ['behavior-batch', 'change', 'threshold-controls-rubric-schema-after-start', 'denied', 'forbid', 'changed-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B014', 'P-TEST-013', ['behavior-evaluator', 'retry', 'trial', 'denied', 'forbid', 'retried-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B015', 'P-TEST-014', ['behavior-batch-ledger', 'retain', 'all-raw-trials', 'required', 'require', 'retained-by'], { value: 'successful-only' }],
  ['LAHC-B016', 'P-TEST-014', ['behavior-evaluator', 'mutate', 'source-snapshot-localagent-transcript-memory-state', 'denied', 'forbid', 'mutated-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B017', 'P-TEST-014', ['evaluator-score', 'become', 'personality-truth', 'denied', 'forbid', 'become-by'], { value: 'allowed', polarity: 'require' }],
].map(([id, ruleId, relationArgs, inverse]) => (
  markdownRelationRequirement(id, ownerPaths.platformTestGovernance, ruleId, relationArgs, inverse)
));

function usage() {
  return 'usage: pnpm check:local-agent-full-chain-hardcut -- --scope <runtime-authority|consumer-authority|authority|runtime-materialization|runtime-consumer|all>\n';
}

function parseScope(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 0) return 'runtime-materialization';
  if (args.length !== 2 || args[0] !== '--scope' || !validScopes.has(args[1])) {
    process.stderr.write(usage());
    process.exit(2);
  }
  return args[1];
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function isExcludedFile(relPath) {
  const basename = path.basename(relPath);
  return basename.startsWith('rule-evidence') || basename.includes('.generated.');
}

function normalizeStatement(value) {
  return String(value)
    .replace(/[`*_]/gu, '')
    .replace(/[—–]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.;]+$/u, '')
    .toLowerCase();
}

function splitSentenceChunk(text, line) {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split(/(?<=[.!?])\s+(?=[A-Z`])/u)
    .map((statement) => ({ line, text: statement.trim(), normalized: normalizeStatement(statement) }))
    .filter((statement) => statement.normalized);
}

function extractMarkdownStatements(lines, startLine) {
  const statements = [];
  let chunk = [];
  let chunkLine = startLine;
  let inFence = false;

  function flush() {
    if (chunk.length === 0) return;
    statements.push(...splitSentenceChunk(chunk.join(' '), chunkLine));
    chunk = [];
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = startLine + index;
    if (/^\s*```/u.test(rawLine)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence || /^\s*\|/u.test(rawLine)) return;
    const bullet = rawLine.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/u);
    if (bullet) {
      flush();
      chunkLine = lineNumber;
      chunk.push(bullet[1]);
      return;
    }
    if (!rawLine.trim()) {
      flush();
      return;
    }
    if (chunk.length === 0) chunkLine = lineNumber;
    chunk.push(rawLine.trim());
  });
  flush();
  return statements;
}

function parseMarkdownRules(document) {
  const lines = document.text.split('\n');
  const rules = [];
  let current = null;

  function flush(endIndex) {
    if (!current) return;
    const bodyLines = lines.slice(current.bodyStartIndex, endIndex);
    rules.push({
      relPath: document.relPath,
      id: current.id,
      line: current.line,
      statements: extractMarkdownStatements(bodyLines, current.line + 1),
    });
  }

  lines.forEach((line, index) => {
    if (!line.startsWith('## ')) return;
    const match = line.match(/^##\s+([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+)\b/u);
    flush(index);
    current = match
      ? { id: match[1], line: index + 1, bodyStartIndex: index + 1 }
      : null;
  });
  flush(lines.length);
  return rules;
}

function yamlRecordIdentifier(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const field of ['rule_id', 'key', 'id', 'machine_id', 'name', 'state']) {
    if (typeof value[field] === 'string' && value[field].trim()) {
      return { field, value: value[field].trim() };
    }
  }
  return null;
}

function flattenRecordScalarPairs(value, prefix = '', output = [], isRecordRoot = false) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (yamlRecordIdentifier(entry)) return;
      flattenRecordScalarPairs(entry, `${prefix}[${index}]`, output);
    });
    return output;
  }
  if (value && typeof value === 'object') {
    if (!isRecordRoot && yamlRecordIdentifier(value)) return output;
    for (const [key, entry] of Object.entries(value)) {
      flattenRecordScalarPairs(entry, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  if (value !== null && typeof value !== 'undefined') output.push(`${prefix}=${String(value)}`);
  return output;
}

function parseYamlRecords(document) {
  const parsed = YAML.parse(document.text);
  const records = [];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const identifier = yamlRecordIdentifier(value);
    if (identifier) {
      const text = flattenRecordScalarPairs(value, '', [], true).join('; ');
      records.push({
        relPath: document.relPath,
        id: `${identifier.field}=${identifier.value}`,
        identifier,
        value,
        text,
        normalized: normalizeStatement(text),
      });
    }
    Object.values(value).forEach(visit);
  }

  visit(parsed);
  return { parsed, records };
}

async function collectAuthorityDocuments(relRoots) {
  const documents = [];

  async function walk(absDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isDirectory() && (excludedDirectoryNames.has(entry.name) || entry.name.startsWith('rule-evidence'))) continue;
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
      const relPath = toRepoRelative(absPath);
      if (isExcludedFile(relPath)) continue;
      const text = await fs.readFile(absPath, 'utf8');
      const document = { relPath, text, kind: path.extname(entry.name) === '.md' ? 'markdown' : 'yaml' };
      if (document.kind === 'markdown') {
        document.rules = parseMarkdownRules(document);
      } else {
        const parsedYaml = parseYamlRecords(document);
        document.parsed = parsedYaml.parsed;
        document.records = parsedYaml.records;
      }
      documents.push(document);
    }
  }

  for (const relRoot of relRoots) await walk(path.join(repoRoot, ...relRoot.split('/')));
  documents.sort((left, right) => left.relPath.localeCompare(right.relPath, 'en'));
  return documents;
}

function findYamlRecord(documents, relPath, field, value) {
  const document = documents.find((entry) => entry.relPath === relPath && entry.kind === 'yaml');
  return document?.records.find((record) => (
    record.identifier.field === field && record.identifier.value === value
  )) ?? null;
}

function extractCompactRuleIds(value) {
  const ids = [];
  const pattern = /\b((?:K|P|S|D|Z|R)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-)(\d{3}(?:\/\d{3})*)\b/gu;
  let match;
  while ((match = pattern.exec(String(value))) !== null) {
    for (const suffix of match[2].split('/')) ids.push(`${match[1]}${suffix}`);
  }
  return ids;
}

function parseTraceabilityRows(text) {
  const sectionStart = text.indexOf('## 4. Requirement');
  const sectionEnd = text.indexOf('\n## 5.', sectionStart);
  if (sectionStart < 0 || sectionEnd < 0) return new Map();
  const rows = new Map();
  for (const line of text.slice(sectionStart, sectionEnd).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3 || !expectedTraceabilityMappings.has(cells[0])) continue;
    if (!rows.has(cells[0])) rows.set(cells[0], []);
    rows.get(cells[0]).push(cells[1]);
  }
  return rows;
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectRuleIdsFromValue(value, ruleIds) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRuleIdsFromValue(entry, ruleIds);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectRuleIdsFromValue(entry, ruleIds);
    return;
  }
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (/^(?:K|P|S|D|Z|R)-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}[a-z]?$/u.test(normalized)) {
    ruleIds.add(normalized);
  }
}

async function collectRuleEvidenceIds() {
  const ruleIds = new Set();
  const roots = [
    '.nimi/spec/runtime/kernel/tables',
    '.nimi/spec/platform/kernel/tables',
    '.nimi/spec/sdks/kernel/tables',
    '.nimi/spec/desktop/kernel/tables',
    '.nimi/spec/zhiyu/kernel/tables',
  ];

  async function walk(absDir) {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile() || !/^rule-evidence.*\.ya?ml$/u.test(entry.name)) continue;
      collectRuleIdsFromValue(YAML.parse(await fs.readFile(absPath, 'utf8')), ruleIds);
    }
  }

  for (const root of roots) await walk(path.join(repoRoot, ...root.split('/')));
  return ruleIds;
}

async function collectNimiCanonicalRuleIds() {
  const documents = await collectAuthorityDocuments([
    ...scopeRoots['runtime-authority'],
    ...scopeRoots['consumer-authority'],
  ]);
  return new Set(documents
    .filter((document) => document.kind === 'markdown' && document.relPath.includes('/kernel/'))
    .flatMap((document) => document.rules.map((rule) => rule.id)));
}

async function resolveRealmCoreRuleInventory() {
  const candidates = [process.env.REALM_ROOT, path.dirname(repoRoot)]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));
  for (const candidate of [...new Set(candidates)]) {
    const contractPath = path.join(candidate, '.nimi/spec/realm/kernel/core-contract.md');
    const tablePath = path.join(candidate, '.nimi/spec/realm/kernel/tables/core-contract.yaml');
    try {
      const [contractText, tableText] = await Promise.all([
        fs.readFile(contractPath, 'utf8'),
        fs.readFile(tablePath, 'utf8'),
      ]);
      const declared = new Set(parseMarkdownRules({
        relPath: contractPath,
        text: contractText,
      }).map((rule) => rule.id));
      const registered = new Set();
      collectRuleIdsFromValue(YAML.parse(tableText), registered);
      return { declared, registered };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function traceabilityMappingFindings() {
  const findings = [];
  let text = null;
  try {
    text = await fs.readFile(path.join(repoRoot, ...ownerPaths.scenarioCatalog.split('/')), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') return [
      `[traceability] LAHC-T001 cannot read ${ownerPaths.scenarioCatalog}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (text !== null) {
    if (text.includes('pending_i0')) findings.push(
      `[traceability] LAHC-T002 ${ownerPaths.scenarioCatalog} must contain zero pending_i0 placeholders`,
    );
    const rows = parseTraceabilityRows(text);
    for (const [requirementId, expectedRuleIds] of expectedTraceabilityMappings) {
      const authorityCells = rows.get(requirementId) || [];
      if (authorityCells.length !== 1) {
        findings.push(`[traceability] LAHC-T003 ${requirementId} must have exactly one requirement coverage row`);
        continue;
      }
      const authorityCell = authorityCells[0];
      const actualRuleIds = extractCompactRuleIds(authorityCell);
      if (authorityCell.includes('pending_i0') || !sameOrderedValues(actualRuleIds, expectedRuleIds)) {
        findings.push(`[traceability] LAHC-T004 ${requirementId} mapping must be [${expectedRuleIds.join(', ')}], got [${actualRuleIds.join(', ')}]`);
      }
    }
  }

  const [declaredNimiRuleIds, registeredNimiRuleIds] = await Promise.all([
    collectNimiCanonicalRuleIds(),
    collectRuleEvidenceIds(),
  ]);
  let realmInventory;
  const checkedRuleIds = new Set();
  for (const [requirementId, ruleIds] of expectedTraceabilityMappings) {
    for (const ruleId of ruleIds) {
      if (checkedRuleIds.has(ruleId)) continue;
      checkedRuleIds.add(ruleId);
      if (ruleId.startsWith('R-')) {
        if (typeof realmInventory === 'undefined') realmInventory = await resolveRealmCoreRuleInventory();
        if (!realmInventory) {
          findings.push('[traceability] LAHC-T005 Realm core authority checkout is required via REALM_ROOT or the Nimi parent directory');
          continue;
        }
        if (!realmInventory.declared.has(ruleId)) {
          findings.push(`[traceability] LAHC-T006 ${requirementId} references undeclared Realm rule ${ruleId}`);
        }
        if (!realmInventory.registered.has(ruleId)) {
          findings.push(`[traceability] LAHC-T007 ${requirementId} references unregistered Realm rule ${ruleId}`);
        }
        continue;
      }
      if (!declaredNimiRuleIds.has(ruleId)) {
        findings.push(`[traceability] LAHC-T008 ${requirementId} references undeclared Nimi rule ${ruleId}`);
      }
      if (!registeredNimiRuleIds.has(ruleId)) {
        findings.push(`[traceability] LAHC-T009 ${requirementId} references unregistered Nimi rule ${ruleId}`);
      }
    }
  }
  return findings;
}

function relationRecordString(record) {
  return `AUTHORITY-RELATION subject=${record.subject} action=${record.action} object=${record.object} value=${record.value} polarity=${record.polarity}`;
}

function parseAuthorityRelation(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const relation = {
      subject: String(value.subject ?? '').trim().toLowerCase(),
      action: String(value.action ?? '').trim().toLowerCase(),
      object: String(value.object ?? '').trim().toLowerCase(),
      value: String(value.value ?? '').trim().toLowerCase(),
      polarity: String(value.polarity ?? '').trim().toLowerCase(),
    };
    return Object.values(relation).every(Boolean) && ['require', 'forbid'].includes(relation.polarity)
      ? relation
      : null;
  }
  const match = normalizeStatement(value).match(
    /^authority-relation subject=([a-z0-9.-]+) action=([a-z0-9.-]+) object=([a-z0-9.-]+) value=([a-z0-9.-]+) polarity=(require|forbid)$/u,
  );
  if (!match) return null;
  return {
    subject: match[1],
    action: match[2],
    object: match[3],
    value: match[4],
    polarity: match[5],
  };
}

function relationEquals(left, right) {
  return left.subject === right.subject
    && left.action === right.action
    && left.object === right.object
    && left.value === right.value
    && left.polarity === right.polarity;
}

function requiredActive(relation) {
  return {
    subject: relation.subject,
    action: relation.action,
    object: relation.object,
    value: relation.value,
    polarity: relation.polarity,
  };
}

function requiredPassive(relation) {
  return {
    subject: relation.object,
    action: relation.passiveAction,
    object: relation.subject,
    value: relation.value,
    polarity: relation.polarity,
  };
}

function inverseActive(relation) {
  return {
    subject: relation.inverseSubject,
    action: relation.action,
    object: relation.inverseObject,
    value: relation.inverseValue,
    polarity: relation.inversePolarity,
  };
}

function inversePassive(relation) {
  const inverse = inverseActive(relation);
  return {
    subject: inverse.object,
    action: relation.passiveAction,
    object: inverse.subject,
    value: inverse.value,
    polarity: inverse.polarity,
  };
}

function relationClassification(candidate, relation) {
  const active = requiredActive(relation);
  const passive = requiredPassive(relation);
  if (relationEquals(candidate, active) || relationEquals(candidate, passive)) return 'required';
  if (relationEquals(candidate, inverseActive(relation)) || relationEquals(candidate, inversePassive(relation))) return 'inverse';

  const activeGoverningKey = candidate.subject === active.subject
    && candidate.action === active.action
    && candidate.object === active.object;
  const passiveGoverningKey = candidate.subject === passive.subject
    && candidate.action === passive.action
    && candidate.object === passive.object;
  if (activeGoverningKey || passiveGoverningKey) return 'inverse';
  return 'unrelated';
}

function ownerLabel(owner) {
  return owner.kind === 'markdown'
    ? `${owner.relPath}#${owner.ruleId}`
    : `${owner.relPath}#${owner.field}=${owner.value}`;
}

function collectAuthorityRelations(documents) {
  const entries = [];
  for (const document of documents) {
    if (document.kind === 'markdown') {
      for (const rule of document.rules) {
        for (const statement of rule.statements) {
          const relation = parseAuthorityRelation(statement.text);
          if (!relation) continue;
          entries.push({
            relation,
            owner: markdownOwner(document.relPath, rule.id),
            location: `${document.relPath}:${statement.line}#${rule.id}`,
          });
        }
      }
      continue;
    }
    for (const record of document.records) {
      const rawRelations = record.value?.authority_relations;
      if (!Array.isArray(rawRelations)) continue;
      for (const value of rawRelations) {
        const relation = parseAuthorityRelation(value);
        if (!relation) continue;
        entries.push({
          relation,
          owner: yamlOwner(document.relPath, record.identifier.field, record.identifier.value),
          location: `${document.relPath}#${record.id}`,
        });
      }
    }
  }
  return entries;
}

function relationBelongsToOwner(entry, owner) {
  return entry.owner.kind === owner.kind
    && entry.owner.relPath === owner.relPath
    && (owner.kind === 'markdown'
      ? entry.owner.ruleId === owner.ruleId
      : entry.owner.field === owner.field && entry.owner.value === owner.value);
}

function evaluateRelationRequirements(findings, scope, documents, requirements) {
  const entries = collectAuthorityRelations(documents);
  for (const requirementEntry of requirements) {
    const expected = requiredActive(requirementEntry.relation);
    for (const owner of requirementEntry.owners) {
      if (!entries.some((entry) => (
        relationBelongsToOwner(entry, owner) && relationEquals(entry.relation, expected)
      ))) {
        findings.push(
          `[${scope}] ${requirementEntry.id} ${ownerLabel(owner)} must own canonical relation: ${relationRecordString(expected)}`,
        );
      }
    }
    for (const entry of entries) {
      if (relationClassification(entry.relation, requirementEntry.relation) !== 'inverse') continue;
      findings.push(
        `[${scope}] ${requirementEntry.id}-INV contradictory relation at ${entry.location}: ${relationRecordString(entry.relation)}`,
      );
    }
  }
}

function statementUnits(documents) {
  const units = [];
  for (const document of documents) {
    if (document.kind === 'markdown') {
      for (const rule of document.rules) {
        for (const statement of rule.statements) {
          units.push({
            relPath: document.relPath,
            owner: rule.id,
            line: statement.line,
            normalized: statement.normalized,
          });
        }
      }
    } else {
      for (const record of document.records) {
        units.push({
          relPath: document.relPath,
          owner: record.id,
          line: null,
          normalized: record.normalized,
        });
      }
    }
  }
  return units;
}

function legacyHmacConflict(unit) {
  if (unit.owner === 'key=sourceMaterializationPacketHmacSecret') return true;
  return unit.normalized.includes('sourcematerializationpackethmacsecret')
    && /\b(?:is runtime-owned verifier material for realm-issued source materialization packet hmac proofs|runtimeagent may consume only the resolved runtime config value)\b/iu.test(unit.normalized);
}

function legacySystemPromptConflict(unit) {
  return /\bguide system prompt are ordinary source content carried on the admitted sourcematerializationpacket\b/iu.test(unit.normalized)
    || /\bauthored alongside\b[^.;]*\bsystempromptbase\b/iu.test(unit.normalized)
    || /\bper-turn prompt-context path\b[^.;]*\bsystempromptbase already uses\b/iu.test(unit.normalized);
}

function legacyConsumerContextConflict(unit) {
  return /\bdesktop\/consumer attaches\b[^.;]*\bper-turn context\b/iu.test(unit.normalized);
}

function addLegacyConflicts(findings, scope, units, id, description, predicate) {
  const seen = new Set();
  for (const unit of units) {
    if (!predicate(unit)) continue;
    const location = unit.line === null
      ? `${unit.relPath}#${unit.owner}`
      : `${unit.relPath}:${unit.line}#${unit.owner}`;
    if (seen.has(location)) continue;
    seen.add(location);
    findings.push(`[${scope}] ${id} conflicting authority at ${location}: ${description}`);
  }
}

function runtimeAuthorityFindings(documents) {
  const findings = [];
  evaluateRelationRequirements(findings, 'runtime-authority', documents, runtimeRequirements);
  const units = statementUnits(documents);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R101', 'HMAC verifier/proof authority remains active', legacyHmacConflict);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R102', 'packet/systemPromptBase prompt authority remains active', legacySystemPromptConflict);
  addLegacyConflicts(findings, 'runtime-authority', units, 'LAHC-R103', 'consumer-attached LocalAgent context authority remains active', legacyConsumerContextConflict);
  return findings;
}

function consumerAuthorityFindings(documents) {
  const findings = [];
  evaluateRelationRequirements(findings, 'consumer-authority', documents, consumerRequirements);
  evaluateRelationRequirements(findings, 'consumer-authority', documents, behaviorEvaluationRequirements);

  if (!findYamlRecord(documents, ownerPaths.desktopSourceActions, 'machine_id', 'desktop_realm_source_local_materialization_action_model')) {
    findings.push('[consumer-authority] LAHC-C018 .nimi/spec/desktop/kernel/tables/realm-source-materialization-actions.yaml must own record machine_id=desktop_realm_source_local_materialization_action_model');
  }
  if (documents.some((document) => document.relPath === ownerPaths.retiredDesktopPersonaActions)) {
    findings.push(`[consumer-authority] LAHC-C101 conflicting authority at ${ownerPaths.retiredDesktopPersonaActions}: persona-only materialization action authority remains active`);
  }
  if (documents.some((document) => document.relPath === ownerPaths.incorrectDesktopSourceActions)) {
    findings.push(`[consumer-authority] LAHC-C102 conflicting authority at ${ownerPaths.incorrectDesktopSourceActions}: shortened source-materialization owner path is not admitted by census`);
  }
  for (const document of documents) {
    const incorrectRecord = document.records?.find((record) => (
      record.identifier.field === 'machine_id'
      && record.identifier.value === 'desktop_source_local_materialization_action_model'
    ));
    if (incorrectRecord) {
      findings.push(`[consumer-authority] LAHC-C103 conflicting authority at ${document.relPath}#${incorrectRecord.id}: shortened source materialization machine id is not admitted by census`);
    }
  }
  return findings;
}

function selfTestDocument(relPath, text, kind = 'markdown') {
  const document = { relPath, text, kind };
  if (kind === 'markdown') {
    document.rules = parseMarkdownRules(document);
  } else {
    const parsedYaml = parseYamlRecords(document);
    document.parsed = parsedYaml.parsed;
    document.records = parsedYaml.records;
  }
  return document;
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`adversarial self-test: ${message}`);
}

function buildFixtureDocuments(requirements, extras = [], additionalDocuments = []) {
  const markdownBuckets = new Map();
  const yamlBuckets = new Map();

  function addRelation(owner, relation) {
    if (owner.kind === 'markdown') {
      if (!markdownBuckets.has(owner.relPath)) markdownBuckets.set(owner.relPath, new Map());
      const rules = markdownBuckets.get(owner.relPath);
      if (!rules.has(owner.ruleId)) rules.set(owner.ruleId, []);
      rules.get(owner.ruleId).push(relation);
      return;
    }
    if (!yamlBuckets.has(owner.relPath)) yamlBuckets.set(owner.relPath, new Map());
    const records = yamlBuckets.get(owner.relPath);
    const recordKey = `${owner.field}=${owner.value}`;
    if (!records.has(recordKey)) records.set(recordKey, { owner, relations: [] });
    records.get(recordKey).relations.push(relation);
  }

  for (const requirementEntry of requirements) {
    for (const owner of requirementEntry.owners) addRelation(owner, requiredActive(requirementEntry.relation));
  }
  for (const extra of extras) addRelation(extra.owner, extra.relation);

  const documents = [];
  for (const [relPath, rules] of markdownBuckets) {
    const text = [...rules]
      .map(([ruleId, relations]) => (
        `## ${ruleId} Fixture\n\n${relations.map((relation) => `- ${relationRecordString(relation)}`).join('\n')}`
      ))
      .join('\n\n');
    documents.push(selfTestDocument(relPath, text));
  }
  for (const [relPath, records] of yamlBuckets) {
    const rows = [...records.values()].map(({ owner, relations }) => ({
      [owner.field]: owner.value,
      authority_relations: relations,
    }));
    documents.push(selfTestDocument(relPath, YAML.stringify({ records: rows }), 'yaml'));
  }
  documents.push(...additionalDocuments);
  documents.sort((left, right) => left.relPath.localeCompare(right.relPath, 'en'));
  return documents;
}

function correctDesktopMachineDocument() {
  return selfTestDocument(
    ownerPaths.desktopSourceActions,
    'machine_id: desktop_realm_source_local_materialization_action_model\n',
    'yaml',
  );
}

function findingHasId(findings, id) {
  return findings.some((finding) => finding.includes(` ${id} `) || finding.includes(` ${id}-INV `));
}

function wrongMarkdownOwner(requirementEntry) {
  const relPath = requirementEntry.id.startsWith('LAHC-R')
    ? ownerPaths.runtimeService
    : ownerPaths.platformAgentCenter;
  return markdownOwner(relPath, `FIXTURE-${requirementEntry.id}`);
}

function wrongYamlOwner(requirementEntry) {
  const relPath = requirementEntry.id.startsWith('LAHC-R')
    ? '.nimi/spec/runtime/kernel/tables/local-agent-authority-relations.yaml'
    : ownerPaths.platformKitRegistry;
  return yamlOwner(relPath, 'id', `fixture.wrong-owner.${requirementEntry.id.toLowerCase()}`);
}

function hasExactInverseFinding(findings, requirementEntry, owner, relation) {
  const suffix = `: ${relationRecordString(relation)}`;
  if (owner.kind === 'yaml') {
    return findings.some((finding) => (
      finding.includes(` ${requirementEntry.id}-INV contradictory relation at ${ownerLabel(owner)}`)
      && finding.endsWith(suffix)
    ));
  }
  return findings.some((finding) => (
    finding.includes(` ${requirementEntry.id}-INV contradictory relation at ${owner.relPath}:`)
    && finding.endsWith(`#${owner.ruleId}${suffix}`)
  ));
}

function runRelationFixtureSuite(requirements, findingsFn, additionalDocuments = []) {
  const baseline = buildFixtureDocuments(requirements, [], additionalDocuments);
  const baselineFindings = findingsFn(baseline);
  assertSelfTest(
    baselineFindings.length === 0,
    `complete canonical relation fixture must be green: ${baselineFindings.join(' | ')}`,
  );

  for (const requirementEntry of requirements) {
    const admittedOwner = requirementEntry.owners[0];
    const activeInverse = inverseActive(requirementEntry.relation);
    const passiveInverse = inversePassive(requirementEntry.relation);
    const admittedActiveFixture = buildFixtureDocuments(requirements, [{
      owner: admittedOwner,
      relation: activeInverse,
    }], additionalDocuments);
    const admittedActiveFindings = findingsFn(admittedActiveFixture);
    assertSelfTest(
      hasExactInverseFinding(admittedActiveFindings, requirementEntry, admittedOwner, activeInverse),
      `${requirementEntry.id} admitted-owner active inverse must produce exact inverse finding`,
    );

    const admittedPassiveFixture = buildFixtureDocuments(requirements, [{
      owner: admittedOwner,
      relation: passiveInverse,
    }], additionalDocuments);
    const admittedPassiveFindings = findingsFn(admittedPassiveFixture);
    assertSelfTest(
      hasExactInverseFinding(admittedPassiveFindings, requirementEntry, admittedOwner, passiveInverse),
      `${requirementEntry.id} admitted-owner passive inverse must produce exact inverse finding`,
    );

    const wrongActiveOwner = wrongMarkdownOwner(requirementEntry);
    const wrongActiveFixture = buildFixtureDocuments(requirements, [{
      owner: wrongActiveOwner,
      relation: activeInverse,
    }], additionalDocuments);
    const wrongActiveFindings = findingsFn(wrongActiveFixture);
    assertSelfTest(
      hasExactInverseFinding(wrongActiveFindings, requirementEntry, wrongActiveOwner, activeInverse),
      `${requirementEntry.id} wrong-rule active inverse must produce exact inverse finding`,
    );

    const wrongPassiveOwner = wrongYamlOwner(requirementEntry);
    const wrongPassiveFixture = buildFixtureDocuments(requirements, [{
      owner: wrongPassiveOwner,
      relation: passiveInverse,
    }], additionalDocuments);
    const wrongPassiveFindings = findingsFn(wrongPassiveFixture);
    assertSelfTest(
      hasExactInverseFinding(wrongPassiveFindings, requirementEntry, wrongPassiveOwner, passiveInverse),
      `${requirementEntry.id} wrong-row passive inverse must produce exact inverse finding`,
    );
  }
}

function runValidDenialFixtures() {
  const runtimeDenials = [
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R009').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'desktop-attached-localagent-turn-context', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R024').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'request-deriving-source-authority-from-app-metadata', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: runtimeRequirements.find((entry) => entry.id === 'LAHC-R021').owners[0],
      relation: requiredActive(governingRelation('runtime', 'reject', 'raw-public-localagent-prompt', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
  ];
  const runtimeFixture = buildFixtureDocuments(runtimeRequirements, runtimeDenials);
  assertSelfTest(
    runtimeAuthorityFindings(runtimeFixture).every((finding) => !finding.includes('-INV')),
    'valid Runtime reject/derives/raw denials must produce zero inverse findings',
  );

  const consumerDenials = [
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C001').owners[0],
      relation: requiredActive(governingRelation('sdk', 'reject', 'unbounded-localagent-source-status', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C001').owners[0],
      relation: requiredActive(governingRelation('sdk', 'expose', 'raw-localagent-source-status', 'denied', 'forbid', 'exposed-by', { value: 'allowed' })),
    },
    {
      owner: consumerRequirements.find((entry) => entry.id === 'LAHC-C012').owners[0],
      relation: requiredActive(governingRelation('sdk', 'reject', 'request-assembling-localagent-prompts', 'denied', 'forbid', 'rejected-by', { value: 'allowed' })),
    },
  ];
  const consumerFixture = buildFixtureDocuments(consumerRequirements, consumerDenials, [correctDesktopMachineDocument()]);
  assertSelfTest(
    consumerAuthorityFindings(consumerFixture).every((finding) => !finding.includes('-INV')),
    'valid consumer unbounded/raw/assemble denials must produce zero inverse findings',
  );
}

function runSnapshotHashSpecificityFixture() {
  const requirementEntry = runtimeRequirements.find((entry) => entry.id === 'LAHC-R013');
  const owner = requirementEntry.owners[0];
  const snapshotInstanceSpecific = {
    subject: 'localagent-source-snapshot-hash',
    action: 'set-specificity',
    object: 'identical-normalized-materialization',
    value: 'instance-specific',
    polarity: 'require',
  };
  assertSelfTest(
    relationEquals(inverseActive(requirementEntry.relation), snapshotInstanceSpecific),
    'LAHC-R013 inverse must be snapshot_hash instance specificity',
  );
  const fixture = buildFixtureDocuments(runtimeRequirements, [{
    owner,
    relation: snapshotInstanceSpecific,
  }]);
  const findings = runtimeAuthorityFindings(fixture);
  assertSelfTest(
    hasExactInverseFinding(findings, requirementEntry, owner, snapshotInstanceSpecific),
    'LAHC-R013 must reject snapshot_hash=instance-specific with an exact inverse finding',
  );
}

function runCensusFixtures() {
  const correctMachine = correctDesktopMachineDocument();
  const oldPersona = selfTestDocument(
    ownerPaths.retiredDesktopPersonaActions,
    'machine_id: desktop_realm_persona_local_materialization_action_model\n',
    'yaml',
  );
  const oldFindings = consumerAuthorityFindings(buildFixtureDocuments(consumerRequirements, [], [correctMachine, oldPersona]));
  assertSelfTest(findingHasId(oldFindings, 'LAHC-C101'), 'old Persona materialization owner must remain RED');

  const shortened = selfTestDocument(
    ownerPaths.incorrectDesktopSourceActions,
    'machine_id: desktop_source_local_materialization_action_model\n',
    'yaml',
  );
  const shortenedFindings = consumerAuthorityFindings(buildFixtureDocuments(consumerRequirements, [], [correctMachine, shortened]));
  assertSelfTest(findingHasId(shortenedFindings, 'LAHC-C102'), 'shortened materialization path must remain RED');
  assertSelfTest(findingHasId(shortenedFindings, 'LAHC-C103'), 'shortened materialization machine id must remain RED');
}

function runTraceabilityParserSelfTests() {
  assertSelfTest(
    extractCompactRuleIds('K-AGCORE-159/160, P-TEST-009/012/013/014').join(',')
      === 'K-AGCORE-159,K-AGCORE-160,P-TEST-009,P-TEST-012,P-TEST-013,P-TEST-014',
    'compact slash-separated rule IDs must expand to complete canonical IDs',
  );
  const rows = [...expectedTraceabilityMappings]
    .map(([requirementId, ruleIds]) => `| ${requirementId} | ${ruleIds.join(', ')} | fixture |`)
    .join('\n');
  const fixture = `## 4. Requirement → authority → scenario coverage\n\n${rows}\n\n## 5. Fixture end\n`;
  const parsed = parseTraceabilityRows(fixture);
  assertSelfTest(parsed.size === expectedTraceabilityMappings.size, 'traceability parser must find all eleven required rows');
  for (const [requirementId, expectedRuleIds] of expectedTraceabilityMappings) {
    const cells = parsed.get(requirementId) || [];
    assertSelfTest(cells.length === 1, `${requirementId} traceability fixture row must be unique`);
    assertSelfTest(
      sameOrderedValues(extractCompactRuleIds(cells[0]), expectedRuleIds),
      `${requirementId} traceability fixture mapping must remain exact`,
    );
  }
  assertSelfTest(
    !sameOrderedValues(extractCompactRuleIds('K-AGCORE-159/158, P-TEST-009/012/013/014'), expectedTraceabilityMappings.get('R-BEH-03')),
    'traceability mapping mutation must remain RED',
  );
}

function runAdversarialSelfTests() {
  const expectedRuntimeIds = Array.from({ length: 39 }, (_, index) => `LAHC-R${String(index + 1).padStart(3, '0')}`);
  const expectedConsumerIds = Array.from({ length: 17 }, (_, index) => `LAHC-C${String(index + 1).padStart(3, '0')}`);
  const expectedBehaviorIds = Array.from({ length: 17 }, (_, index) => `LAHC-B${String(index + 1).padStart(3, '0')}`);
  assertSelfTest(
    runtimeRequirements.map((entry) => entry.id).join(',') === expectedRuntimeIds.join(','),
    'Runtime relation census must exactly cover R001..R039',
  );
  assertSelfTest(
    consumerRequirements.map((entry) => entry.id).join(',') === expectedConsumerIds.join(','),
    'consumer relation census must exactly cover C001..C017',
  );
  assertSelfTest(
    behaviorEvaluationRequirements.map((entry) => entry.id).join(',') === expectedBehaviorIds.join(','),
    'behavior evaluation relation census must exactly cover B001..B017',
  );
  for (const requirementEntry of [...runtimeRequirements, ...consumerRequirements, ...behaviorEvaluationRequirements]) {
    const relation = requirementEntry.relation;
    assertSelfTest(
      [relation.subject, relation.action, relation.object, relation.value, relation.polarity, relation.passiveAction,
        relation.inverseSubject, relation.inverseObject, relation.inverseValue, relation.inversePolarity].every(Boolean),
      `${requirementEntry.id} governing relation and inverse fields must be complete`,
    );
  }
  runRelationFixtureSuite(runtimeRequirements, runtimeAuthorityFindings);
  runRelationFixtureSuite(
    [...consumerRequirements, ...behaviorEvaluationRequirements],
    consumerAuthorityFindings,
    [correctDesktopMachineDocument()],
  );
  runSnapshotHashSpecificityFixture();
  runValidDenialFixtures();
  runCensusFixtures();
  runTraceabilityParserSelfTests();

  const siblingIsolation = selfTestDocument('<siblings.yaml>', `records:
  - id: first
    authority_relations:
      - subject: sdk
        action: consume-status
        object: localagent-source
        value: bounded-only
        polarity: require
  - id: second
    authority_relations:
      - subject: sdk
        action: consume-status
        object: localagent-context
        value: unbounded
        polarity: require
`, 'yaml');
  const first = findYamlRecord([siblingIsolation], '<siblings.yaml>', 'id', 'first');
  assertSelfTest(first.value.authority_relations.length === 1, 'YAML relation records must remain sibling-isolated');
}

async function main() {
  const selectedScope = parseScope(process.argv.slice(2));
  if (selectedScope === 'runtime-materialization') {
    let findings;
    try {
      findings = await runtimeMaterializationCodeFindings(repoRoot);
    } catch (error) {
      process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    if (findings.length > 0) {
      process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
      for (const finding of findings) process.stderr.write(`- ${finding}\n`);
      process.exit(1);
    }
    process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
    return;
  }
  if (selectedScope === 'runtime-consumer') {
    let findings;
    try {
      findings = await runtimeContextConsumerCodeFindings(repoRoot);
    } catch (error) {
      process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(2);
    }
    if (findings.length > 0) {
      process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
      for (const finding of findings) process.stderr.write(`- ${finding}\n`);
      process.exit(1);
    }
    process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
    return;
  }
  const scopes = selectedScope === 'authority' || selectedScope === 'all'
    ? ['runtime-authority', 'consumer-authority']
    : [selectedScope];
  const findings = [];

  try {
    runAdversarialSelfTests();
    for (const scope of scopes) {
      const documents = await collectAuthorityDocuments(scopeRoots[scope]);
      findings.push(...(scope === 'runtime-authority'
        ? runtimeAuthorityFindings(documents)
        : consumerAuthorityFindings(documents)));
    }
    if (selectedScope === 'authority' || selectedScope === 'all') findings.push(...await traceabilityMappingFindings());
    if (selectedScope === 'all') {
      findings.push(...await runtimeMaterializationCodeFindings(repoRoot));
      findings.push(...await runtimeContextConsumerCodeFindings(repoRoot));
      findings.push(...await fullScopeAppCodeFindings(repoRoot));
    }
  } catch (error) {
    process.stderr.write(`local-agent-full-chain-hardcut checker error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }

  if (findings.length > 0) {
    process.stderr.write(`local-agent-full-chain-hardcut ${selectedScope} failed (${findings.length} finding(s)):\n`);
    for (const finding of findings) process.stderr.write(`- ${finding}\n`);
    process.exit(1);
  }

  process.stdout.write(`local-agent-full-chain-hardcut ${selectedScope}: OK\n`);
}

await main();
