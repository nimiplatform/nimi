// Unit tests for media-route.ts — media route resolution and settings revision

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMediaRouteConfig,
  isMediaRouteReady,
  buildMediaSettingsRevision,
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

  it('local route falls back to cloud in relay', () => {
    const settings = createSettings({ imageRouteSource: 'local', imageConnectorId: 'conn-1' });
    const result = resolveMediaRouteConfig({ kind: 'image', settings });
    assert.equal(result.routeSource, 'local');
    assert.equal(result.routeBinding?.source, 'cloud');
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

  it('auto route ready when connectorId or model exists', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageModel: 'flux-v2' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), true);
  });

  it('auto route not ready when no config', () => {
    const settings = createSettings({ imageRouteSource: 'auto', imageConnectorId: '', imageModel: '' });
    assert.equal(isMediaRouteReady({ kind: 'image', settings }), false);
  });

  it('local route never ready in relay', () => {
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
});
