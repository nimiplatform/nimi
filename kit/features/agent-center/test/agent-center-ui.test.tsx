import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { AgentCenterBehaviorSection } from '../src/components/AgentCenterBehaviorSection.js';
import { AgentCenterAppearanceSection } from '../src/components/AgentCenterAppearanceSection.js';
import type { AgentCenterHostMechanics } from '../src/types.js';
import { sessionFor } from './session-fixture.js';
import { TestResourcePackTargetController } from './resource-pack-target-fixture.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(element: ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openTextCapability(node: HTMLElement): Promise<void> {
  const capability = node.querySelector(
    '[data-nimi-model-config-capability="text.generate"]',
  ) as HTMLButtonElement;
  expect(capability).toBeTruthy();
  await act(async () => { capability.click(); await Promise.resolve(); });
  await flush();
}

async function chooseLocalIntent(node: HTMLElement): Promise<void> {
  const trigger = node.querySelector(
    '[data-testid="model-config-model-trigger:text.generate"]',
  ) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.click(); await Promise.resolve(); });
  await flush();
  const local = document.body.querySelector(
    '[data-nimi-model-picker-source="local"]',
  ) as HTMLButtonElement;
  expect(local).toBeTruthy();
  act(() => { local.click(); });
  const confirm = Array.from(document.body.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === 'Use this target') as HTMLButtonElement;
  expect(confirm).toBeTruthy();
  await act(async () => { confirm.click(); await Promise.resolve(); });
  await flush();
}

async function selectField(node: HTMLElement, ariaLabel: string, optionLabel: string): Promise<void> {
  const trigger = node.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.click(); await Promise.resolve(); });
  await flush();
  const option = Array.from(document.body.querySelectorAll('[role="option"]'))
    .find((entry) => entry.textContent?.includes(optionLabel)) as HTMLElement;
  expect(option).toBeTruthy();
  await act(async () => { option.click(); await Promise.resolve(); });
  await flush();
}

