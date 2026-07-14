import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const featureRoot = resolve(import.meta.dirname, '../src/shell/renderer/features/apps');

function source(name: string): string {
  return readFileSync(resolve(featureRoot, name), 'utf8');
}

describe('Desktop Apps immutable-package 0K hardcut', () => {
  it('physically removes the renderer lifecycle and package-config surfaces', () => {
    assert.equal(existsSync(resolve(featureRoot, 'apps-lifecycle-bridge.ts')), false);
    assert.equal(existsSync(resolve(featureRoot, 'apps-ai-profile-section.tsx')), false);
    assert.equal(existsSync(resolve(featureRoot, 'apps-open-ai-config-gate.ts')), false);
  });

  it('uses selector-free typed package readiness and no job source', () => {
    const liveBridge = source('apps-live-bridge.ts');
    assert.match(liveBridge, /loadPackageReadiness:\s*async\s*\(\)\s*=>/);
    assert.doesNotMatch(liveBridge, /loadActiveJobs|listJobs|watchJobEvents/);
    assert.doesNotMatch(liveBridge, /packageReadiness\(\s*\{\s*appId/);
  });

  it('exposes only details and account sign-in as card actions', () => {
    const actions = source('apps-card-actions.ts');
    assert.match(actions, /AppCardActionId\s*=\s*'sign_in'\s*\|\s*'details'/);
    assert.doesNotMatch(actions, /\|\s*'(?:install|open|update|repair|retry|cancel|uninstall|delete_app_data|review_permissions)'/);
  });

  it('has no positive package lifecycle invocation anywhere in the feature', () => {
    const combined = readdirSync(featureRoot)
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => source(name))
      .join('\n');
    assert.doesNotMatch(combined, /\.(?:install|uninstall|update|healthRepair|listJobs|watchJobEvents)\s*\(/);
    assert.doesNotMatch(combined, /@nimiplatform\/sdk\/runtime/);
  });

  it('renders the immutable-package posture as a separate state dimension', () => {
    const view = source('apps-panel-view.tsx');
    const detail = source('apps-detail-view.tsx');
    assert.match(view, /data-package-state=\{cardState\.immutablePackage\}/);
    assert.match(view, /IMMUTABLE_PROFILE_UNAVAILABLE/);
    assert.match(detail, /apps-detail-package-readiness/);
    assert.match(detail, /Immutable package unavailable \(0K\)/);
  });

  it('keeps the local-development positive entry in Developer Mode', () => {
    const panel = source('apps-panel-view.tsx');
    assert.match(panel, /onOpenDeveloperMode/);
    assert.match(panel, /DeveloperTools\.developerModeDescription/);
    assert.doesNotMatch(panel, /AppsAIProfileSection|connectLocal|removeLocalAdoption/);
  });
});
