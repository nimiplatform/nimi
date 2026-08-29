import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS,
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
  NIMI_STANDARD_SHELL_ERROR_CODES,
  buildNimiFactoryProfileIndexRecord,
  buildNimiPlatformProjection,
  getNimiStandardShellCommand,
  isNimiStandardShellErrorEnvelope,
  resolveNimiFactoryAiProfileAlias,
} from '../src/index.js';

function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(resolve(current, 'config/platform-standard-shell-capabilities.yaml'))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error('Unable to locate repo root for standard-shell-capabilities.yaml');
}

const catalogPath = resolve(findRepoRoot(), 'config/platform-standard-shell-capabilities.yaml');
const aiProfileCatalogPath = resolve(findRepoRoot(), 'config/platform-ai-profile-factory-catalog.yaml');

function readYamlList(section: string, content: string): string[] {
  const start = content.indexOf(`${section}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterStart = content.slice(start + section.length + 2);
  const end = afterStart.search(/\n\S/u);
  const block = end === -1 ? afterStart : afterStart.slice(0, end);
  return [...block.matchAll(/^\s+- ([a-zA-Z0-9.-]+)\s*$/gm)].map((match) => match[1]);
}

function readCatalogCapabilities(content: string): string[] {
  return [...content.matchAll(/^  - id: ([a-zA-Z0-9-]+)$/gm)].map((match) => match[1]);
}

function readCatalogCommands(content: string): string[] {
  const capabilityStart = content.indexOf('\ncapabilities:\n');
  expect(capabilityStart).toBeGreaterThanOrEqual(0);
  return [...content.slice(capabilityStart).matchAll(/^\s+command: ([a-zA-Z0-9.]+)$/gm)]
    .map((match) => match[1]);
}

function readCapabilitySetList(field: string, content: string): string[] {
  const localAppSetStart = content.indexOf('  - set_id: local-app-standard-shell-v1');
  expect(localAppSetStart).toBeGreaterThanOrEqual(0);
  const scopedContent = content.slice(localAppSetStart);
  const start = scopedContent.indexOf(`    ${field}:`);
  expect(start).toBeGreaterThanOrEqual(0);
  const lineEnd = scopedContent.indexOf('\n', start);
  const fieldLine = scopedContent.slice(start, lineEnd === -1 ? scopedContent.length : lineEnd);
  if (fieldLine.endsWith(': []')) {
    return [];
  }
  const afterStart = scopedContent.slice(lineEnd + 1);
  const end = afterStart.search(/\n    [a-z_]+:/u);
  const block = end === -1 ? afterStart : afterStart.slice(0, end);
  return [...block.matchAll(/^\s+- ([a-zA-Z0-9.-]+)\s*$/gm)].map((match) => match[1]);
}

function readCatalogNegativeStatesForCommand(content: string, command: string): string[] {
  const start = content.indexOf(`command: ${command}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterCommand = content.slice(start);
  const nextOperation = afterCommand.slice(1).search(/^\s+- id: /mu);
  const block = nextOperation === -1 ? afterCommand : afterCommand.slice(0, nextOperation + 1);
  return [...block.matchAll(/^\s+- ([a-zA-Z0-9.-]+)\s*$/gm)].map((match) => match[1]);
}

function readLocalAppOperationFamily(content: string, family: string): string {
  const contractStart = content.indexOf('\nlocal_app_operation_contract:\n');
  expect(contractStart).toBeGreaterThanOrEqual(0);
  const header = `    ${family}:\n`;
  const start = content.indexOf(header, contractStart);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterStart = content.slice(start + header.length);
  const end = afterStart.search(/\n    [a-zA-Z][a-zA-Z0-9]+:\n/u);
  return end === -1 ? afterStart : afterStart.slice(0, end);
}

function readInlineYamlList(field: string, content: string): string[] {
  const match = content.match(new RegExp(`^\\s+${field}: \\[([^\\]]*)\\]$`, 'mu'));
  expect(match).not.toBeNull();
  return (match?.[1] || '').split(',').map((value) => value.trim()).filter(Boolean);
}

function readAiProfileAliases(content: string): string[] {
  return [...content.matchAll(/^  - alias: ([a-zA-Z0-9-]+)$/gm)].map((match) => match[1]);
}

function readAiProfileCapabilitySets(content: string): Record<string, string[]> {
  return Object.fromEntries([...content.matchAll(
    /^  - alias: ([a-zA-Z0-9-]+)[\s\S]*?^    capability_set:\n((?:      - [a-zA-Z0-9.-]+\n)+)/gm,
  )].map((match) => [
    match[1],
    [...match[2].matchAll(/^      - ([a-zA-Z0-9.-]+)$/gm)].map((item) => item[1]),
  ]));
}

describe('standard shell capabilities', () => {
  it('keeps the package contract aligned with the machine catalog', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const yamlIds = readCatalogCapabilities(catalog);
    const yamlCodes = readYamlList('  codes', catalog);
    const yamlCommands = readCatalogCommands(catalog);
    const packageCommands = NIMI_STANDARD_SHELL_CAPABILITIES.flatMap((capability) =>
      capability.operations.map((operation) => operation.command),
    );

    expect(NIMI_STANDARD_SHELL_CAPABILITY_IDS).toEqual(yamlIds);
    expect(NIMI_STANDARD_SHELL_ERROR_CODES).toEqual(yamlCodes);
    expect(packageCommands).toEqual(yamlCommands);
  });

  it('classifies externally managed Runtime config mutation as a standard negative state', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const command = getNimiStandardShellCommand('config', 'set');
    const packageOperation = NIMI_STANDARD_SHELL_CAPABILITIES
      .flatMap((capability) => capability.operations)
      .find((operation) => operation.command === command);

    expect(packageOperation?.negativeStates).toContain('external-daemon-required');
    expect(readCatalogNegativeStatesForCommand(catalog, command)).toContain('external-daemon-required');
  });

  it('keeps retired auth session custody outside the active product catalog', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const localAppSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (set) => set.setId === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    );

    expect(NIMI_STANDARD_SHELL_CAPABILITY_IDS).not.toContain('auth');
    expect(catalog).not.toMatch(/command: nimi\.shell\.auth\.session/u);
    expect(localAppSet?.forbiddenOperations).toEqual(expect.arrayContaining([
      'auth.sessionLoad',
      'auth.sessionSave',
      'auth.sessionClear',
    ]));
  });

  it('keeps renderer OAuth token exchange outside the active product catalog', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    expect(Object.hasOwn(NIMI_STANDARD_SHELL_COMMANDS, 'oauth.tokenExchange')).toBe(false);
    expect(catalog).not.toContain('nimi.shell.oauth.tokenExchange');
  });

  it('keeps standard storage removal admitted only through the local-app surface', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const command = getNimiStandardShellCommand('storage', 'removeJson');
    const packageOperation = NIMI_STANDARD_SHELL_CAPABILITIES
      .flatMap((capability) => capability.operations)
      .find((operation) => operation.command === command);

    expect(command).toBe('nimi.shell.storage.removeJson');
    expect(packageOperation?.negativeStates).toEqual(['capability-unavailable', 'invalid-path', 'invalid-payload']);
    expect(readCatalogNegativeStatesForCommand(catalog, command)).toEqual(['capability-unavailable', 'invalid-path', 'invalid-payload']);

    const localAppSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (set) => set.setId === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    );
    expect(localAppSet?.plannedOperations).toContain('data.pathResolve');
    expect(localAppSet?.allowedCommands).not.toContain('nimi.shell.localApp.agent.sendTurn');
    expect(localAppSet?.allowedOperations).toContain('storage.removeJson');
    expect(readCapabilitySetList('planned_operations', catalog)).not.toContain('storage.removeJson');
  });

  it('projects the exact final local-app carrier admission', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const localAppSet = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (set) => set.setId === NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
    );

    expect(localAppSet?.allowedOperations).toEqual(readCapabilitySetList('allowed_operations', catalog));
    expect(localAppSet?.forbiddenOperations).toEqual(readCapabilitySetList('forbidden_operations', catalog));
    expect(localAppSet?.allowedOperations).toEqual([
      'local-app.sessionStatus',
      'local-app.aiConfigGet',
      'local-app.aiConfigOverwrite',
      'local-app.aiConfigLocalOptions',
      'local-app.textGenerateCandidate',
      'local-app.textTurnStream',
      'local-app.scenarioExecute',
      'local-app.scenarioJobSubmit',
      'local-app.scenarioJobGet',
      'local-app.scenarioJobSubscribe',
      'local-app.scenarioJobCancel',
      'local-app.artifactRead',
      'local-app.artifactUpload',
      'local-app.voiceAssetsList',
      'local-app.agentReferenceList',
      'local-app.conversationOpen',
      'local-app.conversationSendTurn',
      'local-app.conversationAttachmentUpload',
      'local-app.conversationArtifactRead',
      'local-app.conversationVoiceTranscribe',
      'local-app.conversationVoiceRender',
      'local-app.conversationInterruptTurn',
      'local-app.conversationSubscribe',
      'local-app.conversationSnapshot',
      'local-app.embodimentSnapshot',
      'local-app.embodimentSubscribe',
      'local-app.aiRealtimeOpen',
      'local-app.aiRealtimeAppendInput',
      'local-app.aiRealtimeSubmitOwnerControl',
      'local-app.aiRealtimeSubscribe',
      'local-app.aiRealtimeInterruptOutput',
      'local-app.aiRealtimeClose',
      'local-app.agentRealtimeOpen',
      'local-app.agentRealtimeAppendInput',
      'local-app.agentRealtimeSubscribe',
      'local-app.agentRealtimeStatus',
      'local-app.agentRealtimeInterruptOutput',
      'local-app.agentRealtimeClose',
      'local-app.sharedAgentAIConfigGet',
      'local-app.sharedAgentAIConfigOverwrite',
      'local-app.sharedAgentAIConfigLocalOptions',
      'local-app.agentManagerSnapshot',
      'local-app.agentAutonomySnapshot',
      'local-app.agentUpdateAutonomy',
      'local-app.agentPresentationSnapshot',
      'local-app.agentPresentationReadAsset',
      'local-app.agentCommitPresentation',
      'local-app.agentMemoryInspect',
      'local-app.agentMemoryCorrect',
      'local-app.agentMemoryForget',
      'local-app.agentMemorySwitch',
      'local-app.agentMemoryDelete',
      'local-app.realmWorldCoreList',
      'local-app.realmWorldCoreCreate',
      'local-app.realmPersonaCharacterListOwned',
      'local-app.realmPersonaCharacterGetOwned',
      'local-app.realmPersonaCharacterCreate',
      'local-app.realmPersonaCharacterReplace',
      'local-app.realmPersonaCharacterDelete',
      'local-app.realmChatList',
      'local-app.realmRealtimeOpen',
      'local-app.realmRealtimeSubscribe',
      'local-app.realmRealtimeAck',
      'local-app.realmRealtimeSubscriptionClose',
      'local-app.realmRealtimeChannelClose',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'storage.assetStat',
      'storage.assetList',
      'storage.assetWriteOpen',
      'storage.assetWriteChunk',
      'storage.assetWriteCommit',
      'storage.assetWriteAbort',
      'storage.assetReadOpen',
      'storage.assetReadNext',
      'storage.assetReadClose',
      'storage.assetRemove',
      'storage.assetMove',
      'storage.assetReveal',
      'storage.assetAdopt',
      'storage.assetMediaOpen',
      'storage.assetMediaRevoke',
      'agent-center.avatarAssetImport',
      'agent-center.backgroundImport',
      'agent-center.resourcePackImport',
      'agent-center.resourcePackOpenZhiyu',
      'desktop-open.openIntent',
      'avatar.hostHandoff',
    ]);
    expect(localAppSet?.authorityStatus).toBe('app_access_declarations_with_protected_operations_unavailable_until_admission');
    expect(localAppSet?.plannedOperationsDisposition).toBe('deny_until_separate_operation_admission');
    expect(readCapabilitySetList('planned_operations', catalog)).toEqual(expect.arrayContaining([
      'data.pathResolve',
      'config.get',
    ]));
    expect(localAppSet?.forbiddenOperations).toEqual(expect.arrayContaining([
      'runtime-defaults.get',
      'runtime.unary',
      'runtime.streamOpen',
      'runtime.streamClose',
      'auth.sessionLoad',
      'auth.sessionSave',
      'auth.sessionClear',
      'oauth.openExternalUrl',
      'oauth.listenForCode',
      'electron.raw-ipc',
      'node.raw-fs',
    ]));
  });

  it('publishes text generation as one closed governed operation family', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const family = readLocalAppOperationFamily(catalog, 'textGenerateCandidate');
    const operation = NIMI_STANDARD_SHELL_CAPABILITIES
      .find((capability) => capability.id === 'local-app')
      ?.operations.find((candidate) => candidate.id === 'textGenerateCandidate');

    expect(family).toContain('command: local-app.textGenerateCandidate');
    expect(family).toContain('operation_id: runtime.ai.text_candidate.generate');
    expect(family).not.toMatch(/authority_class|permission_id/u);
    expect(family).toContain('transport_boundary: unary');
    expect(family).toContain('effect_boundary: foreground_compute');
    expect(family).toContain('owner: runtime_ai_service');
    expect(readInlineYamlList('request_fields', family)).toEqual([
      'messages', 'temperature', 'topP', 'maxTokens',
    ]);
    expect(readInlineYamlList('response_fields', family)).toEqual([
      'text', 'finishReason', 'traceId',
    ]);
    expect(readInlineYamlList('typed_failures', family)).toEqual(operation?.negativeStates);
  });

  it('publishes the complete canonical Agent manager operation family', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    expect(readLocalAppOperationFamily(catalog, 'agentManagerSnapshot'))
      .toContain('operation_id: runtime.agent.manager.snapshot.get');
    expect(readLocalAppOperationFamily(catalog, 'sharedAgentAIConfigLocalOptions'))
      .toContain('operation_id: runtime.agent.ai-config.options.list');
    expect(catalog).not.toContain('runtime.agent.ai_config.options.list');

    for (const [family, operationId, effect] of [
      ['agentMemoryInspect', 'runtime.agent.memory.inspect', 'read'],
      ['agentMemoryCorrect', 'runtime.agent.memory.correct', 'write'],
      ['agentMemoryForget', 'runtime.agent.memory.forget', 'write'],
      ['agentMemorySwitch', 'runtime.agent.memory.switch', 'write'],
      ['agentMemoryDelete', 'runtime.agent.memory.delete', 'write'],
    ] as const) {
      const block = readLocalAppOperationFamily(catalog, family);
      expect(block).toContain(`operation_id: ${operationId}`);
      expect(block).toContain(`effect_boundary: ${effect}`);
      expect(block).toContain('owner: runtime_agent_service');
    }
  });

  it('publishes VoiceAsset terminal results through Scenario Job Get only', () => {
    const catalog = readFileSync(catalogPath, 'utf8');
    const submit = readLocalAppOperationFamily(catalog, 'scenarioJobSubmit');
    const get = readLocalAppOperationFamily(catalog, 'scenarioJobGet');
    const subscribe = readLocalAppOperationFamily(catalog, 'scenarioJobSubscribe');

    expect(readInlineYamlList('response_fields', submit)).toEqual(['job']);
    expect(readInlineYamlList('response_fields', get)).toEqual(['job', 'asset', 'voiceReference']);
    expect(readInlineYamlList('event_fields', subscribe)).toEqual([
      'eventType', 'sequence', 'traceId', 'timestamp', 'job',
    ]);
  });

  it('exports fail-closed error envelopes and catalog-sourced command lookup', () => {
    expect(getNimiStandardShellCommand('runtime', 'unary')).toBe('nimi.shell.runtime.unary');
    expect(isNimiStandardShellErrorEnvelope({
      code: 'capability-unavailable',
      reasonCode: 'host-missing-standard-capability',
      actionHint: 'Install or enable a standard shell host.',
      source: 'renderer',
    })).toBe(true);
    expect(isNimiStandardShellErrorEnvelope({ code: 'capability-unavailable' })).toBe(false);
  });

  it('exports the Platform factory AI Profile catalog projection for shell hosts', () => {
    const catalog = readFileSync(aiProfileCatalogPath, 'utf8');
    const aliases = NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.map((row) => row.alias);
    expect(aliases).toEqual([
      'cloud-first',
      'local-standard',
      'local-speech',
      'local-gpu',
      'hybrid-recommended',
    ]);
    expect(aliases).toEqual(readAiProfileAliases(catalog));
    expect(Object.fromEntries(NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.map((row) => [row.alias, [...row.capabilitySet]])))
      .toEqual(readAiProfileCapabilitySets(catalog));

    const speech = resolveNimiFactoryAiProfileAlias('local-speech');
    expect(speech?.capabilitySet).toEqual([
      'text.generate',
      'audio.transcribe',
      'audio.synthesize',
    ]);
    expect(speech?.applicableScopes).toEqual(['first-party-app', 'scope-bound-apply']);
    expect(Object.keys(speech ?? {})).toEqual([
      'alias',
      'privacyPosture',
      'computePosture',
      'capabilitySet',
      'routingPolicy',
      'hostCapabilityProfileRefs',
      'localComputePackRefs',
      'dependencyFamilyRefs',
      'materializationConfirmationRequired',
      'applicableScopes',
      'sourceRule',
    ]);
    expect(JSON.stringify(speech).toLowerCase()).not.toMatch(/ready|install|binding|selection|probe/u);
    expect(JSON.stringify(NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS)).not.toMatch(/model\.(?:asset|companion-asset)/u);
    expect(catalog).not.toContain(['first', 'run'].join('-'));
    expect(catalog).not.toContain(['first', 'run', 'install', 'levels'].join('_'));

    const gpu = resolveNimiFactoryAiProfileAlias(' local-gpu ');
    expect(gpu).toMatchObject({
      alias: 'local-gpu',
      computePosture: 'cuda-capable',
      routingPolicy: 'local-first',
      materializationConfirmationRequired: true,
    });
    expect(gpu?.capabilitySet).toContain('image.generate');
    expect(resolveNimiFactoryAiProfileAlias('missing')).toBeUndefined();
    expect(resolveNimiFactoryAiProfileAlias(['local', 'speech', 'ready'].join('-'))).toBeUndefined();
  });

  it('builds the standard factory profile index from the admitted factory catalog', () => {
    const record = buildNimiFactoryProfileIndexRecord('2026-06-27T00:00:00.000Z');
    expect(record).toMatchObject({
      schemaVersion: 1,
      catalogVersion: 'v1',
      updatedAt: '2026-06-27T00:00:00.000Z',
      policies: {
        baseline: 'P-AIPS-004',
        recommended: 'P-AIPS-004',
      },
    });
    expect(record.profiles).toHaveLength(NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.length);
    expect(record.profiles.find((profile) => profile.alias === 'local-gpu')).toMatchObject({
      profileRef: 'factory-ai-profile:v1:local-gpu',
      deviceClass: 'gpu-recommended',
    });
    expect(Object.keys(record.profiles[0] ?? {})).toEqual([
      'profileRef',
      'alias',
      'os',
      'deviceClass',
      'capabilities',
      'applicableScopes',
    ]);
  });

  it('builds standard platform projections by projection id', () => {
    expect(buildNimiPlatformProjection({
      projectionId: 'factory-profile-index',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })).toMatchObject({
      projectionId: 'factory-profile-index',
      record: { catalogVersion: 'v1' },
    });
    expect(() => buildNimiPlatformProjection({ projectionId: 'missing' })).toThrow(/unsupported platform projection/u);
  });
});
