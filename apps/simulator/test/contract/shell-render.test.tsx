import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SimulatorShellView, SIMULATOR_STATUS_TEXT } from '../../src/shell/ui.tsx';
import { AppLogo } from '../../src/shell/chrome/app-logo.tsx';
import {
  clampDepthWindowPosition,
  resizeDepthWindowBounds,
  resolveDepth,
  resolveDepthState,
} from '../../src/shell/chrome/depth-workspace.tsx';

const simulatorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function renderShell(overrides = {}) {
  return renderToStaticMarkup(h(SimulatorShellView, {
    epoch: 1,
    phase: 'open',
    moduleCount: 0,
    route: { kind: 'home' },
    instances: [],
    diagnostics: [],
    modules: [],
    onNavigate: () => {},
    onOpen: async () => null,
    onClose: () => {},
    onActivate: () => {},
    onDeactivate: () => {},
    onReset: () => {},
    ...overrides,
  }));
}

test('committed shell retains persistent disclosure with the compact depth workspace', () => {
  const markup = renderShell();
  assert.ok(markup.includes(SIMULATOR_STATUS_TEXT));
  assert.ok(markup.includes('role="status"'));
  assert.ok(markup.includes('epoch 1'));
  assert.ok(markup.includes('data-testid="simulator-status"'));
  assert.ok(markup.includes('0 selected modules'));
  assert.ok(!markup.includes('App instances'));
  assert.ok(!markup.includes('No App instances are open.'));
  assert.ok(markup.includes('aria-label="桌面平铺工作区"'));
  assert.ok(markup.includes('data-tile-window="modules"'));
  assert.ok(markup.includes('data-tile-window="worlds"'));
  assert.ok(!markup.includes('data-tile-window="grants"'));
  assert.ok(!markup.includes('simulator-nav'));
  assert.ok(!markup.includes('WORLDS'));
  assert.ok(!markup.includes('>世界<'));
  assert.ok(!markup.includes('生态地图'));
  assert.ok(!markup.includes('带入织语'));
  assert.ok(!markup.includes('可撤销'));
  assert.ok(!markup.includes('记录足迹'));
  assert.ok(!markup.includes('Starport · presentation only'));
  assert.ok(!markup.includes('社交场景'));
  assert.ok(!markup.includes('发起方'));
  assert.ok(!markup.includes('接收方'));
  assert.ok(markup.includes('>应用<'));
  assert.ok(markup.includes('>全部 <span aria-hidden="true">⤢</span>'));
  assert.ok(!markup.includes('>历史 <span class="pane-action-open-icon" aria-hidden="true">⤢</span>'));
  assert.ok(markup.includes('aria-label="打开交互账本"'));
  assert.ok(!markup.includes('aria-label="打开交互账本授权页"'));
  assert.ok(!markup.includes('depth-window__icon'));
});

test('home chrome omits the presentation labels removed from the compact desktop', () => {
  const markup = renderShell({
    moduleCount: 1,
    modules: [
      {
        moduleId: 'desktop',
        surfaces: [{ id: 'main', label: 'Nimi Desktop' }],
      },
    ],
  });

  assert.ok(markup.includes('Nimi Desktop'));
  assert.ok(!markup.includes('模块 · MODULES'));
  assert.ok(!markup.includes('从桌面进入'));
  assert.ok(!markup.includes('desktop · main'));
  assert.ok(!markup.includes('Reset scenario'));
  assert.ok(!markup.includes('授权 · GRANTS'));
  assert.ok(!markup.includes('Simulated persona pending'));
});

test('depth workspace derives a cyclic, extensible queue from activeIndex', () => {
  const count = 6;
  const activeIndex = 4;
  assert.deepEqual(
    Array.from({ length: count }, (_, index) => resolveDepthState(resolveDepth(index, activeIndex, count))),
    ['depth-2', 'depth-3', 'hidden', 'hidden', 'focus', 'depth-1'],
  );
});

