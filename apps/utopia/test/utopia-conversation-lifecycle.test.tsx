import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type { NimiUtopiaResident, NimiUtopiaSnapshot } from '@nimiplatform/sdk/app';
import type { AppConversationEntrySession } from '@nimiplatform/kit/features/chat/headless';

// Reuse the workspace Kit's installed DOM test runtime; no browser/native process.
const { JSDOM } = createRequire(new URL('../../../kit/package.json', import.meta.url))('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://component.invalid', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { act, StrictMode, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ResidentDetailAndDraft, activateFormalSessionFromDraft, createZeroSideEffectDraftState, editZeroSideEffectDraftText } = await import('../src/panels/ResidentDetailAndDraft.js');
const { HorizonTopBar } = await import('../src/panels/HorizonTopBar.js');
const { RelocationAndPackDrawer } = await import('../src/panels/RelocationAndPackDrawer.js');
type Draft = ReturnType<typeof createZeroSideEffectDraftState>;

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const resident = { agentHandle: 'agent-test' as NimiUtopiaResident['agentHandle'], displayName: '伙伴', solitary: false };
const snapshot = { residents: [resident], sharedActivities: [], publicParticipation: true, habitat: { personalQuarter: { name: "私舍" } } } as unknown as NimiUtopiaSnapshot;
const client = {} as NimiLocalAppClient;

for (const scenario of ['pending-remount', 'settled-while-hidden', 'rejected-while-hidden', 'edit-while-hidden', 'replace-draft', 'hide-before-ready', 'manual-send']) {
  test(`Real React effects preserve one send across unmount/remount: ${scenario}`, async () => {
    const gate = deferred();
    const ready = deferred();
    const calls: { requestId: string; parts: unknown }[] = [];
    const sessions: { disposed: boolean; sends: number }[] = [];
    const factory = () => {
      const owner = { disposed: false, sends: 0 }; sessions.push(owner);
      return {
        getState: () => ({ status: 'ready', messages: [], activeTurnId: null, error: null }),
        observe: () => () => {},
        loadReferences: () => scenario === 'hide-before-ready' ? ready.promise : Promise.resolve(),
        selectReference: () => Promise.resolve(),
        send: async (req: { requestId: string; parts: unknown }) => {
          assert.equal(owner.disposed, false, 'dispatch used a disposed session');
          owner.sends++; calls.push(req);
          await gate.promise;
          assert.equal(owner.disposed, false, 'session disposed before the accepted send settled');
        },
        dispose: async () => { owner.disposed = true; },
      } as unknown as AppConversationEntrySession;
    };
    let visible!: (value: boolean) => void;
    let changeDraft!: (value: Draft | ((previous: Draft | null) => Draft | null)) => void;
    let current: Draft | null = null;
    const initial = createZeroSideEffectDraftState(resident, '你好');
    const activated = activateFormalSessionFromDraft(initial, scenario === 'manual-send' ? 'expand-history' : 'send-now', [resident]).next!;
    const operationId = activated.sendOperation?.requestId;
    function Harness() {
      const [shown, setShown] = useState(true);
      const [draft, setDraft] = useState<Draft | null>(activated);
      current = draft; visible = setShown; changeDraft = setDraft;
      return shown ? <ResidentDetailAndDraft client={client} snapshot={snapshot} busy={false}
        draftState={draft} onDraftStateChange={setDraft} onApplyIntent={async () => {}} sessionFactory={factory} /> : null;
    }
    const root = createRoot(document.getElementById('root')!);
    try {
      await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
      if (scenario === 'manual-send') {
        assert.equal(calls.length, 0, 'expanding history sent a message');
        await act(async () => { document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
      }
      assert.equal(calls.length, scenario === 'hide-before-ready' ? 0 : 1);
      if (operationId && calls[0]) assert.equal(calls[0].requestId, operationId);
      await act(async () => { visible(false); });
      const dispatchOwner = sessions.find((session) => session.sends > 0);
      if (dispatchOwner) assert.equal(dispatchOwner.disposed, false);
      if (scenario === 'edit-while-hidden') await act(async () => { changeDraft((draft) => editZeroSideEffectDraftText(draft!, '下一条草稿')); });
      if (scenario === 'replace-draft') await act(async () => { changeDraft(createZeroSideEffectDraftState(resident, '你好')); });
      if (scenario === 'rejected-while-hidden') await act(async () => { gate.reject(new Error('unknown delivery outcome')); });
      else if (scenario !== 'pending-remount' && scenario !== 'manual-send') await act(async () => { gate.resolve(); });
      if (scenario === 'hide-before-ready') await act(async () => { ready.resolve(); });
      await act(async () => { visible(true); });
      assert.equal(calls.length, 1, 'remount replayed the operation with a second send');
      if (scenario === 'pending-remount' || scenario === 'manual-send') await act(async () => { gate.resolve(); });
      assert.equal(calls.length, 1);
      const expected = scenario === 'edit-while-hidden' ? '下一条草稿' : ['rejected-while-hidden', 'replace-draft'].includes(scenario) ? '你好' : '';
      assert.equal((current as Draft | null)?.text, expected);
      assert.equal((current as Draft | null)?.sendOperation, null);
      if (scenario === 'rejected-while-hidden') assert.match(document.body.textContent!, /消息未获确认/);
    } finally {
      await act(async () => { ready.resolve(); gate.resolve(); root.unmount(); });
    }
    assert.ok(sessions.every((owner) => owner.disposed), 'session leaked after completion and unmount');
  });
}

test('Bootstrap failure settles sendOperation, preserves draft text, and reconnects without auto-resending', async () => {
  let failBootstrap = true;
  const calls: { requestId: string; parts: unknown }[] = [];
  const sessions: { disposed: boolean }[] = [];
  const factory = () => {
    const owner = { disposed: false };
    sessions.push(owner);
    return {
      getState: () => ({ status: 'ready', messages: [], activeTurnId: null, error: null }),
      observe: () => () => {},
      loadReferences: async () => {
        if (failBootstrap) throw new Error('home offline');
      },
      selectReference: async () => {},
      send: async (req: { requestId: string; parts: unknown }) => { calls.push(req); },
      dispose: async () => { owner.disposed = true; },
    } as unknown as AppConversationEntrySession;
  };

  let visible!: (value: boolean) => void;
  let current: Draft | null = null;
  const activated = activateFormalSessionFromDraft(createZeroSideEffectDraftState(resident, '保留我的草稿'), 'send-now', [resident]).next!;
  function Harness() {
    const [shown, setShown] = useState(true);
    const [draft, setDraft] = useState<Draft | null>(activated);
    current = draft;
    visible = setShown;
    return shown ? (
      <ResidentDetailAndDraft
        client={client}
        snapshot={snapshot}
        busy={false}
        draftState={draft}
        onDraftStateChange={setDraft}
        onApplyIntent={async () => {}}
        sessionFactory={factory}
      />
    ) : null;
  }

  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
    assert.equal(calls.length, 0);
    assert.equal((current as Draft | null)?.text, '保留我的草稿');
    assert.equal((current as Draft | null)?.sendOperation, null, 'bootstrap failure must settle sendOperation');
    assert.doesNotMatch(document.body.textContent!, /发送中…/, 'button must not stay stuck in sending state');

    // Remounting after recovery must NOT auto-fire the previously failed sendOperation
    failBootstrap = false;
    await act(async () => { visible(false); });
    await act(async () => { visible(true); });
    assert.equal(calls.length, 0, 'remount after bootstrap failure must not auto-send');

    // Explicit submit now succeeds cleanly once
    await act(async () => {
      document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(calls.length, 1);
    assert.equal((current as Draft | null)?.text, '');
  } finally {
    await act(async () => { root.unmount(); });
  }
  assert.ok(sessions.every((owner) => owner.disposed));
});

test('Non-throwing Kit session failed/stale state settles sendOperation, hides false ready text, and exposes retry button', async () => {
  let mode: 'failed' | 'stale' | 'ready' = 'failed';
  const calls: { requestId: string; parts: unknown }[] = [];
  const sessions: { disposed: boolean }[] = [];

  const factory = () => {
    const owner = { disposed: false };
    sessions.push(owner);
    let currentState = {
      status: 'loading' as 'loading' | 'failed' | 'stale' | 'ready',
      messages: [],
      activeTurnId: null,
      error: null as string | null,
    };
    const listeners = new Set<(s: typeof currentState) => void>();
    const publish = (next: typeof currentState) => {
      currentState = next;
      for (const fn of listeners) fn(currentState);
    };
    return {
      getState: () => currentState,
      observe: (fn: (s: typeof currentState) => void) => {
        listeners.add(fn);
        return () => { listeners.delete(fn); };
      },
      loadReferences: async () => {
        if (mode === 'failed') {
          // Real Kit behavior: resolves normally while publishing failed state!
          publish({ status: 'failed', messages: [], activeTurnId: null, error: '无法读取伙伴会话引用' });
        }
      },
      selectReference: async () => {
        if (mode === 'stale') {
          publish({ status: 'stale', messages: [], activeTurnId: null, error: '伙伴引用已过期，请刷新' });
          return;
        }
        publish({ status: 'ready', messages: [], activeTurnId: null, error: null });
      },
      send: async (req: { requestId: string; parts: unknown }) => { calls.push(req); },
      dispose: async () => { owner.disposed = true; },
    } as unknown as AppConversationEntrySession;
  };

  let current: Draft | null = null;
  const activated = activateFormalSessionFromDraft(
    createZeroSideEffectDraftState(resident, '你好呀'),
    'send-now',
    [resident],
  ).next!;

  function Harness() {
    const [draft, setDraft] = useState<Draft | null>(activated);
    current = draft;
    return (
      <ResidentDetailAndDraft
        client={client}
        snapshot={snapshot}
        busy={false}
        draftState={draft}
        onDraftStateChange={setDraft}
        onApplyIntent={async () => {}}
        sessionFactory={factory}
      />
    );
  }

  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
    assert.equal(calls.length, 0);
    assert.equal((current as Draft | null)?.sendOperation, null, 'failed session state must settle pending sendOperation');
    assert.equal((current as Draft | null)?.text, '你好呀');
    assert.doesNotMatch(document.body.textContent!, /正式对话已连接/);
    assert.match(document.body.textContent!, /对话未就绪，可点击上方重试/);

    const retryBtn1 = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('重试连接'));
    assert.ok(retryBtn1, 'failed non-throwing session must render 重试连接 button');

    // Switch to 'stale' on selectReference and click retry
    mode = 'stale';
    await act(async () => { retryBtn1.click(); });
    assert.doesNotMatch(document.body.textContent!, /正式对话已连接/);
    const retryBtn2 = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('重试连接'));
    assert.ok(retryBtn2, 'stale non-throwing session must also render 重试连接 button');

    // Switch to 'ready' and click retry -> now connects cleanly!
    mode = 'ready';
    await act(async () => { retryBtn2.click(); });
    assert.match(document.body.textContent!, /正式对话已连接/);
  } finally {
    await act(async () => { root.unmount(); });
  }
  assert.ok(sessions.every((owner) => owner.disposed));
});

test('HorizonTopBar inline quick-dial confirmation and RelocationAndPackDrawer verified-usage guard & timezone disclosure', async () => {
  const { default: fs } = await import('node:fs/promises');
  const { default: path } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { validateUtopiaBundleParts, parseAndValidateUtopiaZip } = await import('../src/domain/bundle-validator.js');

  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const seasideDir = path.resolve(testDir, '../public/builtin-packs/seaside-island');
  const rawManifest = JSON.parse(await fs.readFile(path.join(seasideDir, 'manifest.json'), 'utf8'));
  const rawHabitat = JSON.parse(await fs.readFile(path.join(seasideDir, 'habitat.json'), 'utf8'));
  const rawStage = JSON.parse(await fs.readFile(path.join(seasideDir, 'stage.json'), 'utf8'));
  const rawAssets = new Map<string, Uint8Array>();
  for (const name of await fs.readdir(path.join(seasideDir, 'assets'))) {
    rawAssets.set(`assets/${name}`, new Uint8Array(await fs.readFile(path.join(seasideDir, 'assets', name))));
  }
  const validatedSeaside = await validateUtopiaBundleParts({
    rawManifest,
    rawHabitat,
    rawStage,
    rawAssets,
    allowBuiltinNamespace: true,
  });
  const seasidePack = {
    source: 'builtin' as const,
    slug: 'seaside-island',
    manifest: validatedSeaside.manifest,
    habitat: validatedSeaside.habitat,
    stage: validatedSeaside.stage,
    contentDigest: validatedSeaside.contentDigest,
    installedAt: 'builtin',
    assetRoot: null,
    assetPaths: Array.from(validatedSeaside.assets.keys()),
  };

  const sampleBytes = new Uint8Array(await fs.readFile(path.resolve(testDir, '../public/samples/creator.autumn-farm.utopia')));
  const validatedSample = await parseAndValidateUtopiaZip(sampleBytes);
  const importedPack = {
    source: 'imported' as const,
    manifest: validatedSample.manifest,
    habitat: validatedSample.habitat,
    stage: validatedSample.stage,
    contentDigest: validatedSample.contentDigest,
    installedAt: '2026-11-15T09:00:00Z',
    assetRoot: 'bundles/content/00000000-0000-4000-8000-000000000001',
    assetPaths: Array.from(validatedSample.assets.keys()),
  };

  const tidePool = seasidePack.habitat.places.find((p) => p.openWhen.length > 0)!;
  const activeCompanion = {
    agentHandle: 'agent-tide' as NimiUtopiaResident['agentHandle'],
    displayName: '阿潮',
    solitary: false,
    current: {
      activityRef: 'act-tide',
      kind: 'explore',
      summary: '观察寄居蟹',
      placeId: tidePool.id,
      progress: 40,
      interaction: false,
    },
  } as unknown as NimiUtopiaResident;

  const utcSnapshot = {
    revision: 'rev-utc',
    observedAt: { seconds: '1794744600', nanos: 0 },
    habitatActivationId: 'act-utc',
    contentDigest: seasidePack.contentDigest,
    timezone: 'UTC',
    publicParticipation: true,
    habitat: seasidePack.habitat,
    parameterValues: {
      ...Object.fromEntries(seasidePack.habitat.parameters.map((p) => [p.key, p.defaultValue])),
      tide: 'low-tide',
    },
    openPlaceIds: seasidePack.habitat.places.map((p) => p.id),
    activeEvents: [],
    residents: [activeCompanion],
    occupancy: [{ placeId: tidePool.id, agentHandles: [activeCompanion.agentHandle] }],
    sharedActivities: [],
  } as unknown as NimiUtopiaSnapshot;

  const quickCalls: Array<{ key: string; value: string }> = [];
  const relocateIntents: unknown[] = [];

  const stubStorage = {
    json: {
      readJson: async () => ({
        value: {
          schemaVersion: '2.0',
          bundles: [
            {
              manifest: importedPack.manifest,
              habitat: importedPack.habitat,
              stage: importedPack.stage,
              contentDigest: importedPack.contentDigest,
              installedAt: importedPack.installedAt,
              assetRoot: importedPack.assetRoot,
              assetPaths: importedPack.assetPaths,
            },
          ],
        },
        sizeBytes: 128,
      }) as never,
      writeJson: async () => ({ value: null, sizeBytes: 4 }) as never,
    },
    assets: {
      list: async () => ({ assets: [], nextCursor: '' }),
      read: async () => ({ asset: {} as never, range: { offset: 0, length: 0, totalSize: 0 }, body: new Uint8Array(0) }) as never,
      write: async () => ({}) as never,
      move: async () => ({}) as never,
      remove: async () => ({ removed: true }),
    },
  };

  const root = createRoot(document.getElementById('root')!);
  try {
    // 1. HorizonTopBar warning pill requires inline confirmation before firing onQuickCycleParameter
    await act(async () => {
      root.render(
        <StrictMode>
          <HorizonTopBar
            snapshot={utcSnapshot}
            daypart="day"
            nowMs={1794744600_000}
            frozen={false}
            audioMuted={true}
            hasAudioTrack={false}
            sidebarCollapsed={false}
            onQuickCycleParameter={(key, value) => quickCalls.push({ key, value })}
            onToggleAudioMute={() => {}}
            onOpenTuner={() => {}}
            onOpenPackLibrary={() => {}}
            onToggleSidebar={() => {}}
            onRetryRefresh={() => {}}
          />
        </StrictMode>,
      );
    });
    const warnPill = document.querySelector<HTMLButtonElement>('.utopia-horizon-pill.has-impact-warn');
    assert.ok(warnPill, 'Quick-dial pill with companion interruption must render warning badge');
    assert.match(warnPill.textContent ?? '', /将打断1人/);
    await act(async () => { warnPill.click(); });
    assert.equal(quickCalls.length, 0, 'Clicking warning pill must open inline confirmation before mutating');
    assert.match(document.body.textContent ?? '', /中断 阿潮 当前活动/);
    const confirmBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('确认切换'));
    assert.ok(confirmBtn);
    await act(async () => { confirmBtn.click(); });
    assert.deepEqual(quickCalls, [{ key: 'tide', value: 'high-tide' }]);

    // 2. RelocationAndPackDrawer disables removal when snapshot is null
    await act(async () => {
      root.render(
        <StrictMode>
          <RelocationAndPackDrawer
            open={true}
            onClose={() => {}}
            snapshot={null}
            packs={[seasidePack, importedPack]}
            previewUrls={{}}
            storagePort={stubStorage}
            busy={false}
            onPacksChanged={async () => {}}
            onExecuteRelocation={async () => true}
          />
        </StrictMode>,
      );
    });
    const removeWithoutSnapBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === '移除');
    assert.ok(removeWithoutSnapBtn, 'Imported pack card must render 移除 button');
    assert.equal(removeWithoutSnapBtn.disabled, true, '移除 button must be disabled when snapshot is unavailable');
    assert.equal(removeWithoutSnapBtn.getAttribute('title'), '连接住地并确认使用状态后方可移除本地包');

    // 3. RelocationAndPackDrawer visibly discloses UTC -> local timezone update and respects unchecking
    const originalDtf = Intl.DateTimeFormat;
    Intl.DateTimeFormat = Object.assign(
      function (...args: Parameters<typeof originalDtf>) {
        const inst = new originalDtf(...args);
        if (!args[1]?.timeZone) {
          const baseOpts = inst.resolvedOptions();
          return Object.assign(inst, {
            resolvedOptions: () => ({ ...baseOpts, timeZone: 'Asia/Shanghai' }),
          });
        }
        return inst;
      },
      { supportedLocalesOf: originalDtf.supportedLocalesOf },
    ) as unknown as typeof Intl.DateTimeFormat;

    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <RelocationAndPackDrawer
              open={true}
              onClose={() => {}}
              snapshot={utcSnapshot}
              packs={[seasidePack, importedPack]}
              previewUrls={{}}
              storagePort={stubStorage}
              busy={false}
              onPacksChanged={async () => {}}
              onExecuteRelocation={async (intent) => {
                relocateIntents.push(intent);
                return false;
              }}
            />
          </StrictMode>,
        );
      });
      const prepareBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === '展卷迁居');
      assert.ok(prepareBtn, 'Non-active pack card must render relocation trigger');
      await act(async () => { prepareBtn.click(); });
      assert.match(document.body.textContent ?? '', /同步将账户住地时区从 UTC 更新为本机时区/);
      const tzCheckbox = document.body.querySelector<HTMLInputElement>('.utopia-relocate-tz-option input[type="checkbox"]');
      assert.ok(tzCheckbox);
      assert.equal(tzCheckbox.checked, true);

      const confirmRelocateBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('确认迁入此洞天'));
      assert.ok(confirmRelocateBtn);
      await act(async () => {
        confirmRelocateBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert.equal((relocateIntents[0] as { timezone?: string }).timezone, 'Asia/Shanghai');

      await act(async () => { tzCheckbox.click(); });
      assert.equal(tzCheckbox.checked, false);
      await act(async () => {
        confirmRelocateBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      assert.equal('timezone' in (relocateIntents[1] as Record<string, unknown>), false);
    } finally {
      Intl.DateTimeFormat = originalDtf;
    }
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test.after(() => { dom.window.close(); });
