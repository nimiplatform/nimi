import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
  NimiLoadoutRecipe,
  NimiMachineLoadouts,
} from '@nimiplatform/sdk/runtime';
import {
  parseNimiPortableAIProfile,
  type NimiCapabilityAIConfig,
} from '@nimiplatform/sdk/ai';
import {
  AIProfileAuthoringView,
  type AIProfileAuthoringViewProps,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-profile-authoring.js';
import {
  changeRuntimeConfigAIProfileCapabilityContract,
  createRuntimeConfigAIProfileAuthoringState,
  exportRuntimeConfigAIProfileAuthoring,
  importRuntimeConfigAIProfileAuthoring,
  inspectRuntimeConfigAIProfileAuthoring,
  loadRuntimeConfigAIProfileAuthoringCurrentProjection,
  projectRuntimeConfigAIProfileAuthoringMachine,
  reconcileRuntimeConfigAIProfileRecipes,
  reduceRuntimeConfigAIProfileAuthoringState,
  type RuntimeConfigAIProfileAuthoringCurrentProjection,
  type RuntimeConfigAIProfileAuthoringDraft,
  type RuntimeConfigAIProfileAuthoringState,
} from '../src/shell/renderer/features/runtime-config/runtime-config-profile-authoring-state.js';
import {
  changeLocale,
  initI18n,
} from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

const TEXT_RECIPE: NimiLoadoutRecipe = Object.freeze({
  recipeId: 'recipe.desktop.text',
  revision: 'r7',
  title: 'Desktop text recipe',
  capabilityContract: 'text.generate',
  implementation: Object.freeze({
    implementationId: 'local.desktop.text',
    driverId: 'nimi.runtime.driver.desktop-text',
    driverDialect: 'desktop/text/v7',
  }),
  defaultOptions: Object.freeze({ contextSize: 4096, execution: { mode: 'balanced' } }),
  implementationSupportedFeatures: Object.freeze(['input.image']),
  slots: Object.freeze([
    Object.freeze({
      slotId: 'main.weights',
      displayLabel: 'Main weights',
      recommendedContentIds: Object.freeze(['sha256:desktop-main']),
      recommendedVariantIds: Object.freeze(['desktop-main-q4']),
      modelContract: Object.freeze({ format: 'desktop-bundle', architecture: 'text-v7' }),
      presence: 'required',
      conditionalFeatures: Object.freeze([]),
    }),
    Object.freeze({
      slotId: 'vision.adapter',
      displayLabel: 'Vision adapter',
      recommendedContentIds: Object.freeze([]),
      recommendedVariantIds: Object.freeze([]),
      modelContract: Object.freeze({ format: 'desktop-projector' }),
      presence: 'optional-conditional',
      conditionalFeatures: Object.freeze(['input.image']),
    }),
  ]),
});

const ALT_TEXT_RECIPE: NimiLoadoutRecipe = Object.freeze({
  ...TEXT_RECIPE,
  recipeId: 'recipe.desktop.text-alt',
  revision: 'r2',
  title: 'Alternative text recipe',
  implementation: Object.freeze({
    implementationId: 'local.desktop.text-alt',
    driverId: 'nimi.runtime.driver.desktop-text-alt',
    driverDialect: 'desktop/text-alt/v2',
  }),
  defaultOptions: Object.freeze({ contextSize: 16384, futureOption: true }),
  implementationSupportedFeatures: Object.freeze([]),
  slots: Object.freeze([
    Object.freeze({
      slotId: 'bundle.primary',
      displayLabel: 'Primary bundle',
      recommendedContentIds: Object.freeze([]),
      recommendedVariantIds: Object.freeze([]),
      modelContract: Object.freeze({ format: 'alt-bundle' }),
      presence: 'required',
      conditionalFeatures: Object.freeze([]),
    }),
  ]),
});

const MULTI_AXIS_RECIPE: NimiLoadoutRecipe = Object.freeze({
  ...TEXT_RECIPE,
  recipeId: 'recipe.desktop.media',
  revision: 'r1',
  title: 'Multi-axis media recipe',
  capabilityContract: 'media.compose',
  implementation: Object.freeze({
    implementationId: 'local.desktop.media-compose',
    driverId: 'nimi.runtime.driver.media-compose',
    driverDialect: 'desktop/media-compose/v1',
  }),
  defaultOptions: Object.freeze({ quality: 'preview' }),
  implementationSupportedFeatures: Object.freeze(['input.audio', 'input.image']),
  slots: Object.freeze([
    ...TEXT_RECIPE.slots,
    Object.freeze({
      slotId: 'audio.vocoder',
      displayLabel: 'Audio vocoder',
      recommendedContentIds: Object.freeze([]),
      recommendedVariantIds: Object.freeze([]),
      modelContract: Object.freeze({ format: 'vocoder-bundle' }),
      presence: 'required',
      conditionalFeatures: Object.freeze([]),
    }),
  ]),
});

const RECIPES = Object.freeze([TEXT_RECIPE, ALT_TEXT_RECIPE, MULTI_AXIS_RECIPE]);

function validTextDraft(): RuntimeConfigAIProfileAuthoringDraft {
  let state = createRuntimeConfigAIProfileAuthoringState();
  state = reduceRuntimeConfigAIProfileAuthoringState(state, {
    type: 'recipes-loaded',
    recipes: RECIPES,
  });
  return {
    ...state.draft,
    profileId: 'profile.desktop-authoring-test',
    title: 'Desktop authoring test',
    descriptionIncluded: true,
    description: 'Portable authoring round trip',
    provenanceJson: '{"publisher":"example.test","source":"desktop-authoring"}',
    licenseJson: '"Apache-2.0"',
    displayMetadataJson: '{"category":"test"}',
    capabilities: state.draft.capabilities.map((capability) => ({
      ...capability,
      requiredFeaturesText: 'input.image',
      defaultsJson: '{"temperature":0.4}',
      local: {
        ...capability.local,
        portableConfigJson: '{"contextSize":8192,"execution":{"mode":"balanced"}}',
      },
    })),
  };
}

function currentProjection(): RuntimeConfigAIProfileAuthoringCurrentProjection {
  return {
    appId: 'nimi.desktop',
    appAIConfig: {
      owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.desktop' } } },
      capabilities: [],
    },
    sharedAIConfig: {
      owner: {
        owner: {
          oneofKind: 'runtimeLocalAgentSubsystem',
          runtimeLocalAgentSubsystem: {},
        },
      },
      capabilities: [],
    },
    machine: {
      loadouts: [{
        loadoutId: 'loadout-current-text-only',
        capabilityContract: 'text.generate',
        implementation: { ...TEXT_RECIPE.implementation },
        portableConfig: {},
        supportedFeatures: [],
        requirementResolution: 'configured',
      }],
      selections: [{
        capabilityContract: 'text.generate',
        loadoutId: 'loadout-current-text-only',
      }],
    },
    recipes: RECIPES,
  };
}

function stateWithDraft(draft: RuntimeConfigAIProfileAuthoringDraft): RuntimeConfigAIProfileAuthoringState {
  return {
    ...createRuntimeConfigAIProfileAuthoringState(),
    draft,
  };
}

function renderAuthoring(
  state: RuntimeConfigAIProfileAuthoringState,
  projection: RuntimeConfigAIProfileAuthoringCurrentProjection | null = currentProjection(),
  overrides: Partial<AIProfileAuthoringViewProps> = {},
): string {
  return renderToStaticMarkup(
    <AIProfileAuthoringView
      state={state}
      inspection={inspectRuntimeConfigAIProfileAuthoring(state.draft, projection)}
      projectionStatus={projection ? 'ready' : 'loading'}
      projectionTechnicalError=""
      recipes={projection?.recipes ?? []}
      onDraftChange={noop}
      onImportFile={noop}
      onExport={noop}
      onReloadProjection={noop}
      {...overrides}
    />,
  );
}

test.before(async () => {
  await initI18n();
  await changeLocale('en');
});

test('Recipe-loaded authoring imports, edits, and exports one SDK-validated portable round trip', () => {
  const draft = validTextDraft();
  const exported = exportRuntimeConfigAIProfileAuthoring(draft, RECIPES);
  const importedDraft = importRuntimeConfigAIProfileAuthoring(exported.artifactJson, RECIPES);
  const reexported = exportRuntimeConfigAIProfileAuthoring(importedDraft, RECIPES);

  assert.deepEqual(
    parseNimiPortableAIProfile(reexported.artifactJson),
    parseNimiPortableAIProfile(exported.artifactJson),
  );
  assert.equal(exported.fileName, 'profile.desktop-authoring-test.ai-profile.json');
  assert.equal(importedDraft.capabilities[0]?.local.recipeId, TEXT_RECIPE.recipeId);

  let state = createRuntimeConfigAIProfileAuthoringState();
  state = reduceRuntimeConfigAIProfileAuthoringState(state, {
    type: 'recipes-loaded',
    recipes: RECIPES,
  });
  assert.equal(state.draft.capabilities[0]?.capabilityContract, 'text.generate');
  assert.equal(
    state.draft.capabilities[0]?.local.portableConfigJson,
    JSON.stringify(TEXT_RECIPE.defaultOptions, null, 2),
  );
});

test('Author Profile import and export preserve the complete portable Local intent', () => {
  const imported = parseNimiPortableAIProfile({
    profileId: 'profile.desktop-authoring-portable-intent',
    title: 'Portable intent round trip',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: ['input.image'],
        implementation: {
          implementationId: TEXT_RECIPE.implementation.implementationId,
          driverId: TEXT_RECIPE.implementation.driverId,
          driverDialect: TEXT_RECIPE.implementation.driverDialect,
          supportedFeatures: TEXT_RECIPE.implementationSupportedFeatures,
        },
        driverPortableConfig: { contextSize: 8192 },
        resourceOccurrences: [
          { occurrenceId: 'weights.primary', role: 'weights', ordinal: 0 },
          { occurrenceId: 'vision.adapter', role: 'projector', ordinal: 1 },
        ],
        loadout: {
          recipeId: TEXT_RECIPE.recipeId,
          axes: [
            {
              slotId: 'main.weights',
              contentId: `sha256:${'a'.repeat(64)}`,
              expectedHash: `sha256:${'b'.repeat(64)}`,
              source: {
                repo: 'example/portable-text',
                revision: 'revision-1',
                file: 'model.gguf',
                sizeBytes: 1234,
              },
            },
            {
              slotId: 'vision.adapter',
              contentId: `sha256:${'c'.repeat(64)}`,
              expectedHash: `sha256:${'d'.repeat(64)}`,
            },
          ],
          options: { contextSize: 8192, vision: { enabled: true } },
        },
      },
    },
    provenance: { source: 'portable-round-trip-test' },
    license: { id: 'test-license' },
  });

  const draft = importRuntimeConfigAIProfileAuthoring(
    JSON.stringify(imported),
    RECIPES,
  );
  const reexported = parseNimiPortableAIProfile(
    exportRuntimeConfigAIProfileAuthoring(draft, RECIPES).artifactJson,
  );

  assert.deepEqual(reexported, imported);

  const refreshed = reconcileRuntimeConfigAIProfileRecipes(draft, [ALT_TEXT_RECIPE]);
  assert.deepEqual(refreshed.capabilities[0]?.local.loadout, imported.capabilities['text.generate']?.route === 'local'
    ? imported.capabilities['text.generate'].loadout
    : undefined);
  assert.throws(
    () => exportRuntimeConfigAIProfileAuthoring(refreshed, [ALT_TEXT_RECIPE]),
    /requires a current Runtime Recipe selection/u,
  );
});