test('depth workspace clamps free x/y movement while keeping its header reachable', () => {
  const rect = { left: 300, top: 200, width: 700, height: 400 };
  const viewport = { width: 1200, height: 800 };

  assert.deepEqual(
    clampDepthWindowPosition({ x: 40, y: 20 }, { x: 120, y: -70 }, rect, viewport),
    { x: 160, y: -50 },
  );
  assert.deepEqual(
    clampDepthWindowPosition({ x: 0, y: 0 }, { x: -1000, y: -1000 }, rect, viewport),
    { x: -812, y: -152 },
  );
  assert.deepEqual(
    clampDepthWindowPosition({ x: 0, y: 0 }, { x: 1000, y: 1000 }, rect, viewport),
    { x: 712, y: 538 },
  );
});

test('depth workspace resizes freely from every edge while preserving usable bounds', () => {
  const initial = { x: 300, y: 200, w: 700, h: 400 };
  const viewport = { width: 1400, height: 1000 };

  assert.deepEqual(
    resizeDepthWindowBounds(initial, 'se', { x: 120, y: 90 }, viewport),
    { x: 300, y: 200, w: 820, h: 490 },
  );
  assert.deepEqual(
    resizeDepthWindowBounds(initial, 'nw', { x: -80, y: -60 }, viewport),
    { x: 220, y: 140, w: 780, h: 460 },
  );
  assert.deepEqual(
    resizeDepthWindowBounds(initial, 'nw', { x: 1000, y: 1000 }, viewport),
    { x: 720, y: 400, w: 280, h: 200 },
  );
  assert.deepEqual(
    resizeDepthWindowBounds(initial, 'se', { x: 2000, y: 2000 }, viewport),
    { x: 300, y: 200, w: 1092, h: 792 },
  );
});

