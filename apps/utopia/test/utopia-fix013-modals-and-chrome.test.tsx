import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { NimiAIConfigOptionsQuery, NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import type { NimiUtopiaSnapshot, NimiUtopiaTime } from '@nimiplatform/sdk/app';

const { JSDOM } = createRequire(new URL('../../../kit/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://utopia.invalid',
  pretendToBeVisual: true,
});

for (const name of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLButtonElement',
  'HTMLTextAreaElement',
  'HTMLCanvasElement',
  'SVGElement',
  'Element',
  'Node',
  'NodeFilter',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  if (name in dom.window) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
if (!('PointerEvent' in globalThis)) {
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: dom.window.MouseEvent });
}
if (!('ResizeObserver' in globalThis)) {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: StubResizeObserver });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
if (!dom.window.HTMLElement.prototype.scrollIntoView) {
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
}

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');

const { NimiMotionProvider, NimiThemeProvider, TooltipProvider } = await import('@nimiplatform/kit/ui');
const { NimiAppChrome } = await import('@nimiplatform/kit/ui/app-chrome');

const { validateUtopiaBundleParts } = await import('../src/domain/bundle-validator.js');
const {
  NaturalLanguageTunerSection,
  UTOPIA_APP_ID,
  UTOPIA_MODEL_CONFIG_DRAWER_EVENT,
} = await import('../src/panels/NaturalLanguageTunerSection.js');
const { RelocationAndPackDrawer } = await import('../src/panels/RelocationAndPackDrawer.js');

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

function createZeroModelSnapshot(pack: Awaited<ReturnType<typeof loadBuiltinPack>>): NimiUtopiaSnapshot {
  return {
    revision: 'rev-1',
    observedAt: toUtopiaTime('2026-11-28T10:00:00Z'),
    habitatActivationId: 'act-seaside-1',
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
  };
}

function createUnconfiguredClient(): NimiLocalAppClient {
  const emptySnapshot: NimiAIConfigSnapshot = {
    revision: 'rev-ai-0',
    config: null,
    effectiveSelections: [],
  };
  return {
    aiConfig: {
      get: async () => emptySnapshot,
      listOptions: async (query: NimiAIConfigOptionsQuery) => {
        if (query.kind === 'local-loadouts') {
          return { kind: 'local-loadouts', options: [], truncated: false };
        }
        if (query.kind === 'cloud-connectors') {
          return { kind: 'cloud-connectors', options: [], truncated: false };
        }
        return { kind: 'cloud-targets', options: [], truncated: false };
      },
      overwrite: async () => ({
        outcome: 'saved',
        revision: 'rev-ai-1',
        config: null,
        effectiveSelections: [],
      }),
    },
  } as unknown as NimiLocalAppClient;
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 800): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

