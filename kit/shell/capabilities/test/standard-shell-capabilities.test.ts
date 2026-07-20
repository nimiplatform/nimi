import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS,
  NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS,
  NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS,
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_CAPABILITY_IDS,
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_ERROR_CODES,
  buildNimiAppsBridgeProjection,
  buildNimiAppsPackagesRecordFromRows,
  buildNimiAppsRegistryRecord,
  buildNimiFactoryProfileIndexRecord,
  buildNimiPlatformProjection,
  getNimiStandardShellCommand,
  isNimiStandardShellErrorEnvelope,
  resolveNimiFactoryAiProfileAlias,
  verifyNimiFirstRunFactoryAiProfile,
} from '../src/index.js';

function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(resolve(current, '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml'))) {
      return current;
    }
    current = dirname(current);
  }
  throw new Error('Unable to locate repo root for standard-shell-capabilities.yaml');
}

const catalogPath = resolve(findRepoRoot(), '.nimi/spec/platform/kernel/tables/standard-shell-capabilities.yaml');
const aiProfileCatalogPath = resolve(findRepoRoot(), '.nimi/spec/platform/kernel/tables/ai-profile-factory-catalog.yaml');
const appRegistryCatalogPath = resolve(findRepoRoot(), '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml');
const releaseDescriptorCatalogPath = resolve(findRepoRoot(), '.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml');

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

function readAiProfileAliases(content: string): string[] {
  return [...content.matchAll(/^  - alias: ([a-zA-Z0-9-]+)$/gm)].map((match) => match[1]);
}

function readAppIds(content: string): string[] {
  return [...content.matchAll(/^  - app_id: ([a-zA-Z0-9.-]+)$/gm)].map((match) => match[1]);
}

function readDescriptorIds(content: string): string[] {
  return [...content.matchAll(/^  - descriptor_id: ([a-zA-Z0-9.-]+)$/gm)].map((match) => match[1]);
}

describe('standard shell capabilities', () => {
  it('keeps the public contract split by host-neutral responsibility modules', () => {
    const srcRoot = resolve(findRepoRoot(), 'kit/shell/capabilities/src');
    const indexSource = readFileSync(resolve(srcRoot, 'index.ts'), 'utf8');
    expect(indexSource).not.toContain('./contract.js');

    const capabilityModules = [
      'catalog.ts',
      'commands.ts',
      'errors.ts',
      'runtime.ts',
      'runtime-lifecycle.ts',
      'runtime-defaults.ts',
      'oauth.ts',
      'shell-ui.ts',
      'diagnostics.ts',
      'data.ts',
      'storage.ts',
      'config.ts',
      'local-assets.ts',
      'local-agent.ts',
      'ai-profile.ts',
      'ai-config.ts',
      'avatar.ts',
      'agent-center.ts',
      'platform-projection.ts',
    ];
    for (const moduleFile of capabilityModules) {
      const source = readFileSync(resolve(srcRoot, moduleFile), 'utf8');
      expect(source, moduleFile).not.toContain('./contract.js');
      expect(source, moduleFile).not.toMatch(/\bfrom ['"]node:/u);
      expect(source, moduleFile).not.toMatch(/\bfrom ['"]electron/u);
      expect(source, moduleFile).not.toMatch(/\bfrom ['"]@tauri-apps\/api/u);
    }
  });

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
      'local-app.permissionStatus',
      'local-app.permissionRequest',
      'storage.readJson',
      'storage.writeJson',
      'storage.removeJson',
      'desktop-open.openIntent',
    ]);
    expect(localAppSet?.authorityStatus).toBe('permission_model_v1_base_entitlement_only');
    expect(localAppSet?.plannedOperationsDisposition).toBe('deny_until_separate_operation_admission');
    expect(readCapabilitySetList('planned_operations', catalog)).toEqual(expect.arrayContaining([
      'ai-config.get',
      'ai-config.set',
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
      'oauth.tokenExchange',
      'oauth.listenForCode',
      'local-agent.identity',
      'local-agent.runtimeTrustedCaller',
      'electron.raw-ipc',
      'node.raw-fs',
    ]));
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
    expect(NIMI_PLATFORM_AI_PROFILE_FACTORY_ROWS.map((row) => row.alias)).toEqual(readAiProfileAliases(catalog));

    const gpu = resolveNimiFactoryAiProfileAlias(' local-gpu ');
    expect(gpu).toMatchObject({
      alias: 'local-gpu',
      computePosture: 'cuda-capable',
      routingPolicy: 'local-first',
      materializationConfirmationRequired: true,
    });
    expect(gpu?.capabilitySet).toContain('image.generate');
    expect(resolveNimiFactoryAiProfileAlias('missing')).toBeUndefined();

    expect(verifyNimiFirstRunFactoryAiProfile('local-speech-ready', 'minimal')?.alias).toBe('local-speech-ready');
    expect(() => verifyNimiFirstRunFactoryAiProfile('cloud-first', 'minimal')).toThrow(/first-run|local first-run/u);
    expect(() => verifyNimiFirstRunFactoryAiProfile('local-gpu', 'minimal')).toThrow(/install level/u);
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
      mode: 'recommended',
      deviceClass: 'gpu-recommended',
    });
  });

  it('exports the Platform Nimi App registry and release descriptor projections for shell hosts', () => {
    const registryCatalog = readFileSync(appRegistryCatalogPath, 'utf8');
    const descriptorCatalog = readFileSync(releaseDescriptorCatalogPath, 'utf8');
    expect(NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS.map((row) => row.appId)).toEqual(readAppIds(registryCatalog));
    expect(NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.map((row) => row.descriptorId)).toEqual(readDescriptorIds(descriptorCatalog));

    const registry = buildNimiAppsRegistryRecord('2026-06-27T00:00:00.000Z');
    expect(registry).toMatchObject({
      schemaVersion: 1,
      catalogId: 'platform_nimi_app_registry',
      catalogVersion: 2,
      updatedAt: '2026-06-27T00:00:00.000Z',
    });
    expect(registry.apps).toHaveLength(NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS.length);
    expect(registry.apps.find((app) => app.appId === 'nimi.avatar')).toMatchObject({
      displayName: 'Avatar',
      visibility: 'hidden-internal',
      installState: 'bundled',
      recommendedProfileRef: 'local-gpu',
    });

    const bridge = buildNimiAppsBridgeProjection('~/.nimi/apps/registry.json', '~/.nimi/apps/packages.json');
    expect(bridge.registryRows).toHaveLength(NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS.length);
    expect(bridge.releaseDescriptors).toHaveLength(NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.length);

    const packages = buildNimiAppsPackagesRecordFromRows('2026-06-27T00:00:00.000Z', []);
    expect(packages).toEqual({
      schemaVersion: 2,
      updatedAt: '2026-06-27T00:00:00.000Z',
      packages: [],
    });
  });

  it('builds standard platform projections by projection id', () => {
    expect(buildNimiPlatformProjection({
      projectionId: 'factory-profile-index',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })).toMatchObject({
      projectionId: 'factory-profile-index',
      record: { catalogVersion: 'v1' },
    });
    expect(buildNimiPlatformProjection({
      projectionId: 'apps-registry',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })).toMatchObject({
      projectionId: 'apps-registry',
      record: { catalogId: 'platform_nimi_app_registry' },
    });
    expect(() => buildNimiPlatformProjection({ projectionId: 'missing' })).toThrow(/unsupported platform projection/u);
  });
});
