import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(desktopDir, 'src');

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(nextPath);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [nextPath];
  });
}

function relativeDesktopPath(filePath: string): string {
  return path.relative(desktopDir, filePath).replaceAll(path.sep, '/');
}

function findFilesContaining(pattern: RegExp): string[] {
  return listSourceFiles(srcDir)
    .filter((filePath) => pattern.test(fs.readFileSync(filePath, 'utf8')))
    .map(relativeDesktopPath)
    .sort();
}

test('agent hard-cut residues stay confined to explicit host-private and rejection surfaces', () => {
  assert.deepEqual(
    findFilesContaining(/targetType:\s*'AGENT'/),
    [],
  );
  assert.deepEqual(
    findFilesContaining(/\bAGENT_LOCAL\b/),
    [],
  );
  assert.deepEqual(
    findFilesContaining(/HANDLE_PREFIX_UNSUPPORTED/),
    [
      'src/runtime/data-sync/flows/agent-runtime-flow.ts',
      'src/shell/renderer/features/contacts/add-contact-modal.tsx',
    ],
  );
});

test('desktop source no longer contains the deleted product chat route stack', () => {
  assert.equal(
    fs.existsSync(path.join(srcDir, 'runtime/chat')),
    false,
  );
  assert.deepEqual(
    findFilesContaining(/\bresolveChatRoute\b/),
    [],
  );
});

test('phase 3: AI runtime resolveInvokeInput reads from text.generate projection, not routeSnapshot', () => {
  // chat-ai-runtime.ts must not import or call toRuntimeRouteBindingFromAiRouteSnapshot
  const aiRuntimeSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-ai-runtime.ts'),
    'utf8',
  );
  assert.equal(
    /toRuntimeRouteBindingFromAiRouteSnapshot/.test(aiRuntimeSource),
    false,
    'chat-ai-runtime.ts must not use toRuntimeRouteBindingFromAiRouteSnapshot',
  );
  // ChatAiRuntimeInvokeInput must not contain routeSnapshot field
  assert.equal(
    /routeSnapshot:\s*AiConversationRouteSnapshot/.test(aiRuntimeSource),
    false,
    'ChatAiRuntimeInvokeInput must not contain routeSnapshot field',
  );
});

test('phase 5: resolveAiChatThinkingSupport provider-name heuristic must not exist', () => {
  const thinkingSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-thinking.ts'),
    'utf8',
  );
  assert.equal(
    /\bresolveAiChatThinkingSupport\b/.test(thinkingSource),
    false,
    'resolveAiChatThinkingSupport must not exist in chat-thinking.ts — it was a provider-name heuristic deleted in Phase 5',
  );
  // Ensure no source file imports the deleted function
  assert.deepEqual(
    findFilesContaining(/\bresolveAiChatThinkingSupport\b/),
    [],
    'no source file should import or reference resolveAiChatThinkingSupport',
  );
});

test('phase 3: AI thinking support does not fall back to routeSnapshot heuristic', () => {
  const thinkingSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-thinking.ts'),
    'utf8',
  );
  // resolveAiThinkingSupportFromProjection must not accept routeSnapshot parameter
  const fnMatch = thinkingSource.match(
    /export function resolveAiThinkingSupportFromProjection\([^)]*\)/,
  );
  assert.ok(fnMatch, 'resolveAiThinkingSupportFromProjection must exist');
  assert.equal(
    /routeSnapshot/.test(fnMatch![0]),
    false,
    'resolveAiThinkingSupportFromProjection must not accept routeSnapshot parameter',
  );
});

test('phase 3: agent setup uses AgentEffectiveCapabilityResolution, not old route readiness', () => {
  const agentAdapterSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-agent-shell-adapter.tsx'),
    'utf8',
  );
  const agentAdapterStateSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-agent-shell-adapter-state.ts'),
    'utf8',
  );
  // Must not import resolveAiConversationRouteReadiness
  assert.equal(
    /resolveAiConversationRouteReadiness/.test(agentAdapterSource),
    false,
    'chat-agent-shell-adapter.tsx must not use resolveAiConversationRouteReadiness',
  );
  // Must consume agentEffectiveCapabilityResolution from store
  assert.ok(
    /agentEffectiveCapabilityResolution/.test(agentAdapterStateSource),
    'chat-agent-shell-adapter-state.ts must consume agentEffectiveCapabilityResolution',
  );
});

test('phase 3: AI runtime adapter does not pass routeSnapshot to streamChatAiRuntime', () => {
  const adapterSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-ai-shell-runtime-adapter.ts'),
    'utf8',
  );
  assert.equal(
    /routeSnapshot/.test(adapterSource),
    false,
    'chat-ai-shell-runtime-adapter.ts must not reference routeSnapshot',
  );
});


