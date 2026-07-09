import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readRepo(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readAll(relativePaths) {
  return relativePaths.map((relativePath) => read(relativePath)).join('\n');
}

function readAgentChatSource() {
  return readAll([
    'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx',
    'src/shell/agent-chat/ZhiyuAgentRightPanel.tsx',
    'src/shell/agent-chat/ZhiyuAgentChatPieces.tsx',
    'src/shell/agent-chat/ZhiyuAgentChatLabels.ts',
  ]);
}

function readLiveRuntimeAcceptanceSource() {
  return readAll([
    'test/scenario/run-context-helpers.mjs',
    'test/scenario/apml.scenarios.test.mjs',
    'test/scenario/media.scenarios.test.mjs',
    'test/scenario/lifecycle.scenarios.test.mjs',
    'test/scenario/emotion.scenarios.test.mjs',
    'test/scenario/voice.scenarios.test.mjs',
    'test/electron-live-runtime-acceptance-helpers.mjs',
  ]);
}

test('ZM16 product storybook is a first-class acceptance map, not an e2e script narrative', () => {
  const storybookPath = path.join(root, 'src/shell/app/zhiyu-product-storybook.ts');
  assert.equal(existsSync(storybookPath), true, 'product storybook source must exist');

  const storybook = read('src/shell/app/zhiyu-product-storybook.ts');
  for (const storyId of [
    'runtime-offline',
    'no-local-partner',
    'partner-ready',
    'model-config',
    'conversation-turn',
    'agent-center-advanced',
    'avatar-launch-gated',
    'speech-consume-gated',
  ]) {
    assert.match(storybook, new RegExp(`id: '${storyId}'`), `missing product story ${storyId}`);
  }
  assert.doesNotMatch(storybook, /Runtime Agent Chat|Capability Studio|Image Studio|ready checklist/i);
});

test('ZM16 product shell keeps capability probes in backstage and removes image workbench ownership', () => {
  const home = read('src/shell/agent-chat/ZhiyuAgentChatSurface.tsx');
  const rightPanel = read('src/shell/agent-chat/ZhiyuAgentRightPanel.tsx');
  const css = read('src/shell/app/home-surface.css');
  const capabilityProbePath = path.join(root, 'src/shell/agent-chat/AgentCenterCapabilityProbePanel.tsx');
  const capabilitySetupPath = path.join(root, 'src/shell/agent-chat/AgentCenterCapabilitySetupSection.tsx');

  assert.doesNotMatch(home, /AgentCenterCapabilityProbePanel|DeveloperBackstageSurface|id="zhiyu-diagnostics-drawer"|data-zhiyu-diagnostics-drawer/);
  assert.doesNotMatch(rightPanel, /AgentCenterCapabilityProbePanel|CapabilityStudio|data-zhiyu-agent-advanced-panel="true"/);
  assert.doesNotMatch(rightPanel, /DeveloperBackstageSurface/);
  assert.match(rightPanel, /@nimiplatform\/kit\/features\/agent-center/);
  assert.match(home, /data-zhiyu-storybook-version=/);
  assert.doesNotMatch(home, /AgentCenterCapabilitySetupSection|HomeCapabilitySetupSection|ImageStudioSection|data-zhiyu-region="capability-studio"|data-zhiyu-region="image-studio"/);

  assert.equal(existsSync(capabilityProbePath), false, 'Capability Probe must not remain as an Agent Center production panel');
  assert.equal(existsSync(capabilitySetupPath), false, 'Capability setup must not remain as an Agent Center production panel');

  assert.match(css, /\.zhiyu-agent-center/);
  assert.doesNotMatch(
    css,
    /zhiyu-home__developer-backstage|zhiyu-home__proposal-intake|zhiyu-home__image-studio|Product Design desktop migration|Desktop Agent Chat parity corrective layer|ZM15 product shell/,
  );
});

test('ZM16 product shell has no app-scope AIConfig settings surface', () => {
  const settingsPath = path.join(root, 'src/shell/ai-config/zhiyu-ai-config-settings.tsx');
  const storePath = path.join(root, 'src/shell/ai-config/zhiyu-ai-config-store.ts');
  const liveRuntimeAcceptance = readLiveRuntimeAcceptanceSource();

  assert.equal(existsSync(settingsPath), false);
  assert.equal(existsSync(storePath), false);
  assert.doesNotMatch(liveRuntimeAcceptance, /localStorage|agent-home-ai|ai-config:index|clearZhiyuAIConfigStorage/);
  assert.match(liveRuntimeAcceptance, /resetLiveRuntimeEvidenceRoot/);
  assert.match(liveRuntimeAcceptance, /live-runtime-\.\*\\\.\(\?:png\|json\)/);
});

test('ZM16 product shell does not keep direct Runtime AI consume wrappers', () => {
  const kitRuntime = readRepo('kit/features/generation/src/runtime.ts');
  const kitSpeech = readRepo('kit/features/generation/src/runtime-speech-synthesize.ts');
  const zhiyuConsumePath = path.join(root, 'src/shell/capability-studio/zhiyu-ai-consume.ts');
  const aiConfigCapabilitiesPath = path.join(root, 'src/shell/ai-config/zhiyu-ai-config-capabilities.ts');

  assert.match(kitRuntime, /runtime-speech-synthesize/);
  assert.match(kitSpeech, /runRuntimeSpeechSynthesize/);
  assert.match(kitSpeech, /runNimiRuntimeSpeechSynthesis/);
  assert.doesNotMatch(kitSpeech, /apps\/tester|tester-runtime/);

  assert.equal(existsSync(zhiyuConsumePath), false);
  assert.equal(existsSync(aiConfigCapabilitiesPath), false);
});

test('ZM16 avatar launch migration is owner-safe and fail-closed without a public handoff bridge', () => {
  const avatarLaunch = read('src/shell/avatar/avatar-launch.ts');
  const home = readAgentChatSource();
  const app = read('src/shell/app/App.tsx');

  assert.match(avatarLaunch, /@nimiplatform\/kit\/features\/avatar\/headless/);
  assert.match(avatarLaunch, /arbitrateAvatarLaunch/);
  assert.match(avatarLaunch, /zhiyu-avatar-public-handoff-not-admitted/);
  assert.doesNotMatch(avatarLaunch, /apps\/desktop|@renderer\/|desktop_avatar_launch_handoff|runtime\/internal/);

  assert.match(home, /avatarLaunchAction=/);
  assert.match(home, /data-zhiyu-avatar-launch-entry/);
  assert.match(app, /projectZhiyuAvatarLaunchAction/);
});