test('same-ID Recipe drift fails closed until an explicit Recipe selection', () => {
  const imported = parseNimiPortableAIProfile({
    profileId: 'profile.desktop-authoring-recipe-drift',
    title: 'Recipe drift',
    capabilities: {
      'text.generate': {
        route: 'local',
        requiredFeatures: ['input.image'],
        implementation: {
          ...TEXT_RECIPE.implementation,
          supportedFeatures: TEXT_RECIPE.implementationSupportedFeatures,
        },
        driverPortableConfig: { contextSize: 8192 },
        resourceOccurrences: [{ occurrenceId: 'weights.primary', role: 'weights' }],
        loadout: {
          recipeId: TEXT_RECIPE.recipeId,
          axes: [{
            slotId: 'main.weights',
            contentId: `sha256:${'a'.repeat(64)}`,
            expectedHash: `sha256:${'b'.repeat(64)}`,
          }],
          options: { contextSize: 8192 },
        },
      },
    },
    provenance: { source: 'recipe-drift-test' },
    license: { id: 'test-license' },
  });
  const draft = importRuntimeConfigAIProfileAuthoring(JSON.stringify(imported), [TEXT_RECIPE]);
  const driftedRecipe: NimiLoadoutRecipe = Object.freeze({
    ...TEXT_RECIPE,
    revision: 'r8',
    implementation: Object.freeze({
      implementationId: 'local.desktop.text-next',
      driverId: 'nimi.runtime.driver.desktop-text-next',
      driverDialect: 'desktop/text/v8',
    }),
    implementationSupportedFeatures: Object.freeze(['input.image', 'output.json']),
  });

  const refreshed = reconcileRuntimeConfigAIProfileRecipes(draft, [driftedRecipe]);
  assert.deepEqual(
    refreshed.capabilities[0]?.local.resourceOccurrences,
    imported.capabilities['text.generate']?.route === 'local'
      ? imported.capabilities['text.generate'].resourceOccurrences
      : undefined,
  );
  assert.deepEqual(
    refreshed.capabilities[0]?.local.loadout,
    imported.capabilities['text.generate']?.route === 'local'
      ? imported.capabilities['text.generate'].loadout
      : undefined,
  );
  assert.throws(
    () => exportRuntimeConfigAIProfileAuthoring(refreshed, [driftedRecipe]),
    /explicit Runtime Recipe selection/u,
  );

  const explicitlySelected: RuntimeConfigAIProfileAuthoringDraft = {
    ...refreshed,
    capabilities: refreshed.capabilities.map((capability) => ({
      ...capability,
      local: {
        ...capability.local,
        recipeId: driftedRecipe.recipeId,
        portableConfigJson: JSON.stringify(driftedRecipe.defaultOptions, null, 2),
        resourceOccurrences: undefined,
        loadout: undefined,
      },
    })),
  };
  const exported = exportRuntimeConfigAIProfileAuthoring(
    explicitlySelected,
    [driftedRecipe],
  ).profile;
  const accepted = reconcileRuntimeConfigAIProfileRecipes(explicitlySelected, [driftedRecipe]);
  assert.deepEqual(
    exportRuntimeConfigAIProfileAuthoring(accepted, [driftedRecipe]).profile,
    exported,
  );
  const capability = exported.capabilities['text.generate'];
  assert.equal(capability?.route, 'local');
  if (capability?.route !== 'local') assert.fail('expected Local capability');
  assert.deepEqual(capability.implementation, {
    ...driftedRecipe.implementation,
    supportedFeatures: ['input.image', 'output.json'],
  });
  assert.equal(capability.resourceOccurrences, undefined);
  assert.equal(capability.loadout, undefined);
});