test('phase 3: agent adapter passes resolution to host actions, not separate readiness', () => {
  const hostActionsTypesSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-agent-shell-host-actions-types.ts'),
    'utf8',
  );
  const hostActionsSubmitRunSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts'),
    'utf8',
  );
  // Host actions input type must have agentResolution, not agentRouteReady
  assert.ok(
    /agentResolution:\s*AgentEffectiveCapabilityResolution/.test(hostActionsTypesSource),
    'host actions input must have agentResolution field typed as AgentEffectiveCapabilityResolution',
  );
  assert.equal(
    /agentRouteReady:\s*boolean/.test(hostActionsTypesSource),
    false,
    'host actions input must not have agentRouteReady boolean field',
  );
  assert.match(
    hostActionsSubmitRunSource,
    /agentResolution:\s*input\.agentResolution/,
    'submit runner must pass agentResolution through to runAgentTurn',
  );
});

// --- AI route truth residual hard-cut tests ---

test('phase 3: AI adapter does not sync routeSnapshot to setConversationCapabilityBinding', () => {
  const adapterSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-ai-shell-adapter.tsx'),
    'utf8',
  );
  // Must not import the deleted bridge function
  assert.equal(
    /toConversationCapabilityBindingSelectionFromAiRouteSnapshot/.test(adapterSource),
    false,
    'adapter must not reference toConversationCapabilityBindingSelectionFromAiRouteSnapshot',
  );
  // Must not have the old binding sync effect
  assert.equal(
    /normalizeRuntimeRouteBindingSelectionKey/.test(adapterSource),
    false,
    'adapter must not contain normalizeRuntimeRouteBindingSelectionKey',
  );
  // Route summary/setup must use SelectionStore/projection, not routeSnapshot
  assert.ok(
    /selectedBinding:\s*selectedTextBinding/.test(adapterSource),
    'AI adapter must derive setup/summary from selectedTextBinding (SelectionStore)',
  );
});

test('phase 3: AI host actions do not call toConversationCapabilityBindingSelectionFromAiRouteSnapshot', () => {
  const hostActionsSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-ai-shell-host-actions.ts'),
    'utf8',
  );
  assert.equal(
    /toConversationCapabilityBindingSelectionFromAiRouteSnapshot/.test(hostActionsSource),
    false,
    'AI host actions must not use toConversationCapabilityBindingSelectionFromAiRouteSnapshot',
  );
  // syncAiThreadSelectionState must not write binding
  const syncFnMatch = hostActionsSource.match(
    /const syncAiThreadSelectionState = useCallback\(\([^)]*\) => \{([\s\S]*?)\}, \[input\]\);/,
  );
  if (!syncFnMatch) {
    assert.fail('syncAiThreadSelectionState must exist');
  }
  assert.equal(
    /setConversationCapabilityBinding/.test(syncFnMatch[1] ?? ''),
    false,
    'syncAiThreadSelectionState must not call setConversationCapabilityBinding',
  );
});

test('phase 5: legacy AI route readiness module is fully removed', () => {
  assert.equal(
    fs.existsSync(path.join(srcDir, 'shell/renderer/features/chat/chat-ai-route-readiness.ts')),
    false,
    'chat-ai-route-readiness.ts must be deleted once AI setup moves to shared projection',
  );
  assert.equal(
    findFilesContaining(/\bresolveAiConversationRouteReadiness\b/).length,
    0,
    'resolveAiConversationRouteReadiness must not exist in any source file',
  );
});

test('phase 3: bridge functions toRuntimeRouteBindingFromAiRouteSnapshot and toConversationCapabilityBindingSelectionFromAiRouteSnapshot are deleted from source', () => {
  assert.deepEqual(
    findFilesContaining(/\btoConversationCapabilityBindingSelectionFromAiRouteSnapshot\b/),
    [],
    'toConversationCapabilityBindingSelectionFromAiRouteSnapshot must not exist in any source file',
  );
  assert.deepEqual(
    findFilesContaining(/\btoRuntimeRouteBindingFromAiRouteSnapshot\b/),
    [],
    'toRuntimeRouteBindingFromAiRouteSnapshot must not exist in any source file',
  );
});

test('phase 5: AiConversationRouteSnapshot type must not exist in source', () => {
  assert.deepEqual(
    findFilesContaining(/\bAiConversationRouteSnapshot\b/),
    [],
    'AiConversationRouteSnapshot type must not exist in any source file',
  );
});

