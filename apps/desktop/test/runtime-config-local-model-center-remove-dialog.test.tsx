import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NimiMachineLoadouts, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import {
  RemoveModelAssetDialogBody,
  describeModelAssetRemovalImpact,
  groupModelAssetRemovalReferences,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-remove-dialog';

(globalThis as { React?: typeof React }).React = React;

const asset = {
  modelAssetId: 'model_asset_1',
  displayName: 'gemma-4-E2B-it-Q8_0-complete.gguf',
  entry: 'gemma-4-E2B-it-Q8_0-complete.gguf',
  contentId: 'sha256:content',
  totalSizeBytes: 4_700_000_000,
  files: [{ relativePath: 'gemma-4-E2B-it-Q8_0-complete.gguf', sizeBytes: 4_700_000_000, sha256: 'abc', nonExecutableContent: false }],
  contentVerified: true,
  provenance: {},
} as unknown as NimiRuntimeModelAssetRecord;

const aggregate = {
  loadouts: [
    { loadoutId: 'loadout_chat_a', displayName: 'Gemma chat', capabilityContract: 'text.generate' },
    { loadoutId: 'loadout_chat_b', displayName: 'Gemma chat', capabilityContract: 'text.generate' },
    { loadoutId: 'loadout_embed', displayName: 'Gemma embeddings', capabilityContract: 'text.embed' },
    { loadoutId: 'loadout_unrelated', displayName: 'Other', capabilityContract: 'audio.transcribe' },
  ],
  selections: [{ capabilityContract: 'text.embed', loadoutId: 'loadout_embed', effectiveDefaults: {} }],
  selectionRevisions: {},
} as unknown as NimiMachineLoadouts;

function renderBody(impact: ReturnType<typeof describeModelAssetRemovalImpact>) {
  const resource = {
    instance: {
      t: (key: string, options?: Record<string, unknown>) => {
        const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
        return template.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(options?.[name] ?? ''));
      },
    },
  } as never;
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={resource}>
      <RemoveModelAssetDialogBody asset={asset} impact={impact} />
    </DesktopI18nResourceProvider>,
  );
}

test('removal impact resolves loadout ids to user-facing names and marks live selections', () => {
  const impact = describeModelAssetRemovalImpact(
    ['loadout_chat_a', 'loadout_embed', 'loadout_chat_b', 'loadout_chat_a', 'loadout_missing'],
    aggregate,
  );
  assert.equal(impact.unresolvedCount, 1);
  assert.deepEqual(impact.references.map((reference) => reference.loadoutId), ['loadout_embed', 'loadout_chat_a', 'loadout_chat_b']);
  assert.equal(impact.references[0]?.active, true);
  assert.equal(impact.references[1]?.active, false);

  const groups = groupModelAssetRemovalReferences(impact.references);
  assert.deepEqual(groups.map((group) => [group.capabilityContract, group.references.length, group.active]), [
    ['text.embed', 1, true],
    ['text.generate', 2, false],
  ]);
});

test('removal impact only counts references when the loadout aggregate is unavailable', () => {
  const impact = describeModelAssetRemovalImpact(['loadout_a', 'loadout_b', 'loadout_a'], null);
  assert.deepEqual(impact, { references: [], unresolvedCount: 2 });
});

test('remove dialog body never prints raw loadout ids and reads as setups in use', () => {
  const impact = describeModelAssetRemovalImpact(['loadout_chat_a', 'loadout_chat_b', 'loadout_embed', 'loadout_missing'], aggregate);
  const markup = renderBody(impact);
  assert.match(markup, /runtime-model-asset-remove-impact/);
  assert.match(markup, /4 setups use this model/);
  assert.match(markup, /In use/);
  assert.match(markup, /Gemma chat/);
  assert.match(markup, /1 more setups reference this model/);
  assert.match(markup, /gemma-4-E2B-it-Q8_0-complete/);
  assert.match(markup, /GGUF/);
  assert.doesNotMatch(markup, /loadout_chat_a/);
  assert.doesNotMatch(markup, /loadout_embed/);
  assert.doesNotMatch(markup, /model_asset_1/);
});

test('remove dialog body reassures when nothing references the model', () => {
  const markup = renderBody(describeModelAssetRemovalImpact([], aggregate));
  assert.match(markup, /runtime-model-asset-remove-safe/);
  assert.match(markup, /safe to remove/);
  assert.doesNotMatch(markup, /runtime-model-asset-remove-impact/);
});