function dispatchEscape(target: EventTarget = document.activeElement ?? document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

test('OBS-026: NaturalLanguageTunerSection modal renders zh copy, close button, clickable Home CTA, nested picker & Escape guard', async () => {
  const pack = await loadBuiltinPack('seaside-island');
  const snapshot = createZeroModelSnapshot(pack);
  const client = createUnconfiguredClient();

  const shellInvocations: { command: string; payload: unknown }[] = [];
  const prevElectronTest = (globalThis as Record<string, unknown>).__NIMI_ELECTRON_TEST__;
  let nextOpenIntentStatus: 'accepted' | 'rejected' = 'accepted';
  Object.defineProperty(globalThis, '__NIMI_ELECTRON_TEST__', {
    configurable: true,
    value: {
      invoke: async (command: string, payload: unknown) => {
        shellInvocations.push({ command, payload });
        if (nextOpenIntentStatus === 'rejected') {
          return {
            status: 'rejected',
            reasonCode: 'desktop-open-desktop-not-running',
            actionHint: 'open_desktop_first',
          };
        }
        return {
          status: 'accepted',
          confirmation: 'desktop-accepted',
          bridgeId: 'desktop-open-bridge-1',
          requestId: 'desktop-open-req-utopia',
          appliedTarget: 'open-apps',
        };
      },
    },
  });

  const drawerEvents: boolean[] = [];
  const onDrawerEvent = (event: Event) => {
    drawerEvents.push(Boolean((event as CustomEvent<boolean>).detail));
  };
  window.addEventListener(UTOPIA_MODEL_CONFIG_DRAWER_EVENT, onDrawerEvent);

  // Mirror main.tsx's window Escape guard to verify drawer stays open while modal handles Escape
  let floatingDrawerOpen = true;
  let configDrawerOpen = false;
  const onTrackConfig = (event: Event) => {
    configDrawerOpen = Boolean((event as CustomEvent<boolean>).detail);
  };
  const onWindowEscape = (e: KeyboardEvent) => {
    if (
      e.key !== 'Escape'
      || e.defaultPrevented
      || configDrawerOpen
      || Boolean(
        document.querySelector(
          '[role="dialog"][aria-modal="true"]:not([aria-hidden="true"]), [role="alertdialog"][aria-modal="true"]:not([aria-hidden="true"])',
        ),
      )
    ) {
      return;
    }
    floatingDrawerOpen = false;
  };
  window.addEventListener(UTOPIA_MODEL_CONFIG_DRAWER_EVENT, onTrackConfig);
  window.addEventListener('keydown', onWindowEscape);

  const container = document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <NimiThemeProvider accentPack="nimi-accent">
          <NimiMotionProvider>
            <TooltipProvider>
              <NaturalLanguageTunerSection
                client={client}
                snapshot={snapshot}
                busy={false}
                onCommitTuning={async () => true}
              />
            </TooltipProvider>
          </NimiMotionProvider>
        </NimiThemeProvider>,
      );
    });
    await flushMicrotasks();

    // Click "配置模型路由" to open the model configuration dialog
    const openBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('配置模型路由'),
    );
    assert.ok(openBtn, 'expected 配置模型路由 button');
    await act(async () => {
      openBtn.click();
    });
    await flushMicrotasks();

    assert.equal(configDrawerOpen, true, 'NaturalLanguageTunerSection must notify configDrawerOpen=true');
    assert.equal(drawerEvents.at(-1), true);

    const modal = document.querySelector('[data-testid="utopia-model-config-modal"]') as HTMLElement | null;
    assert.ok(modal, 'expected model config modal to mount');
    assert.match(modal.className, /bg-\[var\(--nimi-surface-card\)\]/);
    assert.equal(modal.style.backgroundColor, 'var(--nimi-surface-card, #ffffff)');

    const backdrop = document.querySelector('.nimi-overlay-backdrop') as HTMLElement | null;
    assert.ok(backdrop, 'expected modal backdrop');
    assert.match(backdrop.className, /bg-\[var\(--nimi-scrim-modal\)\]/);

    // Visible × close button with localized aria-label="关闭"
    const closeBtn = modal.querySelector('[data-testid="nimi-overlay-close"]') as HTMLButtonElement | null;
    assert.ok(closeBtn, 'expected visible × close button inside model config modal');
    assert.equal(closeBtn.getAttribute('aria-label'), '关闭');

    // Localized Chinese UI copy, zero raw English / internal slug jargon
    const modalText = modal.textContent ?? '';
    assert.match(modalText, /配置 NimiUtopia 生成模型/);
    assert.match(modalText, /文本生成设置/);
    assert.match(modalText, /当前模型/);
    assert.match(modalText, /保存设置/);
    assert.doesNotMatch(modalText, /Text Generate settings/);
    assert.doesNotMatch(modalText, /Save settings/);
    assert.doesNotMatch(modalText, /local-or-cloud-by-selected-route/);

    // Click "返回" to check capability list row also renders plain Chinese copy with zero raw slug
    const backBtn = Array.from(modal.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('返回'),
    );
    assert.ok(backBtn, 'expected Chinese 返回 button');
    await act(async () => {
      backBtn.click();
    });
    await flushMicrotasks();

    const listText = modal.textContent ?? '';
    assert.match(listText, /文本生成/);
    assert.match(listText, /选择用于文本生成的本机或云端模型/);
    assert.doesNotMatch(listText, /local-or-cloud-by-selected-route/);

    // Re-enter text.generate detail view
    const textGenRow = modal.querySelector('[data-nimi-model-config-capability="text.generate"]') as HTMLButtonElement | null;
    assert.ok(textGenRow, 'expected text.generate capability row');
    await act(async () => {
      textGenRow.click();
    });
    await flushMicrotasks();

    // Click "一键应用" on 0 models -> must reveal clickable Home CTA wired to openDesktopIntent
    const oneClickBtn = modal.querySelector('[data-testid="model-config-current-machine-local-action"]') as HTMLButtonElement | null;
    assert.ok(oneClickBtn, 'expected 一键应用 button');
    await act(async () => {
      oneClickBtn.click();
    });
    await flushMicrotasks(6);

    assert.match(modal.textContent ?? '', /本机尚未为这些能力选择模型/);
    const homeCtaBtn = modal.querySelector('[data-testid="model-config-current-machine-open-owner"]') as HTMLButtonElement | null;
    assert.ok(homeCtaBtn, 'expected clickable Home CTA after 一键应用 on 0 models');
    assert.match(homeCtaBtn.textContent ?? '', /前往 Nimi Home 配置模型/);

    await act(async () => {
      homeCtaBtn.click();
    });
    await flushMicrotasks();

    assert.equal(shellInvocations.length, 1);
    assert.equal(shellInvocations[0]!.command, 'nimi.shell.desktopOpen.openIntent');
    assert.deepEqual(shellInvocations[0]!.payload, {
      payload: {
        intent: {
          kind: 'open-apps',
          appId: UTOPIA_APP_ID,
          section: 'ai-models',
        },
      },
    });

    // Rejected Home intent surfaces friendly Chinese inline warning instead of throwing unhandled rejection
    nextOpenIntentStatus = 'rejected';
    await act(async () => {
      homeCtaBtn.click();
    });
    await flushMicrotasks();
    assert.match(modal.textContent ?? '', /请先启动 Nimi Home/);

    // Open nested ModelPickerDialog via "未配置" trigger, then verify layered Escape dismissal
    const modelTrigger = modal.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement | null;
    assert.ok(modelTrigger, 'expected model selector trigger');
    await act(async () => {
      modelTrigger.click();
    });
    await flushMicrotasks(6);

    const pickerDialog = document.querySelector('[data-testid="nimi-model-picker-dialog"]') as HTMLElement | null;
    assert.ok(pickerDialog, 'nested ModelPickerDialog should open above parent OverlayShell');
    assert.match(pickerDialog.className, /z-\[calc\(var\(--nimi-z-dialog\)\+1\)\]/);
    assert.match(pickerDialog.textContent ?? '', /选择模型/);
    assert.match(pickerDialog.textContent ?? '', /前往 Nimi Home 配置模型/);

    // 1st Escape closes nested ModelPickerDialog only; parent modal & floating drawer remain open
    await act(async () => {
      dispatchEscape(pickerDialog);
    });
    await flushMicrotasks();
    assert.equal(configDrawerOpen, true, 'parent model config modal must stay open after closing nested picker');
    assert.equal(floatingDrawerOpen, true, 'floating drawer must remain open after closing nested picker');
    assert.equal(pickerDialog.getAttribute('aria-modal'), null, 'nested picker must begin exiting after 1st Escape');
    await waitForCondition(() => document.querySelector('[data-testid="nimi-model-picker-dialog"]') === null);
    assert.ok(
      document.querySelector('[data-testid="utopia-model-config-modal"]'),
      'parent model config modal remains mounted after nested picker exits',
    );

    // 2nd Escape closes parent model config modal; underlying floating drawer must remain open
    await act(async () => {
      dispatchEscape(document);
    });
    await flushMicrotasks();
    assert.equal(configDrawerOpen, false, 'Escape must dismiss model config modal');
    assert.equal(floatingDrawerOpen, true, 'Escape closing model config modal must NOT collapse underlying drawer');
    assert.equal(
      document.querySelectorAll('[role="dialog"][aria-modal="true"]:not([aria-hidden="true"])').length,
      0,
    );
    await waitForCondition(() => document.querySelector('[data-testid="utopia-model-config-modal"]') === null);

    // 3rd Escape (with no modal open) now collapses the underlying floating drawer
    await act(async () => {
      dispatchEscape(document.body);
    });
    await flushMicrotasks();
    assert.equal(floatingDrawerOpen, false, 'Escape with no open modal collapses underlying drawer');

    // Re-open and close via the visible × close button
    await act(async () => {
      openBtn.click();
    });
    await flushMicrotasks();
    assert.equal(configDrawerOpen, true);
    const reopenedCloseBtn = document.querySelector(
      '[data-testid="utopia-model-config-modal"] [data-testid="nimi-overlay-close"]',
    ) as HTMLButtonElement | null;
    assert.ok(reopenedCloseBtn);
    await act(async () => {
      reopenedCloseBtn.click();
    });
    await flushMicrotasks();
    assert.equal(configDrawerOpen, false, 'clicking × must close model config modal');
  } finally {
    await act(async () => {
      root.unmount();
    });
    window.removeEventListener(UTOPIA_MODEL_CONFIG_DRAWER_EVENT, onDrawerEvent);
    window.removeEventListener(UTOPIA_MODEL_CONFIG_DRAWER_EVENT, onTrackConfig);
    window.removeEventListener('keydown', onWindowEscape);
    Object.defineProperty(globalThis, '__NIMI_ELECTRON_TEST__', {
      configurable: true,
      value: prevElectronTest,
    });
  }
});

