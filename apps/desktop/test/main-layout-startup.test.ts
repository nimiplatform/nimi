import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const MAIN_LAYOUT_VIEW_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx'),
  'utf8',
);
const APP_ROUTES_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/routes/app-routes.tsx'),
  'utf8',
);
const MAIN_LAYOUT_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout.tsx'),
  'utf8',
);
const CHAT_PAGE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-page.tsx'),
  'utf8',
);
const CHAT_NIMI_MODE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-nimi-mode-content.tsx'),
  'utf8',
);
const CHAT_HUMAN_ADAPTER_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-human-adapter.tsx'),
  'utf8',
);
const CHAT_AGENT_SETTINGS_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-agent-shell-presentation-settings.tsx'),
  'utf8',
);
const CHAT_AGENT_CANONICAL_COMPOSER_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx'),
  'utf8',
);
const CHAT_HUMAN_CANONICAL_COMPONENTS_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-human-canonical-components.tsx'),
  'utf8',
);
const CHAT_HUMAN_COMPOSER_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-human-canonical-composer-profile.tsx'),
  'utf8',
);
const CHAT_NIMI_PRESENTATION_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx'),
  'utf8',
);
const CANONICAL_SHELL_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../kit/features/chat/src/components/canonical-conversation-shell.tsx'),
  'utf8',
);
const CANONICAL_BUBBLE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../kit/features/chat/src/components/canonical-message-bubble.tsx'),
  'utf8',
);
const KIT_RUNTIME_ORCHESTRATION_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../../kit/features/chat/src/runtime/orchestration.ts'),
  'utf8',
);

