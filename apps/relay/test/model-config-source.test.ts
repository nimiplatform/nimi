import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const mediaRouteSelectorSource = readFileSync(
  path.join(testDir, '..', 'src', 'renderer', 'features', 'model-config', 'media-route-selector.tsx'),
  'utf-8',
);
const settingsDrawerSource = readFileSync(
  path.join(testDir, '..', 'src', 'renderer', 'features', 'chat', 'components', 'settings-drawer.tsx'),
  'utf-8',
);

describe('media-route-selector source regressions', () => {
  it('does not auto-commit route changes during option loading', () => {
    assert.ok(
      !mediaRouteSelectorSource.includes('onChangeRef.current('),
      'selector should not call onChange from the loading effect',
    );
    assert.ok(
      !mediaRouteSelectorSource.includes('Auto-commit resolved connector'),
      'selector should not include auto-commit-on-mount behavior',
    );
  });

  it('uses controlled shared select fields instead of freeform datalist inputs', () => {
    assert.ok(
      mediaRouteSelectorSource.includes('SelectField'),
      'selector should use the shared SelectField primitive',
    );
    assert.ok(
      !mediaRouteSelectorSource.includes('<datalist'),
      'selector should not render datalist freeform input',
    );
    assert.ok(
      !mediaRouteSelectorSource.includes('<input'),
      'selector should not allow freeform model typing',
    );
  });
});

describe('image settings source regressions', () => {
  it('renders explicit local/cloud image route controls in settings drawer', () => {
    assert.ok(
      settingsDrawerSource.includes("imageRouteSource: 'local'"),
      'settings drawer should persist explicit local image route selection',
    );
    assert.ok(
      settingsDrawerSource.includes("imageRouteSource: 'cloud'"),
      'settings drawer should persist explicit cloud image route selection',
    );
    assert.ok(
      settingsDrawerSource.includes("capability: 'image.generate'"),
      'settings drawer should load image-specific route options',
    );
  });

  it('loads installed local artifacts for explicit workflow component selection', () => {
    assert.ok(
      settingsDrawerSource.includes('getBridge().local.listArtifacts('),
      'settings drawer should query installed local artifacts',
    );
    assert.ok(
      settingsDrawerSource.includes('imageWorkflowComponents'),
      'settings drawer should edit explicit image workflow components',
    );
    assert.ok(
      settingsDrawerSource.includes('profileOverrides'),
      'settings drawer should expose profile override editing',
    );
  });
});
