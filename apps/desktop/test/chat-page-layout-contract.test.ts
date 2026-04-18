import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const chatPageSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-page.tsx');
const chatContactsSidebarSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-contacts-sidebar.tsx');
const chatAiPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-session-list-panel.tsx');
const chatHumanPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-character-rail.tsx');
const chatAgentPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-avatar-stage-rail.tsx');
const chatGroupPanelSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-group-right-column.tsx');
const chatRightColumnPrimitivesSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-column-primitives.tsx');
const chatRightPanelSettingsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-right-panel-settings.tsx');

test('chat page split layout keeps contacts on the far-right transparent rail', () => {
  assert.match(chatPageSource, /data-chat-page-layout="split"/);
  assert.match(chatPageSource, /ChatContactsSidebar/);
  assert.match(chatContactsSidebarSource, /data-chat-contacts-sidebar-chrome="transparent"/);
  assert.match(chatContactsSidebarSource, /className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"/);
  assert.doesNotMatch(chatContactsSidebarSource, /border-l/u);
});

test('chat mode right columns render three standalone cards outside the canonical shell', () => {
  for (const source of [chatAiPanelSource, chatHumanPanelSource, chatAgentPanelSource, chatGroupPanelSource]) {
    assert.match(source, /ChatRightColumn/);
    assert.match(source, /data-chat-mode-column=/);
    assert.match(source, /cardKey="primary"/);
    assert.match(source, /cardKey="status"/);
    assert.match(source, /ChatRightPanelSettings/);
  }
  assert.doesNotMatch(chatAiPanelSource, /border-l/u);
  assert.doesNotMatch(chatHumanPanelSource, /data-right-panel="agent-utility-rail"[\s\S]*border-l/u);
  assert.doesNotMatch(chatRightColumnPrimitivesSource, /RIGHT_COLUMN_CARD_BASE_CLASS[\s\S]*\bborder\b/u);
  assert.match(chatRightColumnPrimitivesSource, /'ml-2 flex min-h-0 w-\[320px\] shrink-0 flex-col gap-3'/);
  assert.doesNotMatch(chatRightPanelSettingsSource, /border-t/u);
  assert.match(chatAgentPanelSource, /data-avatar-stage-viewport="true"/);
  assert.doesNotMatch(chatAgentPanelSource, /data-avatar-stage-dock="true"/);
});
