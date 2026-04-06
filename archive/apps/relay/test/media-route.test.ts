// Unit tests for media-route.ts — media route resolution and settings revision

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMediaRouteConfig,
  isMediaRouteReady,
  buildMediaSettingsRevision,
  resolveConfiguredImageProfileExtensions,
  resolveConfiguredImageGenerateTarget,
} from '../src/main/media/media-route.js';
import type { LocalChatDefaultSettings } from '../src/main/settings/types.js';
import { DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS } from '../src/main/settings/types.js';

function createSettings(overrides: Partial<LocalChatDefaultSettings> = {}): LocalChatDefaultSettings {
  return { ...DEFAULT_LOCAL_CHAT_DEFAULT_SETTINGS, ...overrides };
}

// ─── resolveMediaRouteConfig ──────────────────────────────────────────────

describe('resolveMediaRouteConfig', () => {
  it('cloud image route returns cloud source with binding', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1', imageModel: 'flux-v2' });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'cloud');
    assert.equal(result.routeBinding?.source, 'cloud');
    assert.equal(result.model, 'flux-v2');
  });

  it('cloud video route returns cloud source', () => {
    const settings = createSettings({ videoRouteSource: 'cloud', videoConnectorId: 'conn-2', videoModel: 'kling-v1' });
    const result = resolveMediaRouteConfig({ kind: 'video', settings });
    assert.equal(result.routeSource, 'cloud');
    assert.equal(result.routeBinding?.source, 'cloud');
    assert.equal(result.model, 'kling-v1');
  });

  it('auto route with connectorId infers cloud', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageConnectorId: 'conn-1' });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'auto');
    assert.equal(result.routeBinding?.source, 'cloud');
  });

  it('auto route without connectorId or model returns no binding', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageConnectorId: '', imageModel: '' });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'auto');
    assert.equal(result.routeBinding, undefined);
  });

  it('local image route resolves to a local binding without cloud fallback', () => {
    const settings = createSettings({
      imageRouteSource: 'local',
      selectedProfileId: 'local-chat-default',
    });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'local');
    assert.equal(result.routeBinding?.source, 'local');
    assert.equal(result.routeBinding?.connectorId, '');
    assert.equal(result.routeBinding?.model, 'media/local/z_image_turbo');
  });

  it('auto image route prefers configured cloud binding before local binding', () => {
    const settings = createSettings({
      imageRouteSource: 'auto',
      imageConnectorId: 'conn-1',
      imageModel: 'cloud-image-1',
      selectedProfileId: 'local-chat-default',
    });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'auto');
    assert.equal(result.routeBinding?.source, 'cloud');
    assert.equal(result.routeBinding?.connectorId, 'conn-1');
  });

  it('auto image route resolves to local when only local config exists', () => {
    const settings = createSettings({
      imageRouteSource: 'auto',
      selectedProfileId: 'local-chat-default',
    });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'auto');
    assert.equal(result.routeBinding?.source, 'local');
    assert.equal(result.routeBinding?.model, 'media/local/z_image_turbo');
  });

  it('unknown route source normalizes to auto', () => {
    const settings = createSettings();
    (settings as Record<string, unknown>).imageRouteSource = 'unknown';
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'auto');
  });
});

// ─── isMediaRouteReady ────────────────────────────────────────────────────

describe('isMediaRouteReady', () => {
  it('cloud route ready when connectorId exists', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), true);
  });

  it('cloud route not ready when connectorId empty', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: '' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), false);
  });

  it('auto route is ready when connectorId exists', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageConnectorId: 'conn-1', imageModel: 'flux-v2' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), true);
  });

  it('auto route not ready when no config', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageConnectorId: '', imageModel: '' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), false);
  });

  it('local route is ready when selectedProfileId exists', () => {
    const settings = createSettings({
      imageRouteSource: 'local',
      selectedProfileId: 'local-chat-default',
    });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), true);
  });

  it('local route is not ready when selectedProfileId is missing', () => {
    const settings = createSettings({ imageRouteSource: 'local' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), false);
  });

  it('returns true when resolvedRoute revision matches', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1', imageModel: 'flux-v2' });
    const expectedRevision = buildMediaSettingsRevision({ kind: 'image', settings });
    const resolvedRoute = {
      source: 'cloud' as const,
      model: 'flux-v2',
      resolvedBy: 'selected' as const,
      resolvedAt: new Date().toISOString(),
      settingsRevision: expectedRevision,
      routeOptionsRevision: 0,
    };
    assert.equal(isMediaRouteReady({ kind: 'image', settings, resolvedRoute }), true);
  });

  it('returns false when resolvedRoute revision mismatches', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1' });
    const resolvedRoute = {
      source: 'cloud' as const,
      model: 'flux-v2',
      resolvedBy: 'selected' as const,
      resolvedAt: new Date().toISOString(),
      settingsRevision: 'stale-revision',
      routeOptionsRevision: 0,
    };
    assert.equal(isMediaRouteReady({ kind: 'image', settings, resolvedRoute }), false);
  });
});

