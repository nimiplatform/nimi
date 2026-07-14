export const scopeRoots = {
  'runtime-authority': ['.nimi/spec/runtime/kernel'],
  'consumer-authority': [
    '.nimi/spec/sdks',
    '.nimi/spec/platform',
    '.nimi/spec/desktop',
    '.nimi/spec/zhiyu',
  ],
};

export const ownerPaths = {
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

export const expectedTraceabilityMappings = new Map([
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

export function markdownOwner(relPath, ruleId) {
  return { kind: 'markdown', relPath, ruleId };
}

export function yamlOwner(relPath, field, value) {
  return { kind: 'yaml', relPath, field, value };
}

export function governingRelation(subject, action, object, value, polarity, passiveAction, inverse = {}) {
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

export function requirement(id, owners, relation) {
  return { id, owners, relation };
}

export function markdownRelationRequirement(id, relPath, ruleId, relationArgs, inverse) {
  return requirement(id, [markdownOwner(relPath, ruleId)], governingRelation(...relationArgs, inverse));
}

export const runtimeRequirements = [
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
    ['LAHC-R028', 'K-AGCORE-159', ['runtime', 'execute', 'live-conversation-report-turn', 'runtime-ai-execution', 'require', 'executed-by'], { subject: 'app-or-test-runner', value: 'direct-provider-execution' }],
    ['LAHC-R029', 'K-AGCORE-159', ['conversation-report-turn', 'bind', 'runtime-model-fingerprint', 'provider-model-revision-complete', 'require', 'bound-by'], { value: 'missing-or-unresolved' }],
    ['LAHC-R030', 'K-AGCORE-159', ['conversation-report-run', 'keep', 'selected-runtime-route', 'stable-within-run', 'require', 'kept-by'], { value: 'silently-changed' }],
    ['LAHC-R031', 'K-AGCORE-159', ['app-or-test-runner', 'call', 'conversation-provider-or-model-directly', 'denied', 'forbid', 'called-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R032', 'K-AGCORE-159', ['app-or-test-runner', 'supply', 'conversation-provider-model-constant-or-binding', 'denied', 'forbid', 'supplied-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R033', 'K-AGCORE-160', ['conversation-report-capture', 'retain', 'runtime-bounded-context-and-state', 'required', 'require', 'retained-by'], { value: 'omitted' }],
    ['LAHC-R034', 'K-AGCORE-160', ['conversation-report-capture', 'correlate', 'localagent-anchor-turn-model-lineage', 'complete', 'require', 'correlated-by'], { value: 'incomplete' }],
    ['LAHC-R035', 'K-AGCORE-160', ['conversation-report-capture', 'read', 'raw-system-prompt-or-private-context-lanes', 'denied', 'forbid', 'read-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R036', 'K-AGCORE-160', ['conversation-report-capture', 'expose', 'credential-proof-or-private-runtime-input', 'denied', 'forbid', 'exposed-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R037', 'K-AGCORE-160', ['conversation-report-execution', 'retry', 'provider-attempt', 'denied', 'forbid', 'retried-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R038', 'K-AGCORE-160', ['conversation-report-capture', 'commit', 'product-turn-message-transcript-memory-localagent-state', 'denied', 'forbid', 'committed-by'], { value: 'allowed', polarity: 'require' }],
    ['LAHC-R039', 'K-AGCORE-160', ['captured-behavior-observation', 'become', 'semantic-or-personality-truth', 'denied', 'forbid', 'become-by'], { value: 'allowed', polarity: 'require' }],
  ].map(([id, ruleId, relationArgs, inverse]) => (
    markdownRelationRequirement(id, ownerPaths.runtimeContext, ruleId, relationArgs, inverse)
  )),
];

export const consumerRequirements = [
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

export const conversationReportRequirements = [
  ['LAHC-B001', 'P-TEST-009', ['localagent-i8', 'produce', 'semantic-behavior-observations', 'human-review-report', 'require', 'produced-by'], { value: 'automatic-verdict' }],
  ['LAHC-B002', 'P-TEST-009', ['automatic-test-or-evaluator', 'admit', 'localagent-semantic-quality', 'denied', 'forbid', 'admitted-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B003', 'P-TEST-009', ['test-or-report', 'author', 'localagent-personality-truth', 'denied', 'forbid', 'authored-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B004', 'P-TEST-010', ['localagent-deterministic-context', 'classify', 'test-governance', 'behavior-unit-t4', 'require', 'classified-by'], { value: 'new-localagent-class' }],
  ['LAHC-B005', 'P-TEST-010', ['localagent-electron-product-facts', 'classify', 'test-governance', 'product-acceptance-t6', 'require', 'classified-by'], { value: 'behavior-unit-t4' }],
  ['LAHC-B006', 'P-TEST-010', ['semantic-wording-style-or-naturalness', 'produce', 'automatic-failure', 'denied', 'forbid', 'produced-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B007', 'P-TEST-011', ['localagent-conversation-report', 'classify', 'real-provider-execution', 'live-provider-proof-t7-after-env-evidence', 'require', 'classified-by'], { value: 'product-acceptance-only' }],
  ['LAHC-B008', 'P-TEST-011', ['fixture-or-canned-reply', 'substitute', 'live-conversation-report', 'denied', 'forbid', 'substituted-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B009', 'P-TEST-011', ['l5-conversation-report', 'admit', 'semantic-quality', 'denied', 'forbid', 'admitted-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B010', 'P-TEST-012', ['conversation-report-turn', 'bind', 'model-fingerprint', 'provider-model-revision-complete', 'require', 'bound-by'], { value: 'missing-or-unresolved' }],
  ['LAHC-B011', 'P-TEST-012', ['app-or-test-runner', 'hardcode', 'provider-or-model-selection', 'denied', 'forbid', 'hardcoded-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B012', 'P-TEST-012', ['baseline-conversation-report', 'execute', 'model-run-repeat-retry', 'one-one-one-none', 'require', 'executed-by'], { value: 'matrix-or-retry' }],
  ['LAHC-B013', 'P-TEST-013', ['generated-conversation-report', 'initialize', 'human-review-status', 'unreviewed', 'require', 'initialized-by'], { value: 'accepted' }],
  ['LAHC-B014', 'P-TEST-013', ['automatic-semantic-evaluator', 'set', 'review-status-or-admission', 'denied', 'forbid', 'set-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B015', 'P-TEST-013', ['optional-ai-annotation', 'become', 'authoritative-verdict', 'denied', 'forbid', 'become-by'], { value: 'allowed', polarity: 'require' }],
  ['LAHC-B016', 'P-TEST-014', ['baseline-conversation-report', 'retain', 'complete-turn-and-state-bundle', 'required', 'require', 'retained-by'], { value: 'partial' }],
  ['LAHC-B017', 'P-TEST-014', ['realm-source', 'own', 'materialized-localagent-conversation', 'denied', 'forbid', 'owned-by'], { value: 'allowed', polarity: 'require' }],
].map(([id, ruleId, relationArgs, inverse]) => (
  markdownRelationRequirement(id, ownerPaths.platformTestGovernance, ruleId, relationArgs, inverse)
));