describe('AgentCenter UI session contract', () => {
  it('keeps the mounted editor and its unsaved draft across an unchanged-owner refresh', async () => {
    const session = await sessionFor();
    try {
      const node = render(<AgentCenter session={session} defaultSection="behavior" />);
      await flush();
      const input = node.querySelector('input[type="number"]') as HTMLInputElement;
      expect(input).toBeTruthy();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => { setter.call(input, '4'); input.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(input.value).toBe('4');
      await act(async () => { await session.refresh(); });
      expect(node.querySelector('input[type="number"]')).toBe(input);
      expect(input.value).toBe('4');
      expect(node.querySelector('[data-agent-center-loading]')).toBeNull();
      expect(session.getSnapshot().state.autonomy.maxFreeContactsPerDay).toBe(3);
    } finally {
      session.dispose();
    }
  });
  it('allows discarding a local edit when another window saved the same value', async () => {
    const session = await sessionFor({ autonomy: { freeContactEnabled:false, quietHours:null, maxFreeContactsPerDay:3,
      revision:'a1', enabled:true, mode:'low', budgetExhausted:false, usedTokensInWindow:0, dailyTokenBudget:100,
      maxBackgroundOutputTokens:10, windowStartedAt:null, suspendedUntil:null } });
    const snapshot = session.getSnapshot();
    const node = render(<AgentCenterBehaviorSection session={session} snapshot={snapshot} />);
    const input = node.querySelector('input[type="number"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, '4'); input.dispatchEvent(new Event('input', { bubbles:true })); });
    act(() => { root!.render(<AgentCenterBehaviorSection session={session} snapshot={{ ...snapshot, state: { ...snapshot.state,
      autonomy: { ...snapshot.state.autonomy, revision:'a2', maxFreeContactsPerDay:4 } } }} />); });
    const discard = Array.from(node.querySelectorAll('button')).find(button => button.textContent?.includes('Discard changes'))!;
    expect(discard.disabled).toBe(false);
    act(() => discard.click());
    expect(node.textContent).not.toContain('Settings changed elsewhere');
  });
  it('renders from the Manager Session and exposes only UI composition props', async () => {
    const intent = {
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local' as const, local: {} },
      requiredFeatures: [] as string[],
    };
    const session = await sessionFor({
      sharedAIConfig: {
        aiConfig: {
          owner: {
            owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
          },
          capabilities: [intent],
        },
        revision: '1',
        intents: [{ capability: 'text.generate', route: 'local', requiredFeatures: [] }],
      },
    });
    const node = render(
      <AgentCenter
        chrome="standalone"
        identity={{ displayName: 'Nimi', avatarFallback: 'N' }}
        session={session}
      />,
    );
    await flush();
    const surface = node.querySelector('[data-chat-agent-center="true"]') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.className).toContain('h-full');
    expect(surface.className).toContain('flex-col');
    const panel = node.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel.className).toContain('flex-1');
    expect(panel.className).toContain('overflow-y-auto');
    expect(node.textContent).toContain('Nimi');
  });

  it('uses controlled active-section and placement callbacks', async () => {
    const session = await sessionFor();
    let closed = 0;
    const node = render(
      <AgentCenter
        activeSection="cognition"
        placementActions={{ close: () => { closed += 1; } }}
        session={session}
      />,
    );
    await flush();
    expect(node.querySelector('#agent-center-panel-cognition')).not.toBeNull();
    const close = node.querySelector('button[aria-label="Close Agent Center"]');
    act(() => (close as HTMLButtonElement).click());
    expect(closed).toBe(1);
  });

  it('exposes bounded Memory pagination with localized pending and error states', async () => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome: 'ready',
        enabled: true,
        adoptionRequired: false,
        items: [{
          memoryId: 'memory-page-1',
          content: 'First bounded page',
          epistemicStatus: 'explicit',
          lifecycle: 'current',
          occurredAt: '2026-08-27T10:00:00Z',
          updatedAt: '2026-08-27T10:00:00Z',
          sourceExplanation: 'Committed user message',
        }],
        currentCount: 2,
        supersededCount: 0,
        forgottenCount: 0,
        nextPageToken: 'opaque-page-2',
      },
    });
    let rejectPage: ((reason?: unknown) => void) | undefined;
    const pendingPage = new Promise<never>((_resolve, reject) => { rejectPage = reject; });
    const loadMore = vi.spyOn(session, 'loadMoreMemory').mockReturnValue(pendingPage);
    const node = render(<AgentCenter activeSection="cognition" session={session} />);
    await flush();

    const button = node.querySelector('[data-agent-center-memory-load-more="true"]') as HTMLButtonElement;
    expect(button.textContent).toContain('Load more');
    act(() => button.click());
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Loading more');

    rejectPage?.(new Error('page owner unavailable'));
    await flush();
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Could not load more Memory. page owner unavailable');
  });

  it('keeps delete-all reachable when the bounded page is empty but owner counts remain', async () => {
    const session = await sessionFor({
      cognitionMemory: {
        outcome: 'ready', enabled: true, adoptionRequired: false, items: [],
        currentCount: 0, supersededCount: 0, forgottenCount: 1, nextPageToken: null,
      },
    });
    const node = render(<AgentCenter activeSection="cognition" session={session} />);
    await flush();
    const deleteAll = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Delete all Memory') as HTMLButtonElement;
    expect(deleteAll).toBeTruthy();
    expect(deleteAll.disabled).toBe(false);
  });

  it('keeps Behavior state visible but routes unavailable owner actions to the Runtime surface', async () => {
    const session = await sessionFor({ runtimeError: 'LOCAL_APP_ACCESS_DENIED' });
    let opened = 0;
    const node = render(
      <AgentCenter
        activeSection="behavior"
        placementActions={{ openRuntimeSettings: () => { opened += 1; } }}
        session={session}
      />,
    );
    await flush();

    const handoff = node.querySelector(
      '[data-agent-center-next-step-action="openRuntimeSettings"]',
    ) as HTMLButtonElement;
    expect(handoff).toBeTruthy();
    act(() => handoff.click());
    expect(opened).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      phase: 'degraded',
      state: { autonomy: { revision: '1', enabled: false } },
      availability: { updateAutonomy: { state: 'unavailable', reason: 'owner-rejected' } },
    });
  });

  it('uses the canonical i18n seam without copy-object props', async () => {
    const session = await sessionFor();
    const node = render(
      <AgentCenter
        i18n={{
          language: 'en',
          t(key) { return key === 'AgentCenter.cognition.title' ? 'Mind projection' : key; },
        }}
        activeSection="cognition"
        session={session}
      />,
    );
    await flush();
    expect(node.textContent).toContain('Mind projection');
  });

  it('routes section changes without exposing a carrier distinction', async () => {
    const session = await sessionFor();
    const changes: string[] = [];
    const node = render(<AgentCenter onSectionChange={(section) => changes.push(section)} session={session} />);
    await flush();
    const behavior = node.querySelector('[data-testid="chat-agent-center-section:behavior"]') as HTMLButtonElement;
    act(() => behavior.click());
    expect(changes).toEqual(['behavior']);
    expect(node.querySelector('#agent-center-panel-behavior')).not.toBeNull();
    expect(node.innerHTML).not.toMatch(/carrier|permission-posture|posture-group/u);
  });

  it('roams section tabs with arrow keys using roving tabindex', async () => {
    const session = await sessionFor();
    const node = render(<AgentCenter session={session} />);
    await flush();
    const overview = node.querySelector('#agent-center-tab-overview') as HTMLButtonElement;
    expect(overview).toBeTruthy();
    act(() => { overview.focus(); });
    act(() => {
      overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    const appearance = node.querySelector('#agent-center-tab-appearance') as HTMLButtonElement;
    expect(document.activeElement).toBe(appearance);
    expect(appearance.tabIndex).toBe(0);
    expect(overview.tabIndex).toBe(-1);
    expect(node.querySelector('#agent-center-panel-appearance')).not.toBeNull();
    act(() => {
      appearance.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(overview);
    expect(node.querySelector('#agent-center-panel-overview')).not.toBeNull();
  });

  it('renders AIConfig, behavior, and appearance sections through session-owned state', async () => {
    const session = await sessionFor({
      autonomy: { freeContactEnabled:false,quietHours:null,maxFreeContactsPerDay:3,
        revision: 'a1', enabled: true, mode: 'low', budgetExhausted: false,
        usedTokensInWindow: 1, dailyTokenBudget: 100, maxBackgroundOutputTokens: 10,
        windowStartedAt: null, suspendedUntil: null,
      },
      appearance: { status: 'not_configured', presentationRevision: 'p1' },
    });
    for (const section of ['ai-config', 'behavior', 'appearance'] as const) {
      const node = render(<AgentCenter activeSection={section} chrome="embedded" session={session} />);
      await flush();
      expect(node.querySelector(`#agent-center-panel-${section}`)).not.toBeNull();
      act(() => root?.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('explicit activity refresh also refreshes canonical usage without a duplicate initial Manager read', async () => {
    const session = await sessionFor();
    const refresh = vi.spyOn(session, 'refresh').mockResolvedValue(undefined);
    const node = render(<AgentCenter activeSection="behavior" session={session} />);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1); // AgentCenter owns the initial Manager read.
    await act(async () => {
      const button = Array.from(node.querySelectorAll('button')).find(item => item.textContent === 'Refresh');
      expect(button).toBeTruthy();
      button?.click();
      await flush();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('routes the background picker through the existing canonical appearance action', async () => {
    let backgroundSelections = 0;
    const session = await sessionFor({}, {
      async selectBackground() {
        backgroundSelections += 1;
        return {
          intent: { backgroundAssetReference: 'asset://background/selected' },
          importedAssets: [{
            role: 'background',
            fileName: 'selected.png',
            mediaType: 'image/png',
            content: Uint8Array.from([1, 2, 3]),
            sha256: 'b'.repeat(64),
          }],
        };
      },
    });
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();

    const chooseBackground = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Choose background image') as HTMLButtonElement;
    expect(chooseBackground).toBeTruthy();
    act(() => chooseBackground.click());
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Choose file and replace') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    await act(async () => { confirm.click(); await Promise.resolve(); });
    await flush();

    expect(backgroundSelections).toBe(1);
    expect(session.getSnapshot().state.appearance.backgroundRef).toBe('asset://background/selected');
  });

  it.each([true, false])('restores a successful appearance save with preview running=%s and fences concurrent writes', async (previewRunning) => {
    let releaseSelection: (() => void) | undefined;
    const selectionGate = new Promise<void>((resolve) => { releaseSelection = resolve; });
    const selectAvatar = vi.fn<NonNullable<AgentCenterHostMechanics['selectAvatar']>>(async (kind) => {
      await selectionGate;
      return {
        intent: { backendKind: kind, avatarAssetReference: 'avatar:replacement' },
        importedAssets: [{
          role: 'avatar', fileName: 'replacement.zip', mediaType: 'application/zip',
          content: Uint8Array.from([1, 2, 3]), sha256: 'a'.repeat(64),
        }],
      };
    });
    const selectBackground = vi.fn<NonNullable<AgentCenterHostMechanics['selectBackground']>>(async () => ({
      intent: { backgroundAssetReference: 'background:replacement' },
      importedAssets: [{
        role: 'background', fileName: 'replacement.png', mediaType: 'image/png',
        content: Uint8Array.from([4, 5, 6]), sha256: 'b'.repeat(64),
      }],
    }));
    const hostMechanics: AgentCenterHostMechanics = {
      selectAvatar,
      selectBackground,
      ...(previewRunning ? {
        resolveCommittedPreview: async (input) => ({
          state: 'ready', tier: 'avatar_preview_service',
          backendKind: input.backendKind, avatarAssetRef: input.avatarAssetRef,
          previewMaterialRef: `material:${input.avatarAssetRef}`,
          previewImageRef: '/__nimi/avatar-preview/current.png', warnings: [],
        }),
      } satisfies Pick<AgentCenterHostMechanics, 'resolveCommittedPreview'> : {}),
    };
    const session = await sessionFor({
      appearance: {
        status: 'ready', presentationRevision: '3', backendKind: 'vrm',
        avatarAssetRef: 'avatar:original', avatarAssetValid: true,
        defaultVoiceReference: 'preset_voice_id:original',
        previousSelection: { backendKind: 'live2d', avatarAssetReference: 'avatar:older' },
      },
    }, hostMechanics);
    const restoreCalls = vi.spyOn(session, 'restorePreviousAppearance');
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    const button = (label: string): HTMLButtonElement => {
      const found = Array.from(node.querySelectorAll('button'))
        .find((entry) => entry.textContent?.trim() === label);
      expect(found, label).toBeTruthy();
      return found!;
    };
    const assertWritesDisabled = () => {
      for (const label of [
        'Choose Live2D package', 'Choose VRM file', 'Choose background image',
        'Restore previous appearance', 'Clear voice selection',
      ]) {
        expect(button(label).disabled, label).toBe(true);
      }
      expect((node.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    };
    try {
      expect(button('Restore previous appearance').disabled).toBe(false);
      expect(button('Clear voice selection').disabled).toBe(false);
      act(() => { button('Choose Live2D package').click(); });
      const confirm = Array.from(document.body.querySelectorAll('button'))
        .find((entry) => entry.textContent?.trim() === 'Choose file and replace')!;
      act(() => { confirm.click(); confirm.click(); });
      await flush();
      expect(selectAvatar).toHaveBeenCalledTimes(1);
      assertWritesDisabled();
      act(() => { button('Restore previous appearance').click(); });
      expect(restoreCalls).not.toHaveBeenCalled();

      await act(async () => { releaseSelection?.(); });
      await flush();
      expect(session.getSnapshot().state.appearance).toMatchObject({
        avatarAssetRef: 'avatar:replacement', backendKind: 'live2d', presentationRevision: '4',
        previousSelection: { avatarAssetReference: 'avatar:original', backendKind: 'vrm' },
      });
      expect(node.querySelector('[data-agent-center-appearance-operation="saved"]')).toBeTruthy();
      if (!previewRunning) expect(node.textContent).toContain('No embedded preview is running.');
      const restore = button('Restore previous appearance');
      expect(restore.disabled).toBe(false);
      act(() => { restore.click(); restore.click(); });
      expect(restoreCalls).toHaveBeenCalledTimes(1);
      assertWritesDisabled();
      act(() => {
        button('Choose VRM file').click();
        button('Choose background image').click();
        button('Clear voice selection').click();
        (node.querySelector('[role="switch"]') as HTMLButtonElement).click();
      });
      expect(selectAvatar).toHaveBeenCalledTimes(1);
      expect(selectBackground).not.toHaveBeenCalled();
      await flush();
      expect(session.getSnapshot().state.appearance).toMatchObject({
        avatarAssetRef: 'avatar:original', backendKind: 'vrm', presentationRevision: '5',
        defaultVoiceReference: 'preset_voice_id:original', avatarAutoplay: false,
      });
      expect(node.querySelector('[data-agent-center-appearance-operation="restored"]')).toBeTruthy();
      expect(button('Choose VRM file').disabled).toBe(false);
    } finally {
      releaseSelection?.();
      restoreCalls.mockRestore();
    }
  });

  it('allows explicit restore with preview-not-running display metadata and a real Session', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'ready', presentationRevision: '4', backendKind: 'live2d',
        avatarAssetRef: 'avatar:replacement', avatarAssetValid: true,
        previousSelection: { backendKind: 'vrm', avatarAssetReference: 'avatar:original' },
      },
    });
    const snapshot = session.getSnapshot();
    // Exercise the section's typed display boundary. Availability and the
    // restore mutation still come from the actual nominal Session.
    const node = render(<AgentCenterAppearanceSection session={session} snapshot={{
      ...snapshot,
      state: {
        ...snapshot.state,
        appearance: {
          ...snapshot.state.appearance,
          renderState: 'unavailable', renderUnavailableReasonCode: 'preview-not-running',
        },
      },
    }} />);
    expect(node.textContent).toContain('No embedded preview is running.');
    const restore = Array.from(node.querySelectorAll('button'))
      .find((entry) => entry.textContent?.trim() === 'Restore previous appearance')!;
    expect(restore).toBeTruthy();
    expect(restore.disabled).toBe(false);
    await act(async () => { restore.click(); });
    await flush();
    expect(session.getSnapshot().state.appearance).toMatchObject({
      backendKind: 'vrm', avatarAssetRef: 'avatar:original', presentationRevision: '5',
    });
    expect(node.querySelector('[data-agent-center-appearance-operation="restored"]')).toBeTruthy();
  });

  it('renders the shared Resource Pack card on a non-Zhiyu mount and routes only its placement entry', async () => {
    let placements = 0;
    const session = await sessionFor({}, undefined, undefined, undefined, {
      availability: { state: 'available', reasonCode: null, actionHint: null },
      async open() {
        placements += 1;
        return {
          status: 'unavailable',
          reasonCode: 'target-app-unavailable',
          actionHint: 'start_zhiyu_and_retry',
        };
      },
    });
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();

    const card = node.querySelector('[data-agent-center-resource-pack-card="true"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Partner resource pack');
    expect(card.textContent).toContain('For Zhiyu · Surface V1');
    expect(card.textContent).toContain('Using the Zhiyu default experience');
    expect(card.querySelector('[data-agent-center-resource-pack-action="select"]')).toBeNull();
    expect(card.querySelector('[data-agent-center-resource-pack-action="apply"]')).toBeNull();
    const place = card.querySelector('[data-agent-center-resource-pack-action="place"]') as HTMLButtonElement;
    await act(async () => { place.click(); await Promise.resolve(); });
    await flush();
    expect(placements).toBe(1);
    expect(card.textContent).toContain('Start Zhiyu, then try opening the Resource Pack again.');
  });

  it('shows Apply only for a current target preview and cancels that review when Appearance unmounts', async () => {
    const controller = new TestResourcePackTargetController();
    const session = await sessionFor({}, {
      async selectResourcePack() {
        return {
          role: 'resource-pack',
          fileName: 'technical-pack-a.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([7, 8, 9]),
          sha256: 'c'.repeat(64),
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    const select = node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement;
    expect(select).toBeTruthy();
    expect(node.querySelector('[data-agent-center-resource-pack-action="apply"]')).toBeNull();

    await act(async () => { select.click(); await Promise.resolve(); });
    await flush();
    expect(node.querySelector('[data-agent-center-resource-pack-phase="preview"]')).toBeTruthy();
    expect(node.querySelector('[data-agent-center-resource-pack-action="apply"]')).toBeTruthy();
    expect(node.querySelector('[data-agent-center-resource-pack-action="cancel"]')).toBeTruthy();

    act(() => root?.unmount());
    root = null;
    expect(controller.calls).toContainEqual(['cancelPreview']);
  });

  it('fences a preview that finishes after the Appearance card unmounts', async () => {
    const controller = new TestResourcePackTargetController();
    let releasePreview: (() => void) | undefined;
    controller.beginPreviewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
    const session = await sessionFor({}, {
      async selectResourcePack() {
        return {
          role: 'resource-pack',
          fileName: 'late-preview.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([7, 8, 9]),
          sha256: 'c'.repeat(64),
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();

    act(() => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
    });
    while (!controller.calls.some((entry) => Array.isArray(entry) && entry[0] === 'beginPreview')) {
      await act(async () => { await Promise.resolve(); });
    }
    act(() => root?.unmount());
    root = null;
    await act(async () => {
      releasePreview?.();
      await Promise.resolve();
    });

    expect(controller.getSnapshot()).toMatchObject({ phase: 'default', reviewFileName: null });
  });

  it('returns keyboard focus to the persistent Resource Pack status after Cancel and Apply', async () => {
    const controller = new TestResourcePackTargetController();
    const session = await sessionFor({}, {
      async selectResourcePack() {
        return {
          role: 'resource-pack',
          fileName: 'technical-pack-a.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([7, 8, 9]),
          sha256: 'c'.repeat(64),
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    const status = node.querySelector('[data-agent-center-resource-pack-card="true"] [role="status"]') as HTMLElement;

    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();
    act(() => (node.querySelector('[data-agent-center-resource-pack-action="cancel"]') as HTMLButtonElement).click());
    expect(document.activeElement).toBe(status);

    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="apply"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();
    expect(document.activeElement).toBe(status);
  });

  it('disables sibling Appearance mutations while Resource Pack Apply is pending', async () => {
    const controller = new TestResourcePackTargetController();
    const session = await sessionFor({}, {
      async selectResourcePack() {
        return {
          role: 'resource-pack', fileName: 'pending.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([7, 8, 9]), sha256: 'c'.repeat(64),
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();
    act(() => { controller.prepareApply(); });
    await flush();

    for (const label of ['Choose Live2D package', 'Choose VRM file']) {
      const button = Array.from(node.querySelectorAll('button'))
        .find((entry) => entry.textContent?.trim() === label) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    }
    expect((node.querySelector('[data-agent-center-background-import="true"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables sibling Appearance mutations while Resource Pack Clear is in flight', async () => {
    const controller = new TestResourcePackTargetController();
    const session = await sessionFor({
      appearance: {
        status: 'not_configured',
        presentationRevision: '4',
        resourcePackSelection: {
          assetRef: 'pack_0123456789ab',
          targetId: 'zhiyu-experience-surface',
          targetVersion: 1,
        },
      },
    }, undefined, undefined, controller);
    let releaseClear: (() => void) | undefined;
    const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
    const pendingSession = {
      ...session,
      appearance: {
        ...session.appearance,
        clearResourcePack: async () => { await clearGate; },
      },
    } as typeof session;
    const node = render(<AgentCenter activeSection="appearance" session={pendingSession} />);
    await flush();

    act(() => {
      (node.querySelector('[data-agent-center-resource-pack-action="clear"]') as HTMLButtonElement).click();
    });
    await flush();

    for (const label of ['Choose Live2D package', 'Choose VRM file']) {
      const button = Array.from(node.querySelectorAll('button'))
        .find((entry) => entry.textContent?.trim() === label) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    }
    expect((node.querySelector('[data-agent-center-background-import="true"]') as HTMLButtonElement).disabled).toBe(true);

    releaseClear?.();
    await flush();
  });

  it('disables Resource Pack mutations while another Appearance save is in flight', async () => {
    const controller = new TestResourcePackTargetController();
    let releaseBackground: (() => void) | undefined;
    const backgroundGate = new Promise<void>((resolve) => { releaseBackground = resolve; });
    const session = await sessionFor({
      appearance: {
        status: 'not_configured',
        presentationRevision: '4',
        resourcePackSelection: {
          assetRef: 'pack_0123456789ab',
          targetId: 'zhiyu-experience-surface',
          targetVersion: 1,
        },
      },
    }, {
      async selectBackground() {
        await backgroundGate;
        return {
          intent: { backgroundAssetReference: 'asset://background/selected' },
          importedAssets: [{
            role: 'background', fileName: 'selected.png', mediaType: 'image/png',
            content: Uint8Array.from([1, 2, 3]), sha256: 'b'.repeat(64),
          }],
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();

    act(() => {
      (node.querySelector('[data-agent-center-background-import="true"]') as HTMLButtonElement).click();
    });
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Choose file and replace') as HTMLButtonElement;
    act(() => { confirm.click(); });
    await flush();

    expect((node.querySelector('[data-agent-center-resource-pack-action="clear"]') as HTMLButtonElement).disabled).toBe(true);

    releaseBackground?.();
    await flush();
  });

  it('clears Resource Pack busy and ignores late errors when the Agent session changes', async () => {
    const controllerA = new TestResourcePackTargetController();
    let rejectSelectionA: ((reason?: unknown) => void) | undefined;
    const selectionA = new Promise<never>((_resolve, reject) => { rejectSelectionA = reject; });
    const sessionA = await sessionFor({}, {
      selectResourcePack: () => selectionA,
      async selectBackground() {
        return {
          intent: { backgroundAssetReference: 'asset://background/a' },
          importedAssets: [{
            role: 'background', fileName: 'a.png', mediaType: 'image/png',
            content: Uint8Array.from([1]), sha256: 'a'.repeat(64),
          }],
        };
      },
    }, undefined, controllerA);
    const sessionB = await sessionFor({}, {
      async selectResourcePack() { return null; },
      async selectBackground() {
        return {
          intent: { backgroundAssetReference: 'asset://background/b' },
          importedAssets: [{
            role: 'background', fileName: 'b.png', mediaType: 'image/png',
            content: Uint8Array.from([2]), sha256: 'b'.repeat(64),
          }],
        };
      },
    }, undefined, new TestResourcePackTargetController());
    const node = render(<AgentCenter activeSection="appearance" session={sessionA} />);
    await flush();

    act(() => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
    });
    await flush();
    expect((node.querySelector('[data-agent-center-background-import="true"]') as HTMLButtonElement).disabled).toBe(true);

    act(() => { root?.render(<AgentCenter activeSection="appearance" session={sessionB} />); });
    await flush();
    expect((node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).disabled).toBe(false);
    expect((node.querySelector('[data-agent-center-background-import="true"]') as HTMLButtonElement).disabled).toBe(false);

    rejectSelectionA?.(new Error('Agent A picker failed late'));
    await flush();
    expect(node.textContent).not.toContain('Agent A picker failed late');
  });

  it('shows the current Resource Pack operation error alongside an existing fallback mismatch', async () => {
    const controller = new TestResourcePackTargetController();
    controller.renderFailure = new Error('Selected A cannot render.');
    const session = await sessionFor({
      appearance: {
        status: 'not_configured',
        presentationRevision: '4',
        resourcePackSelection: {
          assetRef: 'pack_0123456789ab',
          targetId: 'zhiyu-experience-surface',
          targetVersion: 1,
        },
      },
    }, {
      async selectResourcePack() {
        return {
          role: 'resource-pack', fileName: 'invalid-b.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([1, 2, 3]), sha256: 'invalid',
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();

    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();

    expect(node.textContent).toContain('selected Resource Pack is not rendering');
    expect(node.textContent).toContain('Agent Center Host returned invalid Resource Pack material.');
  });

  it('keeps an established Preview mounted across a background refresh', async () => {
    const controller = new TestResourcePackTargetController();
    const session = await sessionFor({}, {
      async selectResourcePack() {
        return {
          role: 'resource-pack', fileName: 'refresh-safe.nimipack',
          mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: Uint8Array.from([7, 8, 9]), sha256: 'c'.repeat(64),
        };
      },
    }, undefined, controller);
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    await act(async () => {
      (node.querySelector('[data-agent-center-resource-pack-action="select"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await flush();
    const cancels = controller.calls.filter((entry) => Array.isArray(entry) && entry[0] === 'cancelPreview').length;
    await act(async () => { await session.refresh(); });
    expect(node.querySelector('[data-agent-center-loading="true"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-resource-pack-phase="preview"]')).toBeTruthy();
    expect(controller.calls.filter((entry) => Array.isArray(entry) && entry[0] === 'cancelPreview')).toHaveLength(cancels);
  });

  it('keeps canonical selected state and Clear on the shared non-rendering card', async () => {
    const session = await sessionFor({
      appearance: {
        status: 'not_configured',
        presentationRevision: '4',
        resourcePackSelection: {
          assetRef: 'pack_0123456789ab',
          targetId: 'zhiyu-experience-surface',
          targetVersion: 1,
        },
      },
    });
    const node = render(<AgentCenter activeSection="appearance" session={session} />);
    await flush();
    expect(node.querySelector('[data-agent-center-resource-pack-selected="pack_0123456789ab"]')).toBeTruthy();
    const clear = node.querySelector('[data-agent-center-resource-pack-action="clear"]') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    await act(async () => { clear.click(); await Promise.resolve(); });
    await flush();
    expect(session.getSnapshot().state.appearance.resourcePackSelection).toBeNull();
    const status = node.querySelector('[data-agent-center-resource-pack-card="true"] [role="status"]') as HTMLElement;
    expect(status.textContent).toContain('Using the Zhiyu default experience');
    expect(document.activeElement).toBe(status);
  });

  it.each([
    { budget: null, enabled: true, progress: false },
    { budget: 0, enabled: true, progress: false },
    { budget: 100, enabled: false, progress: false },
    { budget: 100, enabled: true, progress: false },
  ])('does not invent a budget ratio for $budget tokens when enabled=$enabled', async ({ budget, enabled, progress }) => {
    const session = await sessionFor({ autonomy: { freeContactEnabled:false,quietHours:null,maxFreeContactsPerDay:3,
      revision: 'a1', enabled, mode: enabled ? 'low' : 'off', budgetExhausted: false,
      usedTokensInWindow: 25, dailyTokenBudget: 100, maxBackgroundOutputTokens: 10,
      windowStartedAt: null, suspendedUntil: null,
    } });
    const snapshot = session.getSnapshot();
    const node = render(<AgentCenterBehaviorSection session={session} snapshot={{
      ...snapshot, state: { ...snapshot.state, autonomy: { ...snapshot.state.autonomy, dailyTokenBudget: budget } },
    }} />);
    expect(Boolean(node.querySelector('[data-agent-center-budget-progress="true"]'))).toBe(progress);
    expect(node.textContent).not.toContain('/ 0 tokens');
    if (budget === null) expect(node.textContent).toContain('25 / —');
    if (budget === 100) expect(node.textContent).toContain('25 / 100');
  });

  it('rejects invalid budget numbers without sending a mutation', async () => {
    const session = await sessionFor({
      autonomy: { freeContactEnabled:false,quietHours:null,maxFreeContactsPerDay:3,
        revision: 'a1', enabled: true, mode: 'low', budgetExhausted: false,
        usedTokensInWindow: 1, dailyTokenBudget: 100, maxBackgroundOutputTokens: 10,
        windowStartedAt: null, suspendedUntil: null,
      },
    });
    const update = vi.spyOn(session, 'updateAutonomy').mockRejectedValue(new Error('invalid budget'));
    const node = render(<AgentCenter activeSection="behavior" session={session} />);
    await flush();

    const inputs = node.querySelectorAll('input[type="number"]');
    const daily = inputs[1] as HTMLInputElement;
    const perHook = inputs[2] as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(daily, '-1');
      daily.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(perHook, '1.5');
      perHook.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      node.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));
      await Promise.resolve();
    });

    expect(update).not.toHaveBeenCalled();
    expect(node.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('allows first-time configuration after Runtime reports canonical AIConfig absence', async () => {
    const session = await sessionFor({ sharedAIConfig: null });

    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    await chooseLocalIntent(node);
    const configure = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    expect(configure).toBeTruthy();
    expect(configure.disabled).toBe(false);
    expect(node.textContent).not.toContain('Runtime is offline');

    await act(async () => { configure.click(); await Promise.resolve(); });
    await flush();
    expect(session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities)
      .toEqual([expect.objectContaining({ capabilityContract: 'text.generate' })]);
  });

  it('writes a Local text.generate intent without exposing model targets', async () => {
    const session = await sessionFor();
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    expect(node.querySelector('[data-nimi-model-config-defaults="text.generate"]')).not.toBeNull();
    expect(node.textContent).toContain('Default parameters');
    await chooseLocalIntent(node);
    const configure = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    expect(configure).toBeTruthy();
    await act(async () => { configure.click(); await Promise.resolve(); });
    await flush();

    const config = session.getSnapshot().state.sharedAIConfig?.aiConfig;
    expect(config?.owner?.owner.oneofKind).toBe('runtimeLocalAgentSubsystem');
    expect(config?.capabilities).toEqual([expect.objectContaining({
      capabilityContract: 'text.generate',
      route: { oneofKind: 'local', local: {} },
    })]);
    expect(JSON.stringify(config)).not.toContain('targetRef');
  });

  it('saves an exact Cloud Connector and target without a second confirmation gate', async () => {
    const connector = {
      connectorRef: 'connector-1', label: 'Work account', provider: 'openai',
      state: 'ready' as const, reasons: [],
    };
    const target = {
      connectorRef: 'connector-1',
      label: 'gpt-test',
      capabilityContract: 'text.generate',
      implementation: { implementationId: 'openai', driverId: 'nimillm', driverDialect: 'openai' },
      providerModelTarget: {
        provider: 'openai',
        providerModelId: 'gpt-test',
        remoteModelCatalogId: 'remote-model-catalog-gpt-test',
      },
      supportedFeatures: [], state: 'ready' as const, reasons: [],
    };
    const session = await sessionFor({}, null, {
      connectors: [connector],
      targets: [target],
    });
    const node = render(<AgentCenter activeSection="ai-config" session={session} />);
    await flush();
    await openTextCapability(node);
    const modelTrigger = node.querySelector(
      '[data-testid="model-config-model-trigger:text.generate"]',
    ) as HTMLButtonElement;
    await act(async () => { modelTrigger.click(); await Promise.resolve(); });
    await flush();
    const cloudTab = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cloud') as HTMLButtonElement;
    expect(cloudTab).toBeTruthy();
    act(() => { cloudTab.click(); });
    await flush();
    expect(document.body.querySelector(
      '[data-nimi-model-picker-source="cloud"]',
    )).toBeNull();
    await selectField(document.body, 'Cloud Connector', 'Work account');
    const targetButton = document.body.querySelector(
      '[data-nimi-model-picker-source="cloud"]',
    ) as HTMLButtonElement;
    expect(targetButton).toBeTruthy();
    act(() => { targetButton.click(); });
    const confirmTarget = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use this target') as HTMLButtonElement;
    await act(async () => { confirmTarget.click(); await Promise.resolve(); });
    await flush();
    expect(node.textContent).toContain('Cloud execution');
    const confirmations = Array.from(node.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(confirmations).toHaveLength(0);
    let save = node.querySelector('[data-testid="model-config-save:text.generate"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    let savedIntent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(savedIntent?.route.oneofKind).toBe('cloud');
    if (savedIntent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    const intent = session.getSnapshot().state.sharedAIConfig?.aiConfig.capabilities[0];
    expect(intent?.route.oneofKind).toBe('cloud');
    if (intent?.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent');
    expect(intent.route.cloud.connectorRef).toBe('connector-1');
    expect(intent.route.cloud.implementation).toEqual({
      implementationId: 'openai',
      driverId: 'nimillm',
      driverDialect: 'openai',
    });
    expect(runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget)).toEqual({
      provider: 'openai',
      providerModelId: 'gpt-test',
      remoteModelCatalogId: 'remote-model-catalog-gpt-test',
    });
  });
});
