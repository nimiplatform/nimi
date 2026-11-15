import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createHomeNavigation } from '../src/shell/renderer/app-shell/providers/home-navigation.js';

function readDesktopFile(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('the desktop-owned chat layout preserves a full-height chain for Nimi Chat and human communications', () => {
  const panelStackSource = readDesktopFile(
    'src/shell/renderer/app-shell/layouts/main-layout-panel-stack.tsx',
  );
  const chatPageSource = readDesktopFile(
    'src/shell/renderer/features/chat/chat-page.tsx',
  );
  const canonicalFrameSource = readDesktopFile(
    'src/shell/renderer/features/chat/chat-canonical-mode-frame.tsx',
  );
  const rendererFactorySource = readDesktopFile(
    'src/shell/renderer/renderer/factory.tsx',
  );
  const rendererStylesSource = readDesktopFile(
    'src/shell/renderer/styles.css',
  );

  assert.match(
    rendererFactorySource,
    /data-nimi-semantic-id="desktop-main-content"\s+className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"/u,
  );
  assert.match(
    rendererStylesSource,
    /:scope\[data-nimi-semantic-id="desktop-main-root"\]\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;/su,
  );
  assert.match(
    rendererStylesSource,
    /:scope \[data-nimi-semantic-id="desktop-main-content"\]\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 0%;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su,
  );
  assert.match(
    panelStackSource,
    /<MotionPanelFrame panelId=\{activeTab\} className="flex h-full min-h-0 flex-1">/u,
  );
  assert.match(
    chatPageSource,
    /data-chat-page-layout="split" className="relative flex h-full min-h-0 min-w-0 flex-1"/u,
  );
  assert.match(
    canonicalFrameSource,
    /cn\('flex h-full min-h-0 min-w-0 flex-1', props\.className\)/u,
  );
  assert.match(
    canonicalFrameSource,
    /<CanonicalConversationShell[\s\S]*className="h-full min-h-0 flex-1"/u,
  );
});

test('agent-conversation-launcher requires the canonical handle and Conversation anchor', async () => {
  const { launchAgentConversationFromDisplay } = await import(
    '../src/shell/renderer/features/chat/agent-conversation-launcher.js'
  );
  const setChatModeCalls = 0;
  await assert.rejects(
    () => launchAgentConversationFromDisplay({
      target: {
        ownerUserId: 'user-1',
        runtimeSourceRef: 'runtime-source-1',
        localAgentRef: '',
        displayName: 'Runtime Source',
        handle: 'runtime-source',
        avatarUrl: null,
        worldId: 'world-1',
        worldName: 'World',
        bio: null,
        ownershipType: null,
        greeting: null,
        builtinDocsContext: null,
      },
    }),
    /Canonical Agent target requires agentHandle and Conversation anchor/,
  );
  assert.equal(setChatModeCalls, 0);
});

test('agent conversation launcher can prefill composer without authoring a thread', async () => {
  const { launchAgentConversationFromDisplay } = await import(
    '../src/shell/renderer/features/chat/agent-conversation-launcher.js'
  );
  const globals = globalThis as Record<string, unknown>;
  const before = [globals.window, globals.__NIMI_ELECTRON_RUNTIME__];
  const calls: Array<{ command: string; payload: unknown }> = [];
  globals.window = { __NIMI_HTML_BOOT_ID__: 'zhiyu-launch-test' };
  globals.__NIMI_ELECTRON_RUNTIME__ = { invoke: async (command: string, payload: unknown) => {
    if (command === 'log_renderer_event') return {};
    calls.push({ command, payload }); return { opened: true };
  } };
  const navigation = createHomeNavigation();
  try {
    await navigation.push({ id: 'partners', partner: { localAgentRef: 'local-agent:a' } });
    const origin = navigation.getSnapshot().current;
    const result = await launchAgentConversationFromDisplay({
      target: { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', conversationAnchorId: 'anchor-agent-1', displayName: 'Partner' } as never,
      initialComposerText: '  Preserve spacing in this unsent draft.  ', messageId: 'reply-1',
    });
    assert.equal(result.routedSurface, 'zhiyu');
    assert.deepEqual(calls, [{ command: 'bundled_zhiyu_open', payload: { target: {
      conversationAnchorId: 'anchor-agent-1', messageId: 'reply-1', text: '  Preserve spacing in this unsent draft.  ',
    } } }]);
    assert.equal(navigation.getSnapshot().current, origin);
    globals.__NIMI_ELECTRON_RUNTIME__ = { invoke: async (command: string) => command === 'log_renderer_event' ? {} : { opened: false } };
    await assert.rejects(launchAgentConversationFromDisplay({ target: { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', conversationAnchorId: 'anchor-agent-1' } as never,
      initialComposerText: 'retry me' }), /did not open/);
    assert.equal(navigation.getSnapshot().current, origin, 'a refused handoff leaves its source usable');
  } finally {
    navigation.dispose();
    for (const [key, value] of [['window', before[0]], ['__NIMI_ELECTRON_RUNTIME__', before[1]]] as const) {
      if (value === undefined) delete globals[key]; else globals[key] = value;
    }
  }
});
