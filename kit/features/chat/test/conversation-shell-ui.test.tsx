import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CanonicalConversationShell,
  CanonicalRightSidebar,
  CanonicalStagePanel,
  CanonicalTranscriptView,
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
            issues: [{ code: 'ai-no-chat-route', detail: 'no ready route' }],
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
              issues: [{ code: 'ai-no-chat-route', detail: 'no route ready' }],
              primaryAction: null,
            },
            threads: [],
            activeThreadId: null,
            selectedThread: null,
            canCompose: false,
            composerPlaceholder: null,
          }}
          renderSetupDescription={() => 'Configure a route first.'}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Setup Required');
    expect(container.textContent).toContain('Configure a route first.');
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

  it('renders controlled drawers and emits the stage/chat toggle action', async () => {
    const onViewModeChange = vi.fn();
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
          onViewModeChange={onViewModeChange}
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

    const historyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Open chat history');
    expect(historyButton).not.toBeUndefined();

    await act(async () => {
      historyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onViewModeChange).toHaveBeenCalledWith('chat');
  });

  it('renders canonical message slots without changing transcript and stage landmarks', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const messages = [{
      id: 'gift-1',
      sessionId: 'session-human',
      targetId: 'human:alice',
      source: 'human' as const,
      role: 'assistant' as const,
      text: '',
      createdAt: '2026-04-05T00:00:00.000Z',
      kind: 'gift' as const,
    }];

    await act(async () => {
      root?.render(
        <div className="flex h-[640px] flex-col gap-6">
          <CanonicalTranscriptView
            messages={messages}
            renderMessageContent={() => <div>Gift Slot</div>}
            renderMessageAccessory={() => <div>Queued</div>}
            footerContent={<div>Streaming Footer</div>}
          />
          <div className="h-[320px]">
            <CanonicalStagePanel
              messages={messages}
              renderMessageContent={() => <div>Gift Slot</div>}
              footerContent={<div>Streaming Footer</div>}
            />
          </div>
        </div>,
      );
      await flush();
    });

    expect(container.textContent).toContain('Gift Slot');
    expect(container.textContent).toContain('Queued');
    expect(container.textContent).toContain('Streaming Footer');
    expect(container.querySelector('[data-canonical-stage-scroll-root="true"]')).not.toBeNull();
  });

  it('renders voice bubbles and canonical right sidebar shell', async () => {
    const onPlayVoiceMessage = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div className="flex flex-col gap-6">
          <CanonicalTranscriptView
            messages={[
              {
                id: 'voice-1',
                sessionId: 'session-human',
                targetId: 'human:alice',
                source: 'human',
                role: 'assistant',
                text: 'Transcript body',
                createdAt: '2026-04-05T00:00:00.000Z',
                kind: 'voice',
                senderName: 'Alice',
                metadata: {
                  voiceUrl: 'https://example.com/audio.mp3',
                  voiceTranscript: 'Transcript body',
                },
              },
            ]}
            agentName="Alice"
            onPlayVoiceMessage={onPlayVoiceMessage}
          />
          <CanonicalRightSidebar
            open
            content={<div>Inspect Payload</div>}
            onClose={() => undefined}
          />
        </div>,
      );
      await flush();
    });

    const voiceButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Voice message'));
    expect(voiceButton).not.toBeUndefined();

    await act(async () => {
      voiceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(onPlayVoiceMessage).toHaveBeenCalled();
    expect(container.textContent).toContain('Inspect Payload');
  });
});
