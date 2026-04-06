import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalCharacterRail } from '../src/components/canonical-character-rail.js';
import { CanonicalComposer } from '../src/components/canonical-composer.js';
import {
  CanonicalConversationPane,
  CANONICAL_STAGE_SURFACE_WIDTH_CLASS,
} from '../src/components/canonical-conversation-pane.js';
import {
  CanonicalConversationShell,
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
import { LOCAL_CHAT_STAGE_SURFACE_WIDTH_CLASS } from '../../../../nimi-mods/runtime/local-chat/src/components/layout/chat-layout-width.js';

const LOCAL_CHAT_CHARACTER_RAIL_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../../nimi-mods/runtime/local-chat/src/components/layout/local-chat-character-rail.tsx'),
  'utf8',
);
const LOCAL_CHAT_CONVERSATION_PANE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../../nimi-mods/runtime/local-chat/src/components/layout/local-chat-conversation-pane.tsx'),
  'utf8',
);

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
          statusSummary="Local route ready"
          statusChips={[{ label: 'Local', tone: 'success' }]}
          openPanel="chat"
          onOpenPanel={onOpenPanel}
          onClosePanel={onClosePanel}
          sections={[
            {
              key: 'chat',
              title: 'Chat Model',
              summary: 'nimi/local',
              content: <div>Route body</div>,
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
    expect(container.textContent).toContain('Route body');
    expect(container.textContent).toContain('Voice');
  });

  it('keeps canonical width and shell landmarks aligned with local-chat constants', async () => {
    expect(CANONICAL_STAGE_SURFACE_WIDTH_CLASS).toBe(LOCAL_CHAT_STAGE_SURFACE_WIDTH_CLASS);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div className="flex h-[960px] flex-col gap-6">
          <CanonicalStagePanel messages={[]} />
          <CanonicalTranscriptView messages={[]} />
          <CanonicalComposer
            adapter={{
              submit: async () => undefined,
            }}
          />
          <CanonicalRightSidebar
            open
            content={(
              <CanonicalRuntimeInspectSidebar
                openPanel={null}
                onOpenPanel={() => undefined}
                onClosePanel={() => undefined}
                sections={[]}
              />
            )}
            onClose={() => undefined}
          />
        </div>,
      );
      await flush();
    });

    expect(container.querySelector('[data-canonical-stage-width="max-w-[min(1240px,calc(100vw-520px))]"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-transcript-width="max-w-[min(1240px,calc(100vw-520px))]"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-composer-width="max-w-[min(1240px,calc(100vw-520px))]"]')).not.toBeNull();

    const rightSidebar = container.querySelector('[data-canonical-right-sidebar="true"]') as HTMLDivElement | null;
    expect(rightSidebar?.style.width).toBe('320px');
    expect(container.querySelector('[data-canonical-runtime-inspect="true"]')).not.toBeNull();
  });

  it('matches local-chat character rail landmarks and fallback copy', async () => {
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
    expect(LOCAL_CHAT_CHARACTER_RAIL_SOURCE).toContain('w-[clamp(360px,30vw,600px)]');
    expect(LOCAL_CHAT_CHARACTER_RAIL_SOURCE).toContain("t('Header.noBio')");
    expect(LOCAL_CHAT_CHARACTER_RAIL_SOURCE).toContain("aria-label={t('Header.backToTargets')}");
    expect(LOCAL_CHAT_CHARACTER_RAIL_SOURCE).toContain("aria-label={t('Header.openProfileDrawer')}");
    expect(canonicalAside?.className).toContain('w-[clamp(360px,30vw,600px)]');
    expect(container.textContent).toContain('This Agent has no public bio.');
    expect(container.querySelector('[data-canonical-presence-badge="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-relationship-badge="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-rail-avatar-anchor="true"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Back to character space"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open profile"]')).not.toBeNull();
  });

  it('matches local-chat conversation pane control order and stage/chat labels', async () => {
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

    expect(LOCAL_CHAT_CONVERSATION_PANE_SOURCE).toContain("aria-label={t('Header.openHistory')}");
    expect(LOCAL_CHAT_CONVERSATION_PANE_SOURCE).toContain("aria-label={t('Header.returnToStage')}");
    expect(LOCAL_CHAT_CONVERSATION_PANE_SOURCE).toContain("aria-label={t('Header.openSettings')}");
    expect(LOCAL_CHAT_CONVERSATION_PANE_SOURCE).toContain('LOCAL_CHAT_STAGE_SURFACE_WIDTH_CLASS');
    expect(container.querySelector('[data-canonical-conversation-pane="true"]')).not.toBeNull();
    expect(container.querySelector('[data-canonical-pane-controls="true"]')).toBeNull();
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

  it('renders canonical setup state before target landing', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalConversationShell
          sourceFilter="all"
          targets={[]}
          selectedTargetId={null}
          selectedTarget={null}
          onSelectTarget={() => undefined}
          viewMode="stage"
          onViewModeChange={() => undefined}
          setupState={{
            mode: 'ai',
            status: 'setup-required',
            issues: [{ code: 'ai-no-chat-route', detail: 'no route ready' }],
            primaryAction: null,
          }}
          setupDescription="Configure a route first."
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Setup Required');
    expect(container.textContent).toContain('Configure a route first.');
    expect(container.querySelector('[data-canonical-target-field="bubble"]')).toBeNull();
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

  it('renders shared markdown headings in canonical transcript and stage panels', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const messages = [{
      id: 'md-1',
      sessionId: 'session-ai',
      targetId: 'ai:assistant',
      source: 'ai' as const,
      role: 'assistant' as const,
      text: '开场说明。\n\n### 3. 浪漫主义与文学情怀\n\n- 第一项\n- 第二项',
      createdAt: '2026-04-05T00:00:00.000Z',
      kind: 'text' as const,
      senderName: 'Assistant',
    }];

    await act(async () => {
      root?.render(
        <div className="flex h-[720px] flex-col gap-6">
          <CanonicalTranscriptView messages={messages} />
          <div className="h-[320px]">
            <CanonicalStagePanel messages={messages} />
          </div>
        </div>,
      );
      await flush();
    });

    const headings = Array.from(container.querySelectorAll('h3')).map((node) => node.textContent?.trim());
    expect(headings).toContain('3. 浪漫主义与文学情怀');
    expect(container.querySelectorAll('ul').length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes inline markdown headings without rewriting fenced code blocks', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const markdown = [
      '残忍。 ### 3. 浪漫主义与文学情怀',
      '',
      '```md',
      '这是一段代码。 ### 不应变成标题',
      '```',
    ].join('\n');

    await act(async () => {
      root?.render(<ChatMarkdownRenderer content={markdown} appearance="canonical" />);
      await flush();
    });

    const headings = container.querySelectorAll('h3');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toContain('3. 浪漫主义与文学情怀');
    expect(container.textContent).toContain('这是一段代码。 ### 不应变成标题');
  });

  it('renders relay markdown appearance with code copy controls, collapse toggle, and tables', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const longCodeBlock = Array.from({ length: 24 }, (_, index) => `line ${index + 1}`).join('\n');
    const markdown = [
      '| 列 | 值 |',
      '| --- | --- |',
      '| a | b |',
      '',
      '```ts',
      longCodeBlock,
      '```',
    ].join('\n');

    await act(async () => {
      root?.render(<ChatMarkdownRenderer content={markdown} appearance="relay" />);
      await flush();
    });

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.textContent).toContain('Copy');
    const toggleButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Show more'));
    expect(toggleButton).not.toBeUndefined();

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain('Show less');
    expect(container.textContent).toContain('line 24');
  });
});