test('Desktop renders identity, defaults, features, and every axis from Runtime Recipe descriptors', () => {
  const html = renderAuthoring(stateWithDraft(validTextDraft()));
  assert.match(html, /recipe\.desktop\.text/u);
  assert.match(html, /local\.desktop\.text/u);
  assert.match(html, /desktop\/text\/v7/u);
  assert.match(html, /main\.weights/u);
  assert.match(html, /vision\.adapter/u);
  assert.match(html, /desktop-bundle/u);
  assert.doesNotMatch(html, /llama-context-size|sd-execution-options|local-asr-driver/u);
  assert.doesNotMatch(html, /data-requirement-role|data-requirement-ordinal/u);
});

test('a new multi-axis Recipe reaches Desktop authoring without capability or Driver branches', () => {
  const base = validTextDraft();
  const changed = changeRuntimeConfigAIProfileCapabilityContract(
    base,
    base.capabilities[0]!.draftId,
    MULTI_AXIS_RECIPE.capabilityContract,
    RECIPES,
  );
  const capability = changed.capabilities[0]!;
  assert.equal(capability.local.recipeId, MULTI_AXIS_RECIPE.recipeId);
  assert.equal(
    capability.local.portableConfigJson,
    JSON.stringify(MULTI_AXIS_RECIPE.defaultOptions, null, 2),
  );
  const draft = {
    ...changed,
    capabilities: [{
      ...capability,
      requiredFeaturesText: 'input.image',
    }],
  };
  const html = renderAuthoring(stateWithDraft(draft));
  assert.match(html, /media\.compose/u);
  assert.match(html, /audio\.vocoder/u);
  assert.match(html, /vocoder-bundle/u);
  assert.equal(
    parseNimiPortableAIProfile(
      exportRuntimeConfigAIProfileAuthoring(draft, RECIPES).artifactJson,
    ).capabilities['media.compose']?.route,
    'local',
  );
});