// ─── buildMediaSettingsRevision ───────────────────────────────────────────

describe('buildMediaSettingsRevision', () => {
  it('produces deterministic hash', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1', imageModel: 'flux' });
    const a = buildMediaSettingsRevision({ kind: 'image', settings });
    const b = buildMediaSettingsRevision({ kind: 'image', settings });
    assert.equal(a, b);
  });

  it('different settings produce different hashes', () => {
    const settingsA = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1', imageModel: 'flux' });
    const settingsB = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-2', imageModel: 'flux' });
    const a = buildMediaSettingsRevision({ kind: 'image', settings: settingsA });
    const b = buildMediaSettingsRevision({ kind: 'image', settings: settingsB });
    assert.notEqual(a, b);
  });

  it('different kinds produce different hashes', () => {
    const settings = createSettings({ imageRouteSource: 'cloud', imageConnectorId: 'conn-1', videoRouteSource: 'cloud', videoConnectorId: 'conn-1' });
    const a = buildMediaSettingsRevision({ kind: 'image', settings });
    const b = buildMediaSettingsRevision({ kind: 'video', settings });
    assert.notEqual(a, b);
  });

  it('different local profile selections produce different hashes', () => {
    const settingsA = createSettings({ imageRouteSource: 'local', selectedProfileId: 'local-chat-default' });
    const settingsB = createSettings({ imageRouteSource: 'local', selectedProfileId: 'local-chat-compact' });
    const a = buildMediaSettingsRevision({ kind: 'image', settings: settingsA });
    const b = buildMediaSettingsRevision({ kind: 'image', settings: settingsB });
    assert.notEqual(a, b);
  });
});

describe('resolveConfiguredImageProfileExtensions', () => {
  it('returns undefined when no profile config is present', () => {
    const settings = createSettings();
    assert.equal(resolveConfiguredImageProfileExtensions(settings), undefined);
  });

  it('includes profile entries and entry overrides', () => {
    const settings = createSettings({
      selectedProfileId: 'local-chat-default',
      profileEntryOverrides: [
        {
          entryId: 'local-chat/image-z-image-ae',
          localAssetId: 'asset-vae-1',
        },
      ],
    });

    const extensions = resolveConfiguredImageProfileExtensions(settings);
    assert.equal(Array.isArray(extensions?.profile_entries), true);
    assert.deepEqual(extensions?.entry_overrides, [
      {
        entry_id: 'local-chat/image-z-image-ae',
        local_asset_id: 'asset-vae-1',
      },
    ]);
  });
});

describe('resolveConfiguredImageGenerateTarget', () => {
  it('returns local route target with profile-derived model and entry override extensions', () => {
    const settings = createSettings({
      imageRouteSource: 'local',
      selectedProfileId: 'local-chat-default',
      profileEntryOverrides: [
        {
          entryId: 'local-chat/image-z-image-ae',
          localAssetId: 'asset-vae-1',
        },
      ],
    });

    const result = resolveConfiguredImageGenerateTarget(settings);
    assert.equal(result.routeSource, 'local');
    assert.equal(result.model, 'media/local/z_image_turbo');
    assert.equal(Array.isArray(result.extensions?.profile_entries), true);
    assert.deepEqual(result.extensions?.entry_overrides, [
      {
        entry_id: 'local-chat/image-z-image-ae',
        local_asset_id: 'asset-vae-1',
      },
    ]);
  });

  it('fails closed when local image route lacks an explicit selected profile', () => {
    const settings = createSettings({
      imageRouteSource: 'local',
    });

    assert.throws(
      () => resolveConfiguredImageGenerateTarget(settings),
      /Image route is not configured|Local image profile is required/,
    );
  });

  it('succeeds without entry overrides and still emits profile entries', () => {
    const settings = createSettings({
      imageRouteSource: 'local',
      selectedProfileId: 'local-chat-default',
    });

    const result = resolveConfiguredImageGenerateTarget(settings);
    assert.equal(result.routeSource, 'local');
    assert.equal(result.model, 'media/local/z_image_turbo');
    assert.equal(Array.isArray(result.extensions?.profile_entries), true);
    assert.equal(result.extensions?.entry_overrides, undefined);
  });

  it('returns cloud route target unchanged for cloud settings', () => {
    const settings = createSettings({
      imageRouteSource: 'cloud',
      imageConnectorId: 'conn-1',
      imageModel: 'gpt-image-1',
    });

    const result = resolveConfiguredImageGenerateTarget(settings);
    assert.deepEqual(result, {
      routeSource: 'cloud',
      connectorId: 'conn-1',
      model: 'gpt-image-1',
    });
  });
});
