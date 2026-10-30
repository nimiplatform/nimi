import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeAppAIConfig, type DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import { collectAppsAIConfigIssues } from '../src/shell/renderer/features/apps/apps-attention.js';
import { entryNeedsAttention } from '../src/shell/renderer/features/apps/apps-card-fields.js';
import { createNimiLocalAIConfigCapabilityIntent, createNimiCloudAIConfigCapabilityIntent, type NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';

const snapshot: NimiAIConfigSnapshot = {
  revision: '1', config: { capabilities: [
    createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'music.generate' }),
    createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'vision.locate' }),
    createNimiCloudAIConfigCapabilityIntent({ capabilityContract: 'realtime.interact', connectorRef: 'connection',
      implementation: { implementationId: 'realtime', driverId: 'driver', driverDialect: 'realtime' },
      providerModelTarget: { provider: 'provider', providerModelId: 'model', remoteModelCatalogId: 'stale' } }),
  ] }, effectiveSelections: [
    { capabilityContract: 'music.generate', state: 'ready', resource: null, reasons: [] },
    { capabilityContract: 'vision.locate', state: 'blocked', resource: null, reasons: ['AI_LOCAL_CONFIGURATION_NOT_CONFIGURED'] },
    { capabilityContract: 'realtime.interact', state: 'blocked', resource: null, reasons: ['AI_REMOTE_MODEL_CATALOG_STALE'] },
  ],
};
function entry(appId: string, selector: string, declarations: readonly string[]): DesktopAppsEntry {
  return { identity: { entryKey: selector, appId, displayName: appId, sourceClass: 'local_development', updatedAtUnixMs: 1 },
    localDevelopment: null, catalogTarget: null, committedRelease: null, packageJob: null, run: null,
    iconUrl: null, summary: null, aiConfigSummary: summarizeAppAIConfig(snapshot, declarations) };
}

test('unrelated saved failures remain in full summary without creating an App todo', () => {
  const music = entry('music', 'one', ['music.generate']);
  assert.equal(music.aiConfigSummary?.blockedCount, 2);
  assert.deepEqual(music.aiConfigSummary?.issues, []);
  assert.equal(entryNeedsAttention(music), false);
  assert.equal(snapshot.config?.capabilities.length, 3, 'presentation never clears saved intent');
});

test('shared local problems merge across apps, cloud decisions merge only within their owner', () => {
  const result = collectAppsAIConfigIssues([
    ...Array.from({ length: 43 }, (_, i) => entry('lab', `lab-${i}`, [])),
    entry('objects', 'objects-1', ['vision.locate']), entry('objects', 'objects-2', ['vision.locate']),
    entry('music', 'music', ['music.generate']), entry('another-cloud-app', 'cloud', ['realtime.interact']),
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(result.find(issue => issue.route === 'local')?.apps.map(app => app.identity.appId), ['lab', 'objects']);
  assert.equal(result.filter(issue => issue.route === 'cloud').length, 2);
});

test('unread declarations and unavailable observations are not user decisions', () => {
  assert.deepEqual(summarizeAppAIConfig(snapshot, null).issues, []);
  const unavailable = summarizeAppAIConfig({ ...snapshot, effectiveSelections: [] });
  assert.equal(unavailable.healthPosture, 'unavailable');
  assert.deepEqual(unavailable.issues, []);
  assert.equal(entryNeedsAttention({ ...entry('lab', 'one', []), aiConfigSummary: unavailable }), false);
});