test('AIProfile authoring derives all read-only journey actions and feature mismatch', () => {
  const inspection = inspectRuntimeConfigAIProfileAuthoring(
    validTextDraft(),
    currentProjection(),
  );
  assert.equal(inspection.status, 'valid');
  if (inspection.status !== 'valid') assert.fail('expected valid authoring inspection');
  assert.equal(inspection.model.journey?.importPreview.previewOnly, true);
  assert.equal(inspection.model.journey?.appApplyPreview.previewOnly, true);
  assert.equal(inspection.model.journey?.sharedApplyPreview.previewOnly, true);
  assert.equal(
    inspection.model.journey?.localConfigurationPreviews[0]?.decision.kind,
    'add-new',
  );
  assert.equal(
    inspection.model.journey?.selectionPreviews[0]?.branches[0].featureSubset.status,
    'feature-mismatch',
  );
  assert.equal(
    inspection.model.requirements[0]?.projection.source,
    'runtime-recipe',
  );
  assert.deepEqual(
    inspection.model.requirements[0]?.projection.requirements.map((slot) => slot.slotId),
    ['main.weights', 'vision.adapter'],
  );
});

test('an unresolved sibling Loadout does not invalidate configured Profile authoring', () => {
  const machine: NimiMachineLoadouts = {
    loadouts: [{
      loadoutId: 'loadout-text',
      capabilityContract: 'text.generate',
      implementation: TEXT_RECIPE.implementation,
      recipeId: TEXT_RECIPE.recipeId,
      recipeRevision: TEXT_RECIPE.revision,
      options: {},
      modelAxes: [],
      recipeCustody: [],
      implementationSupportedFeatures: ['input.image'],
      configuredFeatures: [],
      textBehaviors: [],
      validationState: 'configured',
      reasons: [],
      displayName: 'Text',
      provenance: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }, {
      loadoutId: 'loadout-unresolved',
      capabilityContract: 'media.compose',
      implementation: MULTI_AXIS_RECIPE.implementation,
      recipeId: MULTI_AXIS_RECIPE.recipeId,
      recipeRevision: MULTI_AXIS_RECIPE.revision,
      options: {},
      modelAxes: [],
      recipeCustody: [],
      implementationSupportedFeatures: [],
      configuredFeatures: [],
      textBehaviors: [],
      validationState: 'unresolved',
      reasons: ['MODEL_AXIS_UNRESOLVED'],
      displayName: 'Unresolved',
      provenance: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }],
    selections: [],
  };
  const projection = projectRuntimeConfigAIProfileAuthoringMachine(machine);
  assert.equal(projection.loadouts.length, 2);
  assert.equal(projection.loadouts[1]?.requirementResolution, 'unresolved');
  const inspection = inspectRuntimeConfigAIProfileAuthoring(validTextDraft(), {
    ...currentProjection(),
    machine: projection,
  });
  assert.equal(inspection.status, 'valid');
});

