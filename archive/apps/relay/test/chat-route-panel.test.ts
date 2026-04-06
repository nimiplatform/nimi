import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(
  testDir,
  '..',
  'src',
  'renderer',
  'features',
  'model-config',
  'chat-route-panel.tsx',
), 'utf8');
const providerSource = readFileSync(path.join(
  testDir,
  '..',
  'src',
  'renderer',
  'features',
  'model-config',
  'bridge-route-provider.ts',
), 'utf8');

describe('RL-BOOT-005 — ChatRoutePanel uses kit data hook', () => {
  it('delegates data fetching and state management to kit useRouteModelPickerData', () => {
    assert.match(source, /useRouteModelPickerData/, 'ChatRoutePanel must use kit useRouteModelPickerData hook');
    assert.match(source, /RouteModelPickerDataProvider/, 'ChatRoutePanel must use RouteModelPickerDataProvider interface');
  });

  it('hydrates the picker from persisted relay route state before mounting the data hook', () => {
    assert.match(source, /useRelayRoute/, 'ChatRoutePanel must read persisted relay route state');
    assert.match(source, /initialSelection = useMemo/, 'ChatRoutePanel must derive initial selection from route state');
    assert.doesNotMatch(source, /initialSelection:\s*\{\s*source:\s*'local'\s*\}/, 'ChatRoutePanel must not hardcode local as the initial selection');
  });

  it('creates a bridge-based data provider for Electron IPC', () => {
    assert.match(source, /createBridgeRouteDataProvider/, 'ChatRoutePanel must create a bridge data provider');
    assert.match(providerSource, /bridge\.local\.listAssets/, 'Provider must call bridge.local.listAssets');
    assert.match(providerSource, /bridge\.connector\.list/, 'Provider must call bridge.connector.list');
    assert.match(providerSource, /bridge\.connector\.listModels/, 'Provider must call bridge.connector.listModels');
  });

  it('persists selection to main process via bridge.route.setBinding', () => {
    assert.match(source, /bridge\.route\.setBinding/, 'ChatRoutePanel must call bridge.route.setBinding on selection change');
  });

  it('does not contain inline loading or unavailable early-return branches from old pattern', () => {
    assert.equal(source.includes('if (!options) {'), false, 'ChatRoutePanel should not check for options directly');
  });
});