test('OBS-028(d): RelocationAndPackDrawer renders visible close button, opaque surface, dimmed backdrop, and preserves relocation confirm flow', async () => {
  const seaside = await loadBuiltinPack('seaside-island');
  const starfield = await loadBuiltinPack('starfield-town');
  const snapshot = createZeroModelSnapshot(seaside);

  const storagePort = {
    json: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
    assets: {
      list: async () => [],
      read: async () => new Uint8Array(),
      write: async () => undefined,
      delete: async () => undefined,
    },
  } as unknown as Parameters<typeof RelocationAndPackDrawer>[0]['storagePort'];

  let closeCount = 0;
  const container = document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  const renderDrawer = async (open: boolean) => {
    await act(async () => {
      root.render(
        <NimiThemeProvider accentPack="nimi-accent">
          <NimiMotionProvider>
            <TooltipProvider>
              <RelocationAndPackDrawer
                open={open}
                onClose={() => {
                  closeCount += 1;
                }}
                snapshot={snapshot}
                packs={[seaside, starfield]}
                previewUrls={{}}
                storagePort={storagePort}
                busy={false}
                onPacksChanged={async () => undefined}
                onExecuteRelocation={async () => true}
              />
            </TooltipProvider>
          </NimiMotionProvider>
        </NimiThemeProvider>,
      );
    });
    await flushMicrotasks();
  };

  try {
    await renderDrawer(true);

    const modal = document.querySelector('[data-testid="utopia-pack-library-modal"]') as HTMLElement | null;
    assert.ok(modal, 'expected Pack Library modal');
    assert.match(modal.textContent ?? '', /洞天画卷库与 \.utopia 包导入/);
    assert.match(modal.className, /bg-\[var\(--nimi-surface-card\)\]/);
    assert.equal(modal.style.backgroundColor, 'var(--nimi-surface-card, #ffffff)');

    const backdrop = document.querySelector('.nimi-overlay-backdrop') as HTMLElement | null;
    assert.ok(backdrop, 'expected dimmed backdrop for Pack Library modal');
    assert.match(backdrop.className, /bg-\[var\(--nimi-scrim-modal\)\]/);

    const closeBtn = modal.querySelector('[data-testid="nimi-overlay-close"]') as HTMLButtonElement | null;
    assert.ok(closeBtn, 'expected visible × close button in Pack Library header');
    assert.equal(closeBtn.getAttribute('aria-label'), '关闭');

    // Click "展卷迁居" on 星原晴风镇 -> relocation confirm state retains opaque cards, 返回画卷库, and × close button
    const relocateBtn = Array.from(modal.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '展卷迁居',
    );
    assert.ok(relocateBtn, 'expected 展卷迁居 button for non-active pack');
    await act(async () => {
      relocateBtn.click();
    });
    await flushMicrotasks();

    assert.match(modal.textContent ?? '', /展卷迁居至「星原晴风镇」/);
    assert.ok(modal.querySelector('.utopia-relocate-summary-card'), 'relocation summary card must remain intact');
    assert.ok(modal.querySelector('.utopia-relocate-impact-box'), 'relocation impact box must remain intact');
    assert.ok(modal.querySelector('[data-testid="nimi-overlay-close"]'), '× close button remains visible in confirm view');

    const backToLibraryBtn = Array.from(modal.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '返回画卷库',
    );
    assert.ok(backToLibraryBtn, 'expected 返回画卷库 button in relocation confirm view');
    await act(async () => {
      backToLibraryBtn.click();
    });
    await flushMicrotasks();

    assert.match(modal.textContent ?? '', /洞天画卷库与 \.utopia 包导入/);
    assert.equal(closeCount, 0, 'returning to pack library must not close modal');

    // Clicking × invokes onClose
    const libraryCloseBtn = modal.querySelector('[data-testid="nimi-overlay-close"]') as HTMLButtonElement | null;
    assert.ok(libraryCloseBtn);
    await act(async () => {
      libraryCloseBtn.click();
    });
    await flushMicrotasks();
    assert.equal(closeCount, 1);

    // Pressing Escape invokes onClose cleanly
    await act(async () => {
      dispatchEscape(modal);
    });
    await flushMicrotasks();
    assert.equal(closeCount, 2);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('OBS-028(b-tooltip) & W0-06 Option A + main.tsx Escape guard contract: persistent chrome without sidebar toggle tooltip', async () => {
  // 1. Live NimiAppChrome render with Utopia's exact props keeps persistent header without sidebar toggle button/tooltip
  const container = document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <NimiThemeProvider accentPack="nimi-accent">
          <NimiMotionProvider>
            <TooltipProvider>
              <NimiAppChrome
                metadata={{ name: 'NimiUtopia', version: '0.1.0' }}
                locale="zh"
              />
            </TooltipProvider>
          </NimiMotionProvider>
        </NimiThemeProvider>,
      );
    });
    await flushMicrotasks();

    const chromeHeader = container.querySelector('header.nimi-app-chrome') as HTMLElement | null;
    assert.ok(chromeHeader, 'persistent NimiAppChrome header must remain rendered (W0-06 Option A)');
    assert.equal(chromeHeader.getAttribute('aria-label'), 'NimiUtopia');
    assert.equal(container.querySelector('button[aria-label="隐藏侧栏"]'), null);
    assert.equal(container.querySelector('button[aria-label="显示侧栏"]'), null);
    assert.equal(container.querySelector('[data-nimi-icon="panel-left-collapsed"]'), null);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }

  // 2. Verify apps/utopia/src/main.tsx wires NimiAppChrome without sidebar prop and guards Escape against both modals
  const mainSource = await fs.readFile(path.join(UTOPIA_ROOT, 'src/main.tsx'), 'utf8');
  const chromeMatch = mainSource.match(/<NimiAppChrome[\s\S]*?\/>/);
  assert.ok(chromeMatch, 'main.tsx must render <NimiAppChrome />');
  assert.doesNotMatch(chromeMatch[0], /\bsidebar\s*=/, 'NimiAppChrome must omit sidebar prop to prevent overlapping 隐藏侧栏 (Cmd+B) tooltip');
  assert.match(chromeMatch[0], /locale="zh"/);

  assert.match(mainSource, /utopia:model-config-drawer-change/);
  assert.match(mainSource, /\[configDrawerOpen,\s*setConfigDrawerOpen\]\s*=\s*useState\(false\)/);
  assert.match(
    mainSource,
    /e\.key !== 'Escape'[\s\S]*?packDrawerOpen[\s\S]*?configDrawerOpen/,
    'main.tsx window Escape listener must guard against both packDrawerOpen and configDrawerOpen',
  );
  // Preserve lazy code-splitting for DeterministicTunerPanel / NaturalLanguageTunerSection
  assert.doesNotMatch(mainSource, /from '\.\/panels\/NaturalLanguageTunerSection\.js'/);
});
