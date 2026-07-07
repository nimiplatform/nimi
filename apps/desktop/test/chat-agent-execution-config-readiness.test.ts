import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');
const chatDir = path.join(desktopDir, 'src/shell/renderer/features/chat');
const infraDir = path.join(desktopDir, 'src/shell/renderer/infra');

function read(relPath: string): string {
  return fs.readFileSync(path.join(desktopDir, relPath), 'utf8');
}

test('RLA3 submit gate reads Runtime Agent execution readiness through Desktop SDK adapter', () => {
  const submitSource = read('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');
  const typesSource = read('src/shell/renderer/features/chat/chat-agent-shell-host-actions-types.ts');
  const adapterSource = read('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const infraSource = fs.readFileSync(path.join(infraDir, 'runtime-agent-execution-config.ts'), 'utf8');

  assert.match(infraSource, /createNimiRuntimeAgentExecutionConfigModule/);
  assert.doesNotMatch(infraSource, /conversation-capability/);
  assert.match(typesSource, /getRuntimeAgentExecutionReadiness/);
  assert.match(adapterSource, /getRuntimeAgentExecutionReadiness:\s*refreshRuntimeAgentExecutionReadiness/);
  assert.match(submitSource, /await input\.hostInput\.getRuntimeAgentExecutionReadiness\(\)/);
  assert.doesNotMatch(submitSource, /ensureAgentConversationSubmitRouteReady|resolvedBinding|createNimiConversationAISnapshot/);
});

test('RLA3 Runtime Agent runner omits Desktop-derived route model connector metadata', () => {
  const runnerSource = fs.readFileSync(path.join(chatDir, 'chat-agent-runtime-agent.ts'), 'utf8');
  const providerSource = fs.readFileSync(path.join(chatDir, 'chat-agent-runtime-provider.ts'), 'utf8');
  const turnTypesSource = fs.readFileSync(path.join(chatDir, 'chat-agent-runtime-turn-types.ts'), 'utf8');

  assert.doesNotMatch(runnerSource, /resolveRuntimeAgentTextExecutionBinding|runNimiRuntimeAgentTurn\s*\([\s\S]{0,2400}\b(route|modelId|connectorId)\b/);
  assert.doesNotMatch(providerSource, /textExecutionSnapshot|imageExecutionSnapshot|imageParams|NimiAISnapshot/);
  assert.doesNotMatch(turnTypesSource, /textExecutionSnapshot|imageExecutionSnapshot|imageParams|NimiAISnapshot/);
});

test('RLA3 Desktop Agent Center placement consumes Kit surface only', () => {
  const placementSource = fs.readFileSync(path.join(chatDir, 'chat-agent-shell-presentation-settings.tsx'), 'utf8');
  const desktopPanelPath = path.join(chatDir, 'chat-agent-center-panel.tsx');

  assert.match(placementSource, /@nimiplatform\/kit\/features\/agent-center/);
  assert.doesNotMatch(placementSource, /ChatSettingsPanel|modelContent|diagnosticsContent|avatarContent|localAppearanceContent/);
  assert.equal(fs.existsSync(desktopPanelPath), false, 'Desktop-owned AgentCenterPanel must be removed');
});