test('default desktop route keeps the main layout behind a lazy startup boundary', () => {
  assert.match(
    APP_ROUTES_SOURCE,
    /const MainLayout = lazy\(async \(\) => \{\s*const mod = await import\('@renderer\/app-shell\/layouts\/main-layout'\)/s,
  );
  assert.doesNotMatch(APP_ROUTES_SOURCE, /import \{ MainLayout \} from '@renderer\/app-shell\/layouts\/main-layout'/);
});

test('default chat route stays behind a second-stage lazy module during desktop startup', () => {
  assert.match(
    MAIN_LAYOUT_VIEW_SOURCE,
    /const ChatPage = lazy\(async \(\) => \{\s*const mod = await import\('@renderer\/features\/chat\/chat-page'\)/s,
  );
  assert.doesNotMatch(MAIN_LAYOUT_VIEW_SOURCE, /import \{ ChatPage \} from '@renderer\/features\/chat\/chat-page'/);
});

test('non-critical shell side effects do not block main layout import', () => {
  assert.match(MAIN_LAYOUT_SOURCE, /const ChatRealtimeSyncHost = lazy\(async \(\) => \{/);
  assert.match(MAIN_LAYOUT_SOURCE, /const ScenarioJobStatusHost = lazy\(async \(\) => \{/);
  assert.match(MAIN_LAYOUT_SOURCE, /class NonCriticalStartupBoundary extends React\.Component/);
  assert.doesNotMatch(
    MAIN_LAYOUT_SOURCE,
    /import \{ useChatRealtimeSync \} from '@renderer\/features\/realtime\/use-chat-realtime-sync'/,
  );
  assert.doesNotMatch(
    MAIN_LAYOUT_VIEW_SOURCE,
    /import \{ ScenarioJobStatusHost \} from '@renderer\/features\/turns\/scenario-job-status-host'/,
  );
});

test('chat mode surfaces stay behind mode-level lazy boundaries', () => {
  for (const mode of ['human', 'nimi', 'group', 'agent']) {
    assert.match(CHAT_PAGE_SOURCE, new RegExp(`chat:${mode}-mode-content`));
  }
  assert.doesNotMatch(CHAT_PAGE_SOURCE, /import \{ ChatHumanModeContent \} from '\.\/chat-human-mode-content'/);
  assert.doesNotMatch(CHAT_PAGE_SOURCE, /import \{ ChatNimiModeContent \} from '\.\/chat-nimi-mode-content'/);
  assert.doesNotMatch(CHAT_PAGE_SOURCE, /import \{ ChatGroupModeContent \} from '\.\/chat-group-mode-content'/);
  assert.doesNotMatch(CHAT_PAGE_SOURCE, /import \{ ChatAgentModeContent \} from '\.\/chat-agent-mode-content'/);
});

test('default AI chat startup keeps non-default surfaces out of the eager graph', () => {
  assert.match(
    CHAT_NIMI_MODE_SOURCE,
    /import \{ CanonicalConversationShell \} from '@nimiplatform\/nimi-kit\/features\/chat\/components\/canonical-conversation-shell'/,
  );
  assert.doesNotMatch(CHAT_NIMI_MODE_SOURCE, /from '@nimiplatform\/nimi-kit\/features\/chat';/);
  assert.match(CANONICAL_SHELL_SOURCE, /const CanonicalStagePanel = lazy\(async \(\) => \{/);
  assert.match(CANONICAL_SHELL_SOURCE, /const CanonicalCharacterRail = lazy\(async \(\) => \{/);
  assert.doesNotMatch(
    CANONICAL_SHELL_SOURCE,
    /import \{ CanonicalStagePanel[^}]*\} from '\.\/canonical-stage-panel\.js'/,
  );
});

test('markdown, model config, and SDK barrels do not block default chat import', () => {
  assert.match(CANONICAL_BUBBLE_SOURCE, /const ChatMarkdownRenderer = lazy\(async \(\) => \{/);
  assert.match(CANONICAL_BUBBLE_SOURCE, /const RpContentRenderer = lazy\(async \(\) => \{/);
  assert.doesNotMatch(CANONICAL_BUBBLE_SOURCE, /import \{ ChatMarkdownRenderer \} from '\.\/chat-markdown-renderer\.js'/);
  assert.match(CHAT_NIMI_PRESENTATION_SOURCE, /const ChatSettingsPanel = lazy\(async \(\) => \{/);
  assert.doesNotMatch(CHAT_NIMI_PRESENTATION_SOURCE, /import \{ ChatSettingsPanel \} from '\.\/chat-shared-settings-panel'/);
  assert.doesNotMatch(KIT_RUNTIME_ORCHESTRATION_SOURCE, /import \{ getPlatformClient \} from '@nimiplatform\/sdk'/);
  assert.match(KIT_RUNTIME_ORCHESTRATION_SOURCE, /import\('@nimiplatform\/sdk'\)/);
});

test('human and agent mode chunks do not synchronously import settings or chat barrels', () => {
  assert.match(CHAT_HUMAN_ADAPTER_SOURCE, /const ChatSettingsPanel = lazy\(async \(\) => \{/);
  assert.match(CHAT_AGENT_SETTINGS_SOURCE, /const ChatSettingsPanel = lazy\(async \(\) => \{/);
  assert.doesNotMatch(CHAT_HUMAN_ADAPTER_SOURCE, /import \{ ChatSettingsPanel \} from '\.\/chat-shared-settings-panel'/);
  assert.doesNotMatch(CHAT_AGENT_SETTINGS_SOURCE, /import \{ ChatSettingsPanel \} from '\.\/chat-shared-settings-panel'/);

  assert.match(
    CHAT_AGENT_CANONICAL_COMPOSER_SOURCE,
    /import \{ CanonicalComposer \} from '@nimiplatform\/nimi-kit\/features\/chat\/components\/canonical-composer'/,
  );
  assert.match(
    CHAT_HUMAN_COMPOSER_SOURCE,
    /import \{ CanonicalComposer \} from '@nimiplatform\/nimi-kit\/features\/chat\/components\/canonical-composer'/,
  );
  assert.match(
    CHAT_HUMAN_CANONICAL_COMPONENTS_SOURCE,
    /from '@nimiplatform\/nimi-kit\/features\/chat\/components\/canonical-transcript-view'/,
  );
  assert.doesNotMatch(CHAT_AGENT_CANONICAL_COMPOSER_SOURCE, /from '@nimiplatform\/nimi-kit\/features\/chat';/);
  assert.doesNotMatch(CHAT_HUMAN_COMPOSER_SOURCE, /from '@nimiplatform\/nimi-kit\/features\/chat';/);
  assert.doesNotMatch(CHAT_HUMAN_CANONICAL_COMPONENTS_SOURCE, /from '@nimiplatform\/nimi-kit\/features\/chat';/);
});