test('phase 5: routeSnapshot field must not exist in AI chat production source', () => {
  const chatDir = path.join(srcDir, 'shell/renderer/features/chat');
  const chatFiles = listSourceFiles(chatDir)
    .filter((filePath) => /routeSnapshot/.test(fs.readFileSync(filePath, 'utf8')))
    .map(relativeDesktopPath)
    .sort();
  assert.deepEqual(
    chatFiles,
    [],
    'routeSnapshot must not appear in any chat production source file',
  );
});

test('phase 5: currentRouteSnapshot is fully removed from AI adapter', () => {
  const adapterSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/features/chat/chat-ai-shell-adapter.tsx'),
    'utf8',
  );
  assert.equal(
    /currentRouteSnapshot/.test(adapterSource),
    false,
    'currentRouteSnapshot must not exist in chat-ai-shell-adapter.tsx — fully deleted in Phase 5',
  );
});

// --- Phase 6: post-hard-cut consolidation — DB schema residue guards ---

const ROUTE_LEGACY_DB_FIELD_NAMES = [
  'routeKind',
  'route_kind',
  'connectorId',
  'connector_id',
  'routeBindingJson',
  'route_binding_json',
];

test('phase 6: ChatAiThreadRecord TS type must not contain route legacy fields', () => {
  const typesSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/bridge/runtime-bridge/chat-ai-types.ts'),
    'utf8',
  );
  for (const field of ROUTE_LEGACY_DB_FIELD_NAMES) {
    assert.equal(
      new RegExp(`\\b${field}\\b`).test(typesSource),
      false,
      `chat-ai-types.ts must not contain route legacy field: ${field}`,
    );
  }
});

test('phase 6: ChatAi parsers must not extract route legacy fields', () => {
  const parsersSource = fs.readFileSync(
    path.join(srcDir, 'shell/renderer/bridge/runtime-bridge/chat-ai-parsers.ts'),
    'utf8',
  );
  for (const field of ROUTE_LEGACY_DB_FIELD_NAMES) {
    assert.equal(
      new RegExp(`\\b${field}\\b`).test(parsersSource),
      false,
      `chat-ai-parsers.ts must not contain route legacy field: ${field}`,
    );
  }
});

test('phase 6: parseChatAiCreateThreadInput strips route legacy fields from payload', async () => {
  const { parseChatAiCreateThreadInput } = await import(
    '../src/shell/renderer/bridge/runtime-bridge/chat-ai-parsers.js'
  );
  const payloadWithLegacyRouteFields = {
    id: 'thread-test',
    title: 'test thread',
    createdAtMs: 100,
    updatedAtMs: 200,
    lastMessageAtMs: null,
    archivedAtMs: null,
    routeKind: 'local',
    connectorId: 'legacy-connector',
    provider: 'legacy-provider',
    modelId: 'legacy-model',
    routeBindingJson: '{"binding":"legacy"}',
  };
  const parsed = parseChatAiCreateThreadInput(payloadWithLegacyRouteFields);
  assert.equal('routeKind' in parsed, false, 'parsed output must not contain routeKind');
  assert.equal('connectorId' in parsed, false, 'parsed output must not contain connectorId');
  assert.equal('provider' in parsed, false, 'parsed output must not contain provider');
  assert.equal('modelId' in parsed, false, 'parsed output must not contain modelId');
  assert.equal('routeBindingJson' in parsed, false, 'parsed output must not contain routeBindingJson');
  assert.deepEqual(Object.keys(parsed).sort(), [
    'archivedAtMs',
    'createdAtMs',
    'id',
    'lastMessageAtMs',
    'title',
    'updatedAtMs',
  ]);
});

test('phase 6: parseChatAiThreadRecord strips route legacy fields from payload', async () => {
  const { parseChatAiThreadRecord } = await import(
    '../src/shell/renderer/bridge/runtime-bridge/chat-ai-parsers.js'
  );
  const payloadWithLegacyRouteFields = {
    id: 'thread-test',
    title: 'test thread',
    createdAtMs: 100,
    updatedAtMs: 200,
    lastMessageAtMs: null,
    archivedAtMs: null,
    routeKind: 'local',
    connectorId: 'legacy-connector',
    provider: 'legacy-provider',
    modelId: 'legacy-model',
    routeBindingJson: '{"binding":"legacy"}',
  };
  const parsed = parseChatAiThreadRecord(payloadWithLegacyRouteFields);
  assert.equal('routeKind' in parsed, false, 'parsed output must not contain routeKind');
  assert.equal('connectorId' in parsed, false, 'parsed output must not contain connectorId');
  assert.equal('provider' in parsed, false, 'parsed output must not contain provider');
  assert.equal('modelId' in parsed, false, 'parsed output must not contain modelId');
  assert.equal('routeBindingJson' in parsed, false, 'parsed output must not contain routeBindingJson');
});

