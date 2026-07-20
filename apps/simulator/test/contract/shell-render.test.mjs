import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimulatorShellView, SIMULATOR_STATUS_TEXT } from '../../src/shell/ui.ts';

const simulatorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function renderShell(overrides = {}) {
  return renderToStaticMarkup(h(SimulatorShellView, {
    epoch: 1,
    phase: 'open',
    registryDigest: 'sha256:43fcca22e15ccc6241d82ab0fda6f963cdaa2af965d0ffdde960aec786cc0279',
    moduleCount: 0,
    route: { kind: 'home' },
    instances: [],
    diagnostics: [],
    onNavigate: () => {},
    ...overrides,
  }));
}

test('empty shell renders the persistent simulated-status surface', () => {
  const markup = renderShell();
  assert.ok(markup.includes(SIMULATOR_STATUS_TEXT));
  assert.ok(markup.includes('role="status"'));
  assert.ok(markup.includes('data-registry-digest="sha256:43fcca22e15ccc6241d82ab0fda6f963cdaa2af965d0ffdde960aec786cc0279"'));
  assert.ok(markup.includes('0 selected modules'));
  assert.ok(markup.includes('No App instances are open.'));
});

test('simulated status remains visible in resetting and terminal states', () => {
  for (const phase of ['open', 'resetting', 'terminal']) {
    const markup = renderShell({ phase });
    assert.ok(markup.includes(SIMULATOR_STATUS_TEXT), phase);
    if (phase !== 'open') {
      assert.ok(markup.includes(`>${phase}<`), phase);
    }
  }
});

test('diagnostics route renders the diagnostics region and records', () => {
  const markup = renderShell({
    route: { kind: 'diagnostics' },
    diagnostics: [
      {
        diagnosticId: 'diag:1',
        scope: 'instance',
        code: 'SIMULATOR_INSTANCE_FAILED',
        moduleId: 'fixture-module',
        instanceId: '1:instance:1',
        epoch: 1,
      },
      {
        diagnosticId: 'diag:2',
        scope: 'session',
        code: 'SIMULATOR_INTEGRITY_FAILURE',
        moduleId: null,
        instanceId: null,
        epoch: 1,
      },
    ],
  });
  assert.ok(markup.includes('Session diagnostics'));
  assert.ok(markup.includes('instance: SIMULATOR_INSTANCE_FAILED'));
  assert.ok(markup.includes('session: SIMULATOR_INTEGRITY_FAILURE'));
});

test('open instances render in creation order with status', () => {
  const markup = renderShell({
    moduleCount: 1,
    instances: [
      { instanceId: '1:instance:1', moduleId: 'fixture-module', surfaceId: 'main', status: 'active' },
      { instanceId: '1:instance:2', moduleId: 'fixture-module', surfaceId: 'main', status: 'inactive' },
    ],
  });
  assert.ok(markup.includes('fixture-module — active'));
  assert.ok(markup.includes('fixture-module — inactive'));
  assert.ok(markup.indexOf('fixture-module — active') < markup.indexOf('fixture-module — inactive'));
  assert.ok(markup.includes('1 selected module'));
});

test('the Simulator owns exactly one React root and App surfaces render as portals', () => {
  const mountSource = readFileSync(path.join(simulatorRoot, 'src/shell/mount.ts'), 'utf8');
  const surfaceSource = readFileSync(path.join(simulatorRoot, 'src/shell/browser-surface-host.tsx'), 'utf8');
  assert.equal(mountSource.match(/\bcreateRoot\s*\(/gu)?.length, 1);
  assert.equal(surfaceSource.match(/\bcreateRoot\s*\(/gu)?.length ?? 0, 0);
  assert.match(surfaceSource, /\bcreatePortal\s*\(/u);
});
