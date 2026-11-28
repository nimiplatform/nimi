import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { NimiUtopiaResident, NimiUtopiaSnapshot, NimiUtopiaTime } from '@nimiplatform/sdk/app';

const { JSDOM } = createRequire(new URL('../../../kit/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://component.invalid', pretendToBeVisual: true });
for (const name of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLCanvasElement',
  'Element',
  'Node',
  'NodeFilter',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');

const { validateUtopiaBundleParts } = await import('../src/domain/bundle-validator.js');
const { HorizonTopBar, UTOPIA_HORIZON_HEIGHT_VAR } = await import('../src/panels/HorizonTopBar.js');
const { JournalAndSharedTab } = await import('../src/panels/JournalAndSharedTab.js');
const {
  STREET_DEFAULT_ZOOM,
  UTOPIA_PRESENCE_DOCK_HEIGHT_VAR,
  UtopiaStageViewport,
  computeDefaultStageCamera,
} = await import('../src/stage/UtopiaStageViewport.js');
const { WorldMiniMap } = await import('../src/stage/WorldMiniMap.js');
const { resolveWorldLandmarks } = await import('../src/domain/world-landmarks.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTOPIA_ROOT = path.resolve(__dirname, '..');
const PUBLIC_PACKS_ROOT = path.resolve(UTOPIA_ROOT, 'public/builtin-packs');

function toUtopiaTime(iso: string): NimiUtopiaTime {
  const ms = Date.parse(iso);
  return {
    seconds: String(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  };
}

async function loadBuiltinPack(slug: string) {
  const dir = path.join(PUBLIC_PACKS_ROOT, slug);
  const rawManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const rawHabitat = JSON.parse(await fs.readFile(path.join(dir, 'habitat.json'), 'utf8'));
  const rawStage = JSON.parse(await fs.readFile(path.join(dir, 'stage.json'), 'utf8'));
  const assetEntries = await fs.readdir(path.join(dir, 'assets'));
  const rawAssets = new Map<string, Uint8Array>();
  for (const name of assetEntries) {
    rawAssets.set(`assets/${name}`, new Uint8Array(await fs.readFile(path.join(dir, 'assets', name))));
  }
  const validated = await validateUtopiaBundleParts({
    rawManifest,
    rawHabitat,
    rawStage,
    rawAssets,
    allowBuiltinNamespace: true,
  });
  return {
    source: 'builtin' as const,
    slug,
    manifest: validated.manifest,
    habitat: validated.habitat,
    stage: validated.stage,
    contentDigest: validated.contentDigest,
    installedAt: 'builtin',
    assetRoot: null,
    assetPaths: Array.from(validated.assets.keys()),
  };
}

function createZeroPartnerSeasideSnapshot(
  pack: Awaited<ReturnType<typeof loadBuiltinPack>>,
  overrides: Partial<NimiUtopiaSnapshot> = {},
): NimiUtopiaSnapshot {
  const nowIso = '2026-11-28T10:00:00Z';
  return {
    revision: 'rev-1',
    observedAt: toUtopiaTime(nowIso),
    habitatActivationId: 'act-seaside-0',
    contentDigest: pack.contentDigest,
    timezone: 'Asia/Shanghai',
    publicParticipation: false,
    habitat: pack.habitat,
    parameterValues: Object.fromEntries(pack.habitat.parameters.map((p) => [p.key, p.defaultValue])),
    openPlaceIds: pack.habitat.places.map((p) => p.id),
    activeEvents: [],
    lastRelocation: null,
    residents: [],
    occupancy: [],
    sharedActivities: [],
    ...overrides,
  };
}

test('OBS-025: HorizonTopBar publishes live --utopia-horizon-height via ResizeObserver and cleans up on unmount', async () => {
  const pack = await loadBuiltinPack('seaside-island');
  const snapshot = createZeroPartnerSeasideSnapshot(pack);

  const observedTargets: Element[] = [];
  const callbacks: ResizeObserverCallback[] = [];
  let disconnectCount = 0;

  class MockResizeObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      callbacks.push(cb);
    }
    observe(target: Element) {
      observedTargets.push(target);
    }
    unobserve() {}
    disconnect() {
      disconnectCount += 1;
    }
  }

  const prevRO = globalThis.ResizeObserver;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver });

  const container = document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <div className="utopia-world-shell">
          <HorizonTopBar
            snapshot={snapshot}
            nowMs={Date.parse('2026-11-28T10:00:00Z')}
            daypart="dusk"
            frozen={false}
            audioMuted={true}
            hasAudioTrack={true}
            sidebarCollapsed={false}
            activeDrawerTab="tuner"
            onSelectDrawerTab={() => undefined}
            onToggleAudioMute={() => undefined}
            onOpenTuner={() => undefined}
            onOpenPackLibrary={() => undefined}
            onToggleSidebar={() => undefined}
            onRetryRefresh={() => undefined}
          />
        </div>,
      );
    });

    const shell = container.querySelector('.utopia-world-shell') as HTMLElement;
    const header = container.querySelector('header.utopia-horizon-bar') as HTMLElement;
    assert.ok(shell);
    assert.ok(header);
    assert.ok(observedTargets.includes(header), 'HorizonTopBar must observe header.utopia-horizon-bar');
    assert.equal(callbacks.length, 1);

    // Simulate 2-row wrapped header when scenery pill is lit at 1200x780
    await act(async () => {
      callbacks[0]!(
        [{ target: header, borderBoxSize: [{ blockSize: 82.2, inlineSize: 1176 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    assert.equal(shell.style.getPropertyValue(UTOPIA_HORIZON_HEIGHT_VAR), '83px');

    // Simulate 3-row wrapped header at 640x680
    await act(async () => {
      callbacks[0]!(
        [{ target: header, borderBoxSize: [{ blockSize: 118, inlineSize: 616 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    assert.equal(shell.style.getPropertyValue(UTOPIA_HORIZON_HEIGHT_VAR), '118px');

    await act(async () => {
      root.unmount();
    });
    assert.equal(disconnectCount, 1);
    assert.equal(shell.style.getPropertyValue(UTOPIA_HORIZON_HEIGHT_VAR), '');
  } finally {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: prevRO });
  }
});

test('OBS-025 & OBS-028(e): UtopiaStageViewport publishes live presence dock height and computes top-cleared default framing', async () => {
  const seaside = await loadBuiltinPack('seaside-island');
  const starfield = await loadBuiltinPack('starfield-town');

  // Unmeasured viewport stays deterministic without NaN
  assert.deepEqual(computeDefaultStageCamera(0, 0), {
    zoom: STREET_DEFAULT_ZOOM,
    panX: 0,
    panY: 0,
  });

  // Default 1200x780 window minus 40px chrome -> 1200x740 stage viewport
  const vw = 1200;
  const vh = 740;
  const cam = computeDefaultStageCamera(vw, vh, 16, 9);
  assert.equal(cam.zoom, STREET_DEFAULT_ZOOM);
  assert.equal(cam.panX, 0);
  assert.ok(cam.panY > 0, 'default framing must bias downward for top horizon clearance');

  const coverScale = Math.max(vw / 1920, vh / 1080);
  const baseH = 1080 * coverScale;
  const projectY = (yPercent: number) => vh / 2 + cam.panY + (yPercent / 100 - 0.5) * baseH * cam.zoom;
  const pinHalfHeight = 14;
  const horizonBarBottom = 52;
  const bottomDockTop = vh - 14 - 48;

  // Seaside Island top anchors & lighthouse landmark must clear the horizon bar
  for (const targetId of ['bird-hide', 'boat-workshop']) {
    const anchor = seaside.stage.anchors.find((a) => a.targetId === targetId)!;
    const pinTop = projectY(anchor.yPercent) - pinHalfHeight;
    assert.ok(
      pinTop >= horizonBarBottom,
      `seaside ${targetId} pinTop (${pinTop.toFixed(1)}px) must clear horizonBarBottom (${horizonBarBottom}px)`,
    );
  }
  const lighthouse = resolveWorldLandmarks('nimi.builtin.seaside-island').find(
    (lm) => lm.id === 'landmark:cape-lighthouse',
  )!;
  assert.ok(projectY(lighthouse.yPercent) - pinHalfHeight >= horizonBarBottom);

  // Seaside Island bottom anchor (`礁石滩涂`) must remain above the bottom presence dock
  const tidalReef = seaside.stage.anchors.find((a) => a.targetId === 'tidal-reef')!;
  const tidalReefBottom = projectY(tidalReef.yPercent) + pinHalfHeight;
  assert.ok(
    tidalReefBottom <= bottomDockTop,
    `tidal-reef bottom (${tidalReefBottom.toFixed(1)}px) must stay above bottomDockTop (${bottomDockTop}px)`,
  );

  // Starfield Town top anchors (`东坡风车工坊`, `晴光玻璃花房`) also clear the horizon bar
  for (const targetId of ['windmill-atelier', 'sunlight-greenhouse']) {
    const anchor = starfield.stage.anchors.find((a) => a.targetId === targetId)!;
    assert.ok(projectY(anchor.yPercent) - pinHalfHeight >= horizonBarBottom);
  }

  // Verify ResizeObserver publishes --utopia-presence-dock-height onto .utopia-world-shell
  const observedMap = new Map<Element, ResizeObserverCallback>();
  class MockResizeObserver {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      observedMap.set(target, this.cb);
    }
    unobserve() {}
    disconnect() {}
  }

  const prevRO = globalThis.ResizeObserver;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver });

  const assetUrls: Record<string, string> = {};
  for (const rel of seaside.assetPaths) {
    assetUrls[rel] = `./builtin-packs/seaside-island/${rel}`;
  }
  const snapshot = createZeroPartnerSeasideSnapshot(seaside);
  const container = document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <div className="utopia-world-shell">
          <UtopiaStageViewport
            snapshot={snapshot}
            stageMedia={{ pack: seaside, assetUrls, revokeAll: async () => undefined }}
            daypart="dusk"
            frozen={false}
            reducedMotion={true}
            transitioning={false}
            selectedPlaceId={null}
            selectedResidentHandle={null}
            onSelectPlace={() => undefined}
            onSelectResident={() => undefined}
          />
        </div>,
      );
    });

    const shell = container.querySelector('.utopia-world-shell') as HTMLElement;
    const dockWrap = container.querySelector('.utopia-floating-bottom-left') as HTMLElement;
    assert.ok(shell);
    assert.ok(dockWrap);
    const dockCb = observedMap.get(dockWrap);
    assert.ok(dockCb, 'UtopiaStageViewport must attach ResizeObserver to .utopia-floating-bottom-left');

    await act(async () => {
      dockCb(
        [{ target: dockWrap, borderBoxSize: [{ blockSize: 48, inlineSize: 612 }] } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    assert.equal(shell.style.getPropertyValue(UTOPIA_PRESENCE_DOCK_HEIGHT_VAR), '48px');

    await act(async () => {
      root.unmount();
    });
    assert.equal(shell.style.getPropertyValue(UTOPIA_PRESENCE_DOCK_HEIGHT_VAR), '');
  } finally {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: prevRO });
  }
});

test('OBS-027(c): apps/utopia/nimi.app.yaml declares text.generate capability_contract_refs', async () => {
  const manifestText = await fs.readFile(path.join(UTOPIA_ROOT, 'nimi.app.yaml'), 'utf8');
  assert.match(manifestText, /^capability_contract_refs:\s*\n\s*-\s*text\.generate$/m);
  assert.match(manifestText, /^\s*-\s*agent\.utopia\.read$/m);
  assert.match(manifestText, /^\s*-\s*agent\.utopia\.manage$/m);
  assert.match(manifestText, /^\s*-\s*runtime\.consume$/m);
});

test('OBS-028(a, b-seam) & OBS-025 CSS contracts: parchment chrome unification, wrapped minimap chips, and dynamic drawer bounds', async () => {
  const css = await fs.readFile(path.join(UTOPIA_ROOT, 'src/styles.css'), 'utf8');

  // OBS-028(b-seam) + W0-06 Option A: unified parchment chrome background across macOS traffic-light gutter
  assert.match(css, /--utopia-chrome-bg:\s*#[0-9a-fA-F]{6};/);
  assert.match(
    css,
    /\.utopia-app-frame\s*>\s*\.nimi-app-chrome\s*\{[\s\S]*?--nimi-surface-panel:\s*var\(--utopia-chrome-bg\);[\s\S]*?background-color:\s*var\(--utopia-chrome-bg\);[\s\S]*?border-bottom-color:\s*transparent;/,
  );
  assert.match(
    css,
    /\.utopia-world-shell\s*\{[\s\S]*?border-top:\s*1px solid var\(--utopia-chrome-border\);/,
  );

  // OBS-028(a): minimap place strip wraps chips cleanly with no horizontal clipping
  assert.match(
    css,
    /\.utopia-minimap-place-strip\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow-x:\s*hidden;/,
  );

  // OBS-025: floating drawer anchors dynamically below --utopia-horizon-height and above --utopia-presence-dock-height
  assert.match(
    css,
    /\.utopia-floating-drawer\s*\{[\s\S]*?top:\s*calc\(var\(--utopia-horizon-height,\s*44px\)\s*\+\s*18px\);/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*760px\)\s*\{[\s\S]*?\.utopia-floating-drawer\s*\{[\s\S]*?bottom:\s*calc\(52px\s*\+\s*var\(--utopia-presence-dock-height,\s*56px\)\s*\+\s*8px\);/,
  );

  // WorldMiniMap renders all Seaside Island chips with .utopia-minimap-chip-label (including 木船工坊 and 海岸木平台)
  const seaside = await loadBuiltinPack('seaside-island');
  const snapshot = createZeroPartnerSeasideSnapshot(seaside);
  const miniMapHtml = renderToStaticMarkup(
    <WorldMiniMap
      snapshot={snapshot}
      previewUrl="./builtin-packs/seaside-island/assets/preview.png"
      anchors={seaside.stage.anchors}
      viewportBox={{ leftPercent: 10, topPercent: 10, widthPercent: 75, heightPercent: 75 }}
      selectedPlaceId={null}
      selectedLandmarkId={null}
      residentCoords={new Map()}
      onJumpToPercent={() => undefined}
      onSelectPlace={() => undefined}
    />,
  );
  assert.match(miniMapHtml, /utopia-minimap-chip-label">木船工坊</);
  assert.match(miniMapHtml, /utopia-minimap-chip-label">海岸木平台</);
});

test('OBS-029(b): JournalAndSharedTab renders honest 0-partner onboarding guidance without false resident or navigation claims', async () => {
  const seaside = await loadBuiltinPack('seaside-island');

  for (const publicParticipation of [false, true]) {
    const emptySnapshot = createZeroPartnerSeasideSnapshot(seaside, { publicParticipation });
    const html = renderToStaticMarkup(
      <JournalAndSharedTab
        snapshot={emptySnapshot}
        highlights={[]}
        onOpenDraft={() => undefined}
      />,
    );

    assert.match(html, /公共场所 4\/4 开放/);
    assert.match(html, /等待伙伴入住/);
    assert.match(html, /Nimi Home「我的伙伴」/);
    assert.match(html, /自主生活/);
    assert.doesNotMatch(html, /开放场所 4\/4/);
    assert.doesNotMatch(html, /上方伙伴/);
    assert.doesNotMatch(html, /舞台路牌/);
    assert.doesNotMatch(html, /伙伴们各自按昼夜节律起居/);
    assert.doesNotMatch(html, /眼下大家都守着各自的清静时光/);
  }

  // Populated resident quiet state also avoids inaccurate "上方伙伴或舞台路牌" wording
  const populatedSnapshot = createZeroPartnerSeasideSnapshot(seaside, {
    publicParticipation: true,
    residents: [
      {
        agentHandle: 'agent-sea-1' as NimiUtopiaResident['agentHandle'],
        displayName: '阿潮',
        solitary: false,
        current: null,
        recent: null,
        next: null,
      },
    ],
  });
  const populatedHtml = renderToStaticMarkup(
    <JournalAndSharedTab
      snapshot={populatedSnapshot}
      highlights={[]}
      onOpenDraft={() => undefined}
    />,
  );
  assert.match(populatedHtml, /公共场所 4\/4 开放/);
  assert.match(populatedHtml, /左下角「伙伴行迹」/);
  assert.doesNotMatch(populatedHtml, /开放场所 4\/4/);
  assert.doesNotMatch(populatedHtml, /上方伙伴/);
  assert.doesNotMatch(populatedHtml, /舞台路牌/);
});