test('Cloud recommendation form has target fields but no account or credential inputs', () => {
  const draft = validTextDraft();
  const cloudDraft: RuntimeConfigAIProfileAuthoringDraft = {
    ...draft,
    capabilities: draft.capabilities.map((capability) => ({
      ...capability,
      route: 'cloud' as const,
      requiredFeaturesText: '',
      cloud: {
        implementationId: 'cloud.text.example',
        driverId: 'nimi.runtime.driver.cloud-example',
        driverDialect: 'example/text/v1',
        supportedFeaturesText: '',
        providerModelTargetJson: '{"provider":"example","providerModelId":"text-v1","remoteModelCatalogId":"catalog-text-v1"}',
      },
    })),
  };
  const html = renderAuthoring(stateWithDraft(cloudDraft));
  assert.match(html, /cloud-provider-model-target/u);
  assert.doesNotMatch(
    html,
    /data-authoring-field="(?:account|connector|grant|credential|api-key)/iu,
  );
});

test('Profile import fails closed when no current Runtime Recipe owns its Local identity', () => {
  const artifact = exportRuntimeConfigAIProfileAuthoring(validTextDraft(), RECIPES);
  assert.throws(
    () => importRuntimeConfigAIProfileAuthoring(artifact.artifactJson, [ALT_TEXT_RECIPE]),
    /no unambiguous current Runtime Recipe/u,
  );

  const parsed = JSON.parse(artifact.artifactJson) as Record<string, unknown>;
  parsed.displayMetadata = { machineId: 'machine-private' };
  assert.throws(
    () => importRuntimeConfigAIProfileAuthoring(JSON.stringify(parsed), RECIPES),
    /machineId/u,
  );
});

