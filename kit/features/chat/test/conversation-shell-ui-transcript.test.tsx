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
it('keeps the transcript scroll root inside the content column and reserves bottom space for the composer', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <div className="h-[720px]">
          <CanonicalConversationShell
            sourceFilter="all"
            targets={[
              {
                id: 'agent:scene',
                source: 'agent',
                canonicalSessionId: 'session-agent',
                title: 'Scene Agent',
                avatarFallback: 'S',
              },
            ]}
            selectedTargetId="agent:scene"
            selectedTarget={{
              id: 'agent:scene',
              source: 'agent',
              canonicalSessionId: 'session-agent',
              title: 'Scene Agent',
              avatarFallback: 'S',
            }}
            onSelectTarget={() => undefined}
            viewMode="chat"
            onViewModeChange={() => undefined}
            hideTargetPane
            hideCharacterRail
            transcriptProps={{
              content: <div>Transcript body</div>,
              scrollViewportWidthClassName: 'max-w-[520px]',
              scrollViewportPositionClassName: 'ml-0 mr-auto',
              contentPaddingBottomClassName: 'pb-[clamp(168px,20vh,240px)]',
            }}
            composer={<div data-test-composer="true">Composer</div>}
          />
        </div>,
      );
      await flush();
    });

    const transcriptRoot = container.querySelector('[data-canonical-transcript-root="true"]');
    const transcriptWidth = container.querySelector('[data-canonical-transcript-width]');
    expect(transcriptRoot?.className).toContain('max-w-[520px]');
    expect(transcriptRoot?.className).toContain('ml-0');
    expect(transcriptRoot?.className).toContain('overflow-y-auto');
    expect(transcriptRoot?.className).toContain('overscroll-contain');
    expect(transcriptWidth?.className).toContain('pb-[clamp(168px,20vh,240px)]');
    expect(container.querySelector('[data-test-composer="true"]')).not.toBeNull();
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

  it('can disable roleplay parsing for ordinary parenthetical transcript text', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalTranscriptView
          messages={[{
            id: 'assistant-1',
            sessionId: 'session-ai',
            targetId: 'ai:nimi',
            source: 'ai',
            role: 'assistant',
            text: 'This is an open weight \uFF08open weights\uFF09 model.',
            createdAt: '2026-04-05T00:00:00.000Z',
            kind: 'text',
          }]}
          disableRpContent
        />,
      );
      await flush();
      await flush();
    });

    expect(container.textContent).toContain('This is an open weight \uFF08open weights\uFF09 model.');
  });

  it('uses host-provided pending typing copy in transcript view', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <CanonicalTranscriptView
          messages={[{
            id: 'user-1',
            sessionId: 'session-agent',
            targetId: 'agent:ren',
            source: 'agent',
            role: 'user',
            text: '你好',
            createdAt: '2026-04-05T00:00:00.000Z',
            kind: 'text',
          }]}
          pendingFirstBeat
          pendingAgentRoleLabel="伙伴正在回复"
          pendingThinkingLabel="正在思考..."
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('正在思考...');
    expect(container.textContent).not.toContain('Thinking');
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('伙伴正在回复');
  });

	  it('renders group sender labels and avatar slots from canonical transcript props', async () => {
	    container = document.createElement('div');
	    document.body.appendChild(container);
	    root = createRoot(container);

	    await act(async () => {
	      root?.render(
	        <CanonicalTranscriptView
	          messages={[
	            {
	              id: 'agent-1',
	              sessionId: 'group-1',
	              targetId: 'group:salvage',
	              source: 'group',
	              role: 'agent',
	              text: 'I can help.',
	              createdAt: '2026-04-05T00:00:00.000Z',
	              kind: 'text',
	              senderName: 'CuiCui',
	              senderKind: 'agent',
	            },
	            {
	              id: 'agent-2',
	              sessionId: 'group-1',
	              targetId: 'group:salvage',
	              source: 'group',
	              role: 'agent',
	              text: 'Route plotted.',
	              createdAt: '2026-04-05T00:00:30.000Z',
	              kind: 'text',
	              senderName: 'CuiCui',
	              senderKind: 'agent',
	            },
	          ]}
	          renderMessageAvatar={(message, context) => (
	            <span data-testid={`avatar-${message.id}`} data-position={context.position}>
	              avatar
	            </span>
	          )}
	        />,
	      );
	      await flush();
	    });

	    const senderLabels = Array.from(container.querySelectorAll('[data-canonical-sender-label="true"]'));
	    expect(senderLabels).toHaveLength(1);
	    expect(senderLabels[0]?.textContent).toBe('CuiCui');
	    expect(senderLabels[0]?.getAttribute('data-canonical-sender-kind')).toBe('agent');
	    expect(container.querySelector('[data-testid="avatar-agent-1"]')).not.toBeNull();
	    expect(container.querySelector('[data-testid="avatar-agent-2"]')).not.toBeNull();
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

  it('keeps the transcript pinned to the bottom when new messages arrive and the user was already near the bottom', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    const firstMessages = [{
      id: 'user-1',
      sessionId: 'session-agent',
      targetId: 'agent:zhao',
      source: 'agent' as const,
      role: 'user' as const,
      text: 'First turn',
      createdAt: '2026-04-05T00:00:00.000Z',
      updatedAt: '2026-04-05T00:00:00.000Z',
      kind: 'text' as const,
    }];

    await act(async () => {
      root?.render(<CanonicalTranscriptView messages={firstMessages} />);
      await flush();
    });

    const transcriptRoot = container.querySelector('[data-canonical-transcript-root="true"]') as HTMLDivElement | null;
    expect(transcriptRoot).not.toBeNull();
    if (!transcriptRoot) {
      return;
    }

    let scrollHeightValue = 640;
    Object.defineProperty(transcriptRoot, 'clientHeight', {
      configurable: true,
      get: () => 320,
    });
    Object.defineProperty(transcriptRoot, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeightValue,
    });
    transcriptRoot.scrollTop = 320;

    const nextMessages = [
      ...firstMessages,
      {
        id: 'user-2',
        sessionId: 'session-agent',
        targetId: 'agent:zhao',
        source: 'agent' as const,
        role: 'user' as const,
        text: 'Second turn',
        createdAt: '2026-04-05T00:00:01.000Z',
        updatedAt: '2026-04-05T00:00:01.000Z',
        kind: 'text' as const,
      },
    ];
    scrollHeightValue = 960;

    await act(async () => {
      root?.render(<CanonicalTranscriptView messages={nextMessages} />);
      await flush();
    });

    expect(transcriptRoot.scrollTop).toBe(960);
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
