import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CanonicalCharacterRail,
  CANONICAL_NO_BIO_FALLBACK,
} from '../src/components/canonical-character-rail.js';
import { CanonicalComposer } from '../src/components/canonical-composer.js';
import {
  CanonicalConversationPane,
  CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
} from '../src/components/canonical-conversation-pane.js';
import {
  CanonicalConversationShell,
  CanonicalDrawerShell,
  CanonicalRightSidebar,
  CanonicalRuntimeInspectSidebar,
  CanonicalStagePanel,
  CanonicalTranscriptView,
  ChatMarkdownRenderer,
  ConversationShell,
  ConversationModeSwitcher,
  ConversationSetupPanel,
  ConversationThreadList,
} from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('conversation shell ui', () => {
  it('switches conversation mode via the shared mode switcher', async () => {
    const onModeChange = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationModeSwitcher
          activeMode="ai"
          onModeChange={onModeChange}
          modes={[
            { mode: 'ai', label: 'AI' },
            { mode: 'human', label: 'Human' },
            { mode: 'agent', label: 'Agent', disabled: true },
          ]}
        />,
      );
      await flush();
    });

    let buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);

    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    await act(async () => {
      buttons[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onModeChange).toHaveBeenCalledWith('human');
  });

  it('renders thread summaries and selection affordance', async () => {
    const onSelectThread = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationThreadList
          activeThreadId="thread-2"
          onSelectThread={onSelectThread}
          threads={[
            {
              id: 'thread-1',
              mode: 'ai',
              title: 'General assistant',
              previewText: 'Ready when you are.',
              createdAt: '2026-04-04T00:00:00.000Z',
              updatedAt: 'just now',
              unreadCount: 0,
              status: 'active',
            },
            {
              id: 'thread-2',
              mode: 'human',
              title: 'Alice',
              previewText: 'See you later.',
              createdAt: '2026-04-04T00:00:00.000Z',
              updatedAt: '1m',
              unreadCount: 2,
              status: 'active',
            },
          ]}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('General assistant');
    expect(container.textContent).toContain('Alice');
    expect(container.textContent).toContain('2');

    const buttons = container.querySelectorAll('button');
    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onSelectThread).toHaveBeenCalledWith('thread-1');
  });

  it('emits setup actions from the shared setup panel', async () => {
    const onAction = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationSetupPanel
          state={{
            mode: 'ai',
            status: 'setup-required',
            issues: [{ code: 'ai-capability-intent-required', detail: 'capability intent required' }],
            primaryAction: {
              kind: 'open-settings',
              targetId: 'runtime-overview',
              returnToMode: 'ai',
            },
          }}
          onAction={onAction}
        />,
      );
      await flush();
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Open Setup');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onAction).toHaveBeenCalledWith({
      kind: 'open-settings',
      targetId: 'runtime-overview',
      returnToMode: 'ai',
    });
  });

  it('renders setup state through the shared conversation shell', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationShell
          viewModel={{
            activeMode: 'ai',
            modes: [{ mode: 'ai', label: 'AI', enabled: true }],
            setupState: {
              mode: 'ai',
              status: 'setup-required',
              issues: [{ code: 'ai-capability-intent-required', detail: 'capability intent required' }],
              primaryAction: null,
            },
            threads: [],
            activeThreadId: null,
            selectedThread: null,
            canCompose: false,
            composerPlaceholder: null,
          }}
          renderSetupDescription={() => 'Configure AI capability intent first.'}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Setup Required');
    expect(container.textContent).toContain('Configure AI capability intent first.');
  });

  it('renders the canonical runtime inspect sidebar with shared panel controls', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onOpenPanel = vi.fn();
    const onClosePanel = vi.fn();

    await act(async () => {
      root?.render(
        <CanonicalRuntimeInspectSidebar
          statusTitle="AI Assistant"
          statusSummary="Local capability intent"
          statusChips={[{ label: 'Local', tone: 'success' }]}
          openPanel="chat"
          onOpenPanel={onOpenPanel}
          onClosePanel={onClosePanel}
          sections={[
            {
              key: 'chat',
              title: 'Conversation',
              summary: 'Local capability intent',
              content: <div>Conversation settings</div>,
            },
            {
              key: 'voice',
              title: 'Voice',
              disabledReason: 'Unavailable',
            },
          ]}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('AI Assistant');
    expect(container.textContent).toContain('Conversation settings');
    expect(container.textContent).toContain('Voice');
  });

  it('keeps canonical character rail landmarks and fallback copy stable', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalCharacterRail
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'session-1',
            title: 'Zhao',
            handle: '@zhao',
            bio: '',
            avatarFallback: 'Z',
          }}
          characterData={{
            avatarUrl: 'https://cdn.nimi.test/portraits/zhao.png',
            name: 'Zhao',
            handle: '@zhao',
            bio: '',
            relationshipState: 'friendly',
            theme: {
              roomSurface: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              roomAura: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              accentSoft: 'rgba(167, 243, 208, 0.55)',
              accentStrong: '#34d399',
              border: 'rgba(16, 185, 129, 0.28)',
              text: '#1f2937',
            },
          }}
          onBackToTargets={() => undefined}
          onOpenProfile={() => undefined}
        />,
      );
      await flush();
    });

    const canonicalAside = container.querySelector('[data-canonical-character-rail="true"]');
    expect(CANONICAL_STAGE_SURFACE_WIDTH_CLASS).toBe('max-w-[min(1240px,calc(100vw-520px))]');
    expect(canonicalAside?.className).toContain('w-[clamp(360px,30vw,600px)]');
    expect(container.textContent).toContain(CANONICAL_NO_BIO_FALLBACK);
    expect(container.querySelector('[data-canonical-presence-badge="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-relationship-badge="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-rail-avatar-anchor="true"]')).not.toBeNull();
    const unavailableAvatar = container.querySelector('[data-avatar-presentation-state="unavailable"]');
    expect(unavailableAvatar).not.toBeNull();
    expect(unavailableAvatar?.getAttribute('data-avatar-static-portrait')).toBe('https://cdn.nimi.test/portraits/zhao.png');
    expect(unavailableAvatar?.textContent).toContain('Avatar unavailable');
    expect(container.querySelector('[data-avatar-backend-kind]')).toBeNull();
    expect(container.querySelector('[data-avatar-renderer]')).toBeNull();
    expect(container.querySelector('button[aria-label="Back to character space"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open profile"]')).not.toBeNull();
  });

  it('renders AvatarStage only for an explicit presentation profile', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalCharacterRail
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'session-1',
            title: 'Zhao',
          }}
          characterData={{
            name: 'Zhao',
            avatarUrl: 'https://cdn.nimi.test/portraits/zhao.png',
            avatarPresentationProfile: {
              backendKind: 'sprite2d',
              avatarAssetRef: 'profile_media_url:https://cdn.nimi.test/avatars/zhao.png',
            },
          }}
          onBackToTargets={() => undefined}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-avatar-backend-kind="sprite2d"]')).not.toBeNull();
    expect(container.querySelector('[data-avatar-renderer="sprite2d"]')).not.toBeNull();
    expect(container.querySelector('[data-avatar-presentation-state="unavailable"]')).toBeNull();
  });

  it('keeps canonical conversation pane landmarks stable', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationPane
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'session-1',
            title: 'Zhao',
          }}
          characterData={{
            name: 'Zhao',
            theme: {
              roomSurface: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              roomAura: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
            },
          }}
          viewMode="stage"
          onBackToTargets={() => undefined}
          onViewModeChange={() => undefined}
          onOpenSettings={() => undefined}
          stagePanel={<div>Stage Slot</div>}
          transcript={<div>Transcript Slot</div>}
          composer={<div>Composer Slot</div>}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-canonical-conversation-pane="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-pane-controls="true"]')).toBeNull();
  });

  it('renders an anchored surface inside the canonical conversation scene instead of a separate sidebar', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div className="h-[720px]">
          <CanonicalConversationPane
            selectedTarget={{
              id: 'agent-1',
              source: 'agent',
              canonicalSessionId: 'session-1',
              title: 'Zhao',
            }}
            characterData={{
              name: 'Zhao',
              theme: {
                roomSurface: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
                roomAura: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              },
            }}
            viewMode="chat"
            onBackToTargets={() => undefined}
            onViewModeChange={() => undefined}
            stagePanel={<div>Stage Slot</div>}
            transcript={<div>Transcript Slot</div>}
            anchoredSurface={{
              content: <div data-test-anchored-surface="true">Anchored Surface</div>,
              placement: 'right-center',
              reserveSpaceClassName: 'pr-[320px]',
              visibleInModes: ['chat'],
            }}
            composer={<div>Composer Slot</div>}
          />
        </div>,
      );
      await flush();
    });

    expect(container.querySelector('[data-canonical-conversation-scene="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-anchored-surface="true"]')).not.toBeNull();
    expect(container.querySelector('[data-test-anchored-surface="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Anchored Surface');
  });

  it('sanitizes and applies conversation backdrop images through theme background style', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationPane
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'session-1',
            title: 'Zhao',
          }}
          characterData={{
            name: 'Zhao',
            theme: {
              roomSurface: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              roomAura: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              appBackdropImageUrl: 'https://cdn.nimi.test/backdrop.png',
            },
          }}
          viewMode="chat"
          onBackToTargets={() => undefined}
          onViewModeChange={() => undefined}
          stagePanel={<div>Stage Slot</div>}
          transcript={<div>Transcript Slot</div>}
          composer={<div>Composer Slot</div>}
        />,
      );
      await flush();
    });

    const pane = container.querySelector('[data-canonical-conversation-pane="true"]') as HTMLElement | null;
    expect(pane?.style.backgroundImage).toContain('https://cdn.nimi.test/backdrop.png');
  });

  it('accepts local file backdrop images for desktop chat themes', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationPane
          selectedTarget={{
            id: 'agent-1',
            source: 'agent',
            canonicalSessionId: 'session-1',
            title: 'Zhao',
          }}
          characterData={{
            name: 'Zhao',
            theme: {
              roomSurface: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              roomAura: 'linear-gradient(180deg,#ffffff,#f8fbfb)',
              appBackdropImageUrl: 'file:///tmp/nimi/backdrop.png',
            },
          }}
          viewMode="chat"
          onBackToTargets={() => undefined}
          onViewModeChange={() => undefined}
          stagePanel={<div>Stage Slot</div>}
          transcript={<div>Transcript Slot</div>}
          composer={<div>Composer Slot</div>}
        />,
      );
      await flush();
    });

    const pane = container.querySelector('[data-canonical-conversation-pane="true"]') as HTMLElement | null;
    expect(pane?.style.backgroundImage).toContain('file:///tmp/nimi/backdrop.png');
  });

  it('renders empty state when no thread is selected', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationShell
          viewModel={{
            activeMode: 'ai',
            modes: [{ mode: 'ai', label: 'AI', enabled: true }],
            setupState: {
              mode: 'ai',
              status: 'ready',
              issues: [],
              primaryAction: null,
            },
            threads: [],
            activeThreadId: null,
            selectedThread: null,
            canCompose: false,
            composerPlaceholder: null,
          }}
          renderEmptyState={() => 'Pick or create a conversation.'}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Pick or create a conversation.');
  });

  it('renders composer only when the view model allows it', async () => {
    const thread = {
      id: 'thread-1',
      mode: 'ai' as const,
      title: 'AI',
      previewText: 'Ready',
      createdAt: '2026-04-04T00:00:00.000Z',
      updatedAt: '2026-04-04T00:00:00.000Z',
      unreadCount: 0,
      status: 'active' as const,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ConversationShell
          viewModel={{
            activeMode: 'ai',
            modes: [{ mode: 'ai', label: 'AI', enabled: true }],
            setupState: {
              mode: 'ai',
              status: 'ready',
              issues: [],
              primaryAction: null,
            },
            threads: [thread],
            activeThreadId: 'thread-1',
            selectedThread: thread,
            canCompose: true,
            composerPlaceholder: 'Send a message',
          }}
          renderTranscript={() => 'Transcript'}
          renderComposer={() => 'Composer'}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Transcript');
    expect(container.textContent).toContain('Composer');
  });

  it('renders the canonical target landing and opens a selected target', async () => {
    const onSelectTarget = vi.fn();
    const onSourceFilterChange = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationShell
          sourceFilter="all"
          targets={[
            {
              id: 'ai:assistant',
              source: 'ai',
              canonicalSessionId: 'session-ai',
              title: 'AI Assistant',
              avatarFallback: 'AI',
              previewText: 'Ready when you are.',
            },
            {
              id: 'human:alice',
              source: 'human',
              canonicalSessionId: 'session-human',
              title: 'Alice',
              avatarFallback: 'A',
              previewText: 'See you soon.',
            },
          ]}
          selectedTargetId={null}
          selectedTarget={null}
          onSelectTarget={onSelectTarget}
          onSourceFilterChange={onSourceFilterChange}
          viewMode="stage"
          onViewModeChange={() => undefined}
        />,
      );
      await flush();
    });

    expect(container.querySelector('[data-canonical-target-field="bubble"]')).not.toBeNull();
    expect(container.querySelector('[data-bubble-id="ai:assistant"]')).not.toBeNull();
    expect(container.querySelector('[data-bubble-id="human:alice"]')).not.toBeNull();
    expect(container.textContent).toContain('AI Assistant');
    expect(container.textContent).toContain('Alice');

    const buttons = Array.from(container.querySelectorAll('button'));
    const humanFilter = buttons.find((button) => button.textContent === 'Human');
    const aliceCard = container.querySelector('[data-bubble-id="human:alice"] button');

    vi.useFakeTimers();
    await act(async () => {
      humanFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      aliceCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(240);
    });
    vi.useRealTimers();

    expect(onSourceFilterChange).toHaveBeenCalledWith('human');
    expect(onSelectTarget).toHaveBeenCalledWith('human:alice');
  });

  it('renders controlled drawers without canonical pane header controls', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationShell
          sourceFilter="all"
          targets={[
            {
              id: 'ai:assistant',
              source: 'ai',
              canonicalSessionId: 'session-ai',
              title: 'AI Assistant',
              avatarFallback: 'AI',
              previewText: 'Ready when you are.',
            },
          ]}
          selectedTargetId="ai:assistant"
          selectedTarget={{
            id: 'ai:assistant',
            source: 'ai',
            canonicalSessionId: 'session-ai',
            title: 'AI Assistant',
            avatarFallback: 'AI',
            previewText: 'Ready when you are.',
          }}
          onSelectTarget={() => undefined}
          viewMode="stage"
          onViewModeChange={() => undefined}
          settingsDrawer={<div>Settings Drawer</div>}
          profileDrawer={<div>Profile Drawer</div>}
          rightSidebar={<div>Inspect Sidebar</div>}
          settingsOpen
          profileOpen
          rightSidebarOpen
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Settings');
    expect(container.textContent).toContain('AI Assistant');
    expect(container.textContent).toContain('Settings Drawer');
    expect(container.textContent).toContain('Profile Drawer');
    expect(container.textContent).toContain('Inspect Sidebar');
    expect(Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Show history')).toBeUndefined();
  });

  it('renders a shell-level scene background beneath the canonical shell UI', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationShell
          sourceFilter="all"
          targets={[
            {
              id: 'agent:scene',
              source: 'agent',
              canonicalSessionId: 'session-agent',
              title: 'Scene Agent',
              avatarFallback: 'S',
              previewText: 'Ready in the scene.',
            },
          ]}
          selectedTargetId="agent:scene"
          selectedTarget={{
            id: 'agent:scene',
            source: 'agent',
            canonicalSessionId: 'session-agent',
            title: 'Scene Agent',
            avatarFallback: 'S',
            previewText: 'Ready in the scene.',
          }}
          onSelectTarget={() => undefined}
          viewMode="chat"
	          onViewModeChange={() => undefined}
	          hideTargetPane
	          hideCharacterRail
	          chrome="transparent"
	          sceneBackground={<div data-test-scene-background="true">Scene Background</div>}
	          transcriptProps={{
	            content: <div>Transcript body</div>,
          }}
          composer={<div>Composer</div>}
        />,
      );
      await flush();
    });

	    expect(container.querySelector('[data-conversation-scene-background="true"]')).not.toBeNull();
	    expect(container.querySelector('[data-conversation-shell-chrome="transparent"]')).not.toBeNull();
	    expect(container.querySelector('[data-test-scene-background="true"]')).not.toBeNull();
	    expect(container.textContent).toContain('Scene Background');
	  });

  it('closes the canonical drawer on Escape and keeps it inert while closed', async () => {
    const onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalDrawerShell open onClose={onClose} title="Settings">
          <button type="button">Focusable action</button>
        </CanonicalDrawerShell>,
      );
      await flush();
    });

    const openDrawer = container.querySelector('[data-canonical-drawer-shell="true"]');
    expect(openDrawer?.hasAttribute('inert')).toBe(false);
    expect(openDrawer?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await act(async () => {
      root?.render(
        <CanonicalDrawerShell open={false} onClose={onClose} title="Settings">
          <button type="button">Focusable action</button>
        </CanonicalDrawerShell>,
      );
      await flush();
    });

    const closedDrawer = container.querySelector('[data-canonical-drawer-shell="true"]');
    expect(closedDrawer?.hasAttribute('inert')).toBe(true);
    expect(closedDrawer?.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the prewarmed closed right sidebar inert and closes it on Escape when open', async () => {
    const onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalRightSidebar
          open={false}
          content={<button type="button">Inspect action</button>}
          onClose={onClose}
          prewarmDelayMs={10}
        />,
      );
      await flush();
    });

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 30);
      });
      await flush();
    });

    const closedSidebar = container.querySelector('[data-canonical-right-sidebar="true"]');
    expect(container.textContent).toContain('Inspect action');
    expect(closedSidebar?.hasAttribute('inert')).toBe(true);
    expect(closedSidebar?.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      root?.render(
        <CanonicalRightSidebar
          open
          content={<button type="button">Inspect action</button>}
          onClose={onClose}
          prewarmDelayMs={10}
        />,
      );
      await flush();
    });

    const openSidebar = container.querySelector('[data-canonical-right-sidebar="true"]');
    expect(openSidebar?.hasAttribute('inert')).toBe(false);
    expect(openSidebar?.getAttribute('aria-hidden')).toBe('false');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