test('current projection loader reads AIConfig, Loadouts, and Runtime Recipes once each', async () => {
  const calls: string[] = [];
  const machine: NimiMachineLoadouts = { loadouts: [], selections: [] };
  const appAIConfig: NimiCapabilityAIConfig = {
    owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.desktop' } } },
    capabilities: [],
  };
  const projection = await loadRuntimeConfigAIProfileAuthoringCurrentProjection({
    appId: 'nimi.desktop',
    getAppAIConfig: async () => {
      calls.push('app');
      return appAIConfig;
    },
    getSharedAIConfig: async () => {
      calls.push('shared');
      return null;
    },
    getLoadouts: async () => {
      calls.push('loadouts');
      return machine;
    },
    getRecipes: async () => {
      calls.push('recipes');
      return RECIPES;
    },
  });
  assert.deepEqual(calls.sort(), ['app', 'loadouts', 'recipes', 'shared']);
  assert.deepEqual(projection.recipes, RECIPES);
});

test('Chinese authoring copy remains present after descriptor-driven UI cut', async () => {
  await changeLocale('zh');
  try {
    const html = renderAuthoring(stateWithDraft(validTextDraft()));
    assert.match(html, /运行时|本地|配置/u);
    assert.match(html, /recipe\.desktop\.text/u);
  } finally {
    await changeLocale('en');
  }
});