test('persistent simulated status remains visible in every phase', () => {
  for (const phase of ['open', 'resetting', 'terminal']) {
    const markup = renderShell({ phase });
    assert.ok(markup.includes(SIMULATOR_STATUS_TEXT), phase);
    assert.ok(markup.includes('data-testid="simulator-status"'), phase);
    if (phase !== 'open') assert.ok(markup.includes(`>${phase}<`), phase);
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
  assert.ok(markup.includes('App instances'));
  assert.ok(markup.includes('No App instances are open.'));
  assert.ok(markup.includes('instance: SIMULATOR_INSTANCE_FAILED'));
  assert.ok(markup.includes('session: SIMULATOR_INTEGRITY_FAILURE'));
});

test('open instances render in creation order with status', () => {
  const markup = renderShell({
    route: { kind: 'diagnostics' },
    moduleCount: 1,
    instances: [
      { instanceId: '1:instance:1', moduleId: 'fixture-module', surfaceId: 'main', status: 'active', readiness: 'usable', route: { pathname: '/', search: [], fragment: null } },
      { instanceId: '1:instance:2', moduleId: 'fixture-module', surfaceId: 'main', status: 'inactive', readiness: 'pending', route: { pathname: '/', search: [], fragment: null } },
    ],
  });
  assert.ok(markup.includes('fixture-module — active'));
  assert.ok(markup.includes('fixture-module — inactive'));
  assert.ok(markup.indexOf('fixture-module — active') < markup.indexOf('fixture-module — inactive'));
  assert.ok(markup.includes('App instances'));
});

test('full-window route retains disclosure and exposes a deterministic exit control', () => {
  const markup = renderShell({
    route: { kind: 'instance', instanceId: '1:instance:1', appRoute: { pathname: '/details', search: [], fragment: null } },
    instances: [
      { instanceId: '1:instance:1', moduleId: 'desktop', surfaceId: 'main', status: 'active', readiness: 'usable', route: { pathname: '/details', search: [], fragment: null } },
    ],
  });
  assert.ok(markup.includes(SIMULATOR_STATUS_TEXT));
  assert.ok(markup.includes('simulator-shell--full-window'));
  assert.ok(markup.includes('data-full-window-instance="1:instance:1"'));
  assert.ok(markup.includes('Exit full window'));
  assert.ok(markup.includes('desktop full window'));
});

test('full-window chrome and the App surface share one compact height contract', () => {
  const foundationStyles = readFileSync(path.join(simulatorRoot, 'src/styles.css'), 'utf8');
  const paneStyles = readFileSync(path.join(simulatorRoot, 'src/shell/styles/panes.css'), 'utf8');
  assert.match(foundationStyles, /--simulator-full-window-bar-height:\s*2\.5rem;/u);
  assert.match(
    foundationStyles,
    /\.simulator-shell--full-window\s*\{[^}]*height:\s*var\(--simulator-full-window-bar-height\);/su,
  );
  assert.match(
    paneStyles,
    /\.simulator-surfaces\[data-full-window='true'\] \.simulator-surface\s*\{[^}]*inset:\s*var\(--simulator-full-window-bar-height\) 0 0 0 !important;/su,
  );
  assert.doesNotMatch(foundationStyles, /100vh\s*-\s*7rem/u);
  assert.doesNotMatch(paneStyles, /inset:\s*7rem 0 0 0/u);
});

test('the Simulator owns exactly one React root and App surfaces render as portals', () => {
  const mountSource = readFileSync(path.join(simulatorRoot, 'src/shell/mount.ts'), 'utf8');
  const surfaceSource = readFileSync(path.join(simulatorRoot, 'src/shell/browser-surface-host.tsx'), 'utf8');
  assert.equal(mountSource.match(/\bcreateRoot\s*\(/gu)?.length, 1);
  assert.equal(surfaceSource.match(/\bcreateRoot\s*\(/gu)?.length ?? 0, 0);
  assert.match(surfaceSource, /\bcreatePortal\s*\(/u);
});

test('the app rail uses each selected first-party app logo and keeps an honest fallback', () => {
  for (const moduleId of ['desktop', 'zhiyu', 'tester']) {
    const markup = renderToStaticMarkup(h(AppLogo, { moduleId, size: 'rail' }));
    assert.match(markup, new RegExp(`data-logo-module="${moduleId}"`, 'u'));
    assert.match(markup, /<img/u);
    assert.doesNotMatch(markup, /spine-glyph/u);
  }

  const fallback = renderToStaticMarkup(h(AppLogo, { moduleId: 'future-app', size: 'rail' }));
  assert.match(fallback, /spine-glyph-future-app/u);
  assert.doesNotMatch(fallback, /<img/u);

  const appRailSource = readFileSync(path.join(simulatorRoot, 'src/shell/chrome/app-rail.tsx'), 'utf8');
  assert.match(appRailSource, /<AppLogo moduleId=\{id\} size="rail" \/>/u);

  const appsPageSource = readFileSync(path.join(simulatorRoot, 'src/shell/chrome/apps-page.tsx'), 'utf8');
  const searchIconSource = appsPageSource.match(
    /<span className="apps-search-icon"[\s\S]*?<\/span>/u,
  )?.[0] ?? '';
  assert.match(searchIconSource, /<Search size=\{17\}/u);
  assert.doesNotMatch(searchIconSource, /<AppLogo/u);
  assert.match(appsPageSource, /<AppLogo moduleId=\{entry\.key\} size="card" \/>/u);
  assert.doesNotMatch(appsPageSource, />⌕</u);
});

test('the home applications tile uses each selected first-party App logo', () => {
  const markup = renderShell({
    moduleCount: 3,
    modules: [
      { moduleId: 'desktop', surfaces: [{ id: 'main', label: 'Nimi Desktop' }] },
      { moduleId: 'tester', surfaces: [{ id: 'main', label: 'Nimi Lab' }] },
      { moduleId: 'zhiyu', surfaces: [{ id: 'main', label: '织羽 Zhiyu' }] },
    ],
  });

  for (const moduleId of ['desktop', 'tester', 'zhiyu']) {
    assert.match(
      markup,
      new RegExp(`data-logo-module="${moduleId}" data-logo-size="home"`, 'u'),
    );
  }
  assert.doesNotMatch(markup, /cradle-glyph/u);
});

test('each App window title bar uses the App-owned logo instead of a generic accent', () => {
  for (const moduleId of ['desktop', 'zhiyu', 'tester']) {
    const markup = renderToStaticMarkup(h(AppLogo, { moduleId, size: 'window' }));
    assert.match(markup, new RegExp(`data-logo-module="${moduleId}"`, 'u'));
    assert.match(markup, /data-logo-size="window"/u);
  }

  const windowManagerSource = readFileSync(
    path.join(simulatorRoot, 'src/shell/chrome/window-manager.tsx'),
    'utf8',
  );
  assert.match(
    windowManagerSource,
    /<AppLogo moduleId=\{instance\.moduleId\} size="window" \/>/u,
  );
  assert.doesNotMatch(windowManagerSource, /module-accent/u);
});
