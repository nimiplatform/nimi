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

describe('RL-BOOT-005 — ChatRoutePanel hook ordering', () => {
  it('uses the shared route model picker panel without local early-return branches', () => {
    const useMemoIndex = source.indexOf('const modelPickerAdapter = useMemo(');
    const useModelPickerIndex = source.indexOf('const modelPickerState = useModelPicker(');
    const routePanelIndex = source.indexOf('<RouteModelPickerPanel');

    assert.notEqual(useMemoIndex, -1, 'ChatRoutePanel must declare modelPickerAdapter');
    assert.notEqual(useModelPickerIndex, -1, 'ChatRoutePanel must declare modelPickerState');
    assert.notEqual(routePanelIndex, -1, 'ChatRoutePanel must render RouteModelPickerPanel');
    assert.equal(source.includes('if (loading) {'), false, 'ChatRoutePanel should delegate loading rendering to RouteModelPickerPanel');
    assert.equal(source.includes('if (!options) {'), false, 'ChatRoutePanel should delegate unavailable rendering to RouteModelPickerPanel');
  });

  it('uses a stable empty model list fallback before route data is ready', () => {
    assert.match(source, /const EMPTY_ROUTE_MODELS: readonly RelayRouteDisplayModel\[\] = \[\];/);
    assert.match(source, /const availableModels = display\?\.availableModels \?\? EMPTY_ROUTE_MODELS;/);
  });
});