test('phase 6: parseChatAiThreadSummary strips route legacy fields from payload', async () => {
  const { parseChatAiThreadSummary } = await import(
    '../src/shell/renderer/bridge/runtime-bridge/chat-ai-parsers.js'
  );
  const payloadWithLegacyRouteFields = {
    id: 'thread-test',
    title: 'test thread',
    updatedAtMs: 200,
    lastMessageAtMs: null,
    archivedAtMs: null,
    routeKind: 'local',
    connectorId: 'legacy-connector',
  };
  const parsed = parseChatAiThreadSummary(payloadWithLegacyRouteFields);
  assert.equal('routeKind' in parsed, false, 'parsed output must not contain routeKind');
  assert.equal('connectorId' in parsed, false, 'parsed output must not contain connectorId');
});

test('phase 6: chat-ai-store-bridge.test.ts createThread payload must not include route fields', () => {
  const bridgeTestSource = fs.readFileSync(
    path.join(desktopDir, 'test/chat-ai-store-bridge.test.ts'),
    'utf8',
  );
  for (const field of ROUTE_LEGACY_DB_FIELD_NAMES) {
    assert.equal(
      new RegExp(`\\b${field}\\b`).test(bridgeTestSource),
      false,
      `chat-ai-store-bridge.test.ts must not contain route legacy field: ${field}`,
    );
  }
});

// --- Phase 7: deferred closure / legacy sunset guards ---

test('phase 7: desktop source must not import from relay active or archived paths (cross-app boundary)', () => {
  // Desktop and relay are independent apps; importing relay route types
  // into desktop would re-introduce parallel route truth.
  const relayImportPattern = /from\s+['"][^'"]*(?:apps|archive\/apps)\/relay/;
  assert.deepEqual(
    findFilesContaining(relayImportPattern),
    [],
    'desktop source must not import from relay active or archived paths — cross-app boundary violation',
  );
});

test('phase 7: desktop source must not reference relay-specific route types', () => {
  // These types belong to relay's independent route architecture (RL-* spec).
  // Desktop must not adopt them — it uses SelectionStore / projection.
  const relayRouteTypes = [
    'ChatRouteSnapshot',
    'RelayRouteBinding',
    'ResolvedRelayRoute',
    'RelayRouteOptions',
  ];
  for (const typeName of relayRouteTypes) {
    assert.deepEqual(
      findFilesContaining(new RegExp(`\\b${typeName}\\b`)),
      [],
      `desktop source must not reference relay type: ${typeName}`,
    );
  }
});

test('phase 7: chat_ai_store Rust migration scaffolding must exist until deliberate sunset', () => {
  // The legacy route column drop migration in schema.rs is required for users
  // upgrading from pre-hard-cut DB schemas. Premature removal would leave
  // orphaned columns. This guard prevents accidental deletion — remove this
  // test only when: (a) schema version is bumped to >= 3 with a superseding
  // migration, or (b) minimum app version policy guarantees no pre-hard-cut DBs.
  const schemaRsPath = path.join(
    desktopDir,
    'src-tauri/src/chat_ai_store/schema.rs',
  );
  const schemaRs = fs.readFileSync(schemaRsPath, 'utf8');
  assert.ok(
    /AI_THREAD_LEGACY_ROUTE_COLUMNS/.test(schemaRs),
    'schema.rs must contain AI_THREAD_LEGACY_ROUTE_COLUMNS — migration scaffolding required for pre-hard-cut DB upgrade',
  );
  assert.ok(
    /drop_legacy_route_columns_from_ai_threads/.test(schemaRs),
    'schema.rs must contain drop_legacy_route_columns_from_ai_threads — migration scaffolding required for pre-hard-cut DB upgrade',
  );
});

test('phase 7: desktop bridge types must not re-introduce route legacy fields under new names', () => {
  // Guard against route legacy fields re-appearing with different casing or naming.
  const bridgeDir = path.join(srcDir, 'shell/renderer/bridge/runtime-bridge');
  const bridgeFiles = listSourceFiles(bridgeDir);
  const suspiciousPatterns = [
    /\broute_kind\b/,
    /\brouteKind\b/,
    /\broute_binding_json\b/,
    /\brouteBindingJson\b/,
    /\bconnector_id\b/,
    /\bAiConversationRouteSnapshot\b/,
    /\btoRuntimeRouteBindingFromAi/,
  ];
  for (const filePath of bridgeFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relPath = relativeDesktopPath(filePath);
    for (const pattern of suspiciousPatterns) {
      assert.equal(
        pattern.test(source),
        false,
        `${relPath} must not contain ${pattern.source} — route legacy field re-introduction`,
      );
    }
  }
});
