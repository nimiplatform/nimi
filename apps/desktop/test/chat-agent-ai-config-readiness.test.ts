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

test('RLA3 submit gate reads Runtime Agent AI Config readiness through Desktop SDK adapter', () => {
  const submitSource = read('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');
  const typesSource = read('src/shell/renderer/features/chat/chat-agent-shell-host-actions-types.ts');
  const adapterSource = read('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const infraSource = fs.readFileSync(path.join(infraDir, 'runtime-agent-ai-config.ts'), 'utf8');

  assert.match(infraSource, /createNimiRuntimeAgentAIConfigModule/);
  assert.doesNotMatch(infraSource, /conversation-capability/);
  assert.match(typesSource, /getRuntimeAgentAIConfigReadiness/);
  assert.match(adapterSource, /getRuntimeAgentAIConfigReadiness:\s*refreshRuntimeAgentAIConfigReadiness/);
  assert.match(submitSource, /await input\.hostInput\.getRuntimeAgentAIConfigReadiness\(\)/);
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
  assert.match(placementSource, /chrome="embedded"/);
  assert.match(placementSource, /appearanceAdapter=\{props\.appearanceAdapter\}/);
  assert.match(placementSource, /agentAIConfig:\s*input\.runtimeAgentAIConfig/);
  assert.match(placementSource, /readiness:\s*input\.runtimeAgentAIConfigReadiness/);
  assert.match(placementSource, /inspect:\s*input\.runtimeInspect/);
  assert.match(placementSource, /providerResolver:\s*getDesktopRouteModelPickerProvider/);
  assert.doesNotMatch(placementSource, /\bidentity=\{/);
  assert.doesNotMatch(placementSource, /ChatSettingsPanel|modelContent|diagnosticsContent|avatarContent|localAppearanceContent/);
  assert.equal(fs.existsSync(desktopPanelPath), false, 'Desktop-owned AgentCenterPanel must be removed');
});

test('RLA3 Desktop Agent Center injects localized Runtime AIConfig status copy', () => {
  const placementSource = fs.readFileSync(path.join(chatDir, 'chat-agent-shell-presentation-settings.tsx'), 'utf8');
  const requiredCopyFields = [
    'adapterUnavailable',
    'revisionUnavailable',
    'savingStatus',
    'savedStatusFormat',
    'updateFailed',
  ];

  for (const field of requiredCopyFields) {
    assert.match(
      placementSource,
      new RegExp(`${field}:\\s*input\\.t\\('Chat\\.agentCenterModelStatus`, 'u'),
      `${field} must be injected from Chat locale copy, not Kit English defaults`,
    );
  }
});
